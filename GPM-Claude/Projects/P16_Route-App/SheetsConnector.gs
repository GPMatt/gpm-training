// ─── SheetsConnector.gs ───────────────────────────────────────────────────
// Single source of truth for sheet layout + all read/write access.
// All other .gs files reference WO_COL / getSheet_ / getConfig_ from here —
// Apps Script concatenates every .gs file into one global scope, no imports.

const SPREADSHEET_ID = '1XMpFrb9Qj8p0JACGsov-JGFKadwsH8exu2Ug16INdLA';

// ── WorkOrders tab column map (1-indexed) ──────────────────────────────────
// Columns 1-10 mirror the daily AppFolio CSV export exactly (see WOImporter.gs).
// Columns 11-13 are GPM-only fields, set by a tech flagging a WO as Scheduled
// from the Open Work Orders panel — never touched by the importer.
const WO_COL = {
  WO_NUMBER:          1,
  PROPERTY_ADDRESS:   2,
  UNIT:                3,
  JOB_DESC:            4,
  STATUS_NOTES:        5,
  MAINTENANCE_LIMIT:   6,
  ASSIGNED_USER:       7,
  STATUS:              8,
  APPFOLIO_SCHED_TEXT: 9,  // raw AppFolio text, e.g. "07/06/2026 at 11:00 AM"
  CREATED_AT:         10,
  GPM_SCHED_DATE:     11,  // yyyy-MM-dd — the date this WO is scheduled for TODAY's route
  GPM_SCHED_START:    12,  // HH:mm
  GPM_SCHED_END:      13,  // HH:mm
};

const DAYPLAN_COL = { DATE: 1, TECH: 2, PLAN_JSON: 3, UPDATED_AT: 4 };
const TECHPROP_COL = { TECH: 1, PROPERTY_PREFIX: 2 };

const TERMINAL_STATUSES = ['Completed', 'Cancelled', 'Closed'];

// ─── Sheet access ───────────────────────────────────────────────────────────

function getSheet_(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name + ' — run setupSheets() first.');
  return sheet;
}

function getConfig_(key) {
  const sheet = getSheet_('Config');
  const data = sheet.getDataRange().getValues();
  for (const row of data) {
    if (row[0] === key) return row[1];
  }
  return '';
}

// ─── Work order reads ───────────────────────────────────────────────────────

// Parses AppFolio's free-text Scheduled Start ("MM/DD/YYYY at HH:MM AM/PM" or
// bare "MM/DD/YYYY") into a Date, or null if blank/unparseable.
function parseAppFolioSchedText_(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min, ampm] = m;
  let hour = hh ? parseInt(hh, 10) : 0;
  if (ampm) {
    if (/PM/i.test(ampm) && hour !== 12) hour += 12;
    if (/AM/i.test(ampm) && hour === 12) hour = 0;
  }
  return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10), hour, min ? parseInt(min, 10) : 0);
}

function isDateTodayOrFuture_(date) {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime() >= today.getTime();
}

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Sheets auto-converts date/time-looking cell text (e.g. "09/01/2026") into
// a real Date object on read-back — google.script.run's RPC serializer can
// silently fail on a Date nested inside a returned array of objects (no
// thrown error, client just gets null back). Strip it to an ISO string
// before anything from a raw sheet cell crosses that boundary.
function toPlain_(v) {
  return (v instanceof Date) ? v.toISOString() : v;
}

function rowToWO_(row) {
  const apptDate = parseAppFolioSchedText_(row[WO_COL.APPFOLIO_SCHED_TEXT - 1]);
  // Stale AppFolio appointment dates (before today) are disregarded entirely —
  // they're old records AppFolio never got marked complete for, not today's signal.
  const apptIsLive = isDateTodayOrFuture_(apptDate);

  const gpmSchedDate = row[WO_COL.GPM_SCHED_DATE - 1];
  const gpmWindowIsToday = gpmSchedDate === todayStr_();

  return {
    woNumber:         String(row[WO_COL.WO_NUMBER - 1]),
    address:          row[WO_COL.PROPERTY_ADDRESS - 1],
    unit:             row[WO_COL.UNIT - 1],
    jobDesc:          row[WO_COL.JOB_DESC - 1],
    statusNotes:      row[WO_COL.STATUS_NOTES - 1],
    maintenanceLimit: row[WO_COL.MAINTENANCE_LIMIT - 1],
    assignedUser:     row[WO_COL.ASSIGNED_USER - 1],
    status:           row[WO_COL.STATUS - 1],
    createdAt:        toPlain_(row[WO_COL.CREATED_AT - 1]),
    appFolioApptText: apptIsLive ? row[WO_COL.APPFOLIO_SCHED_TEXT - 1] : '',
    appFolioApptTime: apptIsLive && apptDate ? Utilities.formatDate(apptDate, Session.getScriptTimeZone(), 'HH:mm') : '',
    isScheduledToday: gpmWindowIsToday,
    scheduledStart:   gpmWindowIsToday ? toPlain_(row[WO_COL.GPM_SCHED_START - 1]) : '',
    scheduledEnd:     gpmWindowIsToday ? toPlain_(row[WO_COL.GPM_SCHED_END - 1]) : '',
  };
}

// Returns every open (non-terminal) work order — the full pool, not filtered
// to one tech. Client applies My Properties / Scheduled / Assigned to Me on top.
function getOpenWorkOrders() {
  const sheet = getSheet_('WorkOrders');
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1)
    .filter(row => row[WO_COL.WO_NUMBER - 1] && !TERMINAL_STATUSES.includes(row[WO_COL.STATUS - 1]))
    .map(rowToWO_);
}

function getTechList() {
  const sheet = getSheet_('TechList');
  return sheet.getDataRange().getValues().slice(1)
    .map(r => (r[0] || '').toString().trim())
    .filter(Boolean);
}

// Property-prefix match: a tech's "My Properties" list is a set of address
// prefixes (e.g. "2700 Clyde Park Ave"); a WO matches if its address starts
// with any of the tech's prefixes. No TechProperties rows for a tech = filter
// has nothing to show (flagged in the UI, not silently ignored).
function getTechPropertyPrefixes(techName) {
  const sheet = getSheet_('TechProperties');
  return sheet.getDataRange().getValues().slice(1)
    .filter(r => String(r[TECHPROP_COL.TECH - 1]).trim() === techName)
    .map(r => String(r[TECHPROP_COL.PROPERTY_PREFIX - 1]).trim())
    .filter(Boolean);
}

// ─── Scheduled-flag write (Open WO pool only) ──────────────────────────────

function flagWorkOrderScheduled(woNumber, windowStart, windowEnd) {
  const sheet = getSheet_('WorkOrders');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][WO_COL.WO_NUMBER - 1]) === String(woNumber)) {
      sheet.getRange(i + 1, WO_COL.GPM_SCHED_DATE).setValue(todayStr_());
      sheet.getRange(i + 1, WO_COL.GPM_SCHED_START).setValue(windowStart);
      sheet.getRange(i + 1, WO_COL.GPM_SCHED_END).setValue(windowEnd);
      return { success: true };
    }
  }
  throw new Error('WO not found: ' + woNumber);
}

function unflagWorkOrderScheduled(woNumber) {
  return flagWorkOrderScheduled(woNumber, '', '');
}

// ─── DayPlan read/write (the live, editable working document for the day) ─

function loadDayPlan(techName, dateStr) {
  const sheet = getSheet_('DayPlan');
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][DAYPLAN_COL.DATE - 1] === dateStr && rows[i][DAYPLAN_COL.TECH - 1] === techName) {
      const json = rows[i][DAYPLAN_COL.PLAN_JSON - 1];
      return json ? JSON.parse(json) : null;
    }
  }
  return null;
}

function saveDayPlan(techName, dateStr, planObject) {
  const sheet = getSheet_('DayPlan');
  const rows = sheet.getDataRange().getValues();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const json = JSON.stringify(planObject);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][DAYPLAN_COL.DATE - 1] === dateStr && rows[i][DAYPLAN_COL.TECH - 1] === techName) {
      sheet.getRange(i + 1, DAYPLAN_COL.PLAN_JSON).setValue(json);
      sheet.getRange(i + 1, DAYPLAN_COL.UPDATED_AT).setValue(now);
      refreshManagerView();
      return planObject;
    }
  }
  sheet.appendRow([dateStr, techName, json, now]);
  refreshManagerView();
  return planObject;
}

// ─── Manager view ───────────────────────────────────────────────────────────

function refreshManagerView() {
  const dayPlanSheet = getSheet_('DayPlan');
  const viewSheet = getSheet_('ManagerView');
  const today = todayStr_();

  const rows = dayPlanSheet.getDataRange().getValues().slice(1)
    .filter(r => r[DAYPLAN_COL.DATE - 1] === today && r[DAYPLAN_COL.PLAN_JSON - 1]);

  viewSheet.clearContents();
  viewSheet.getRange(1, 1, 1, 4).setValues([['Tech', 'Stops', 'Completed', 'Status']]).setFontWeight('bold');

  rows.forEach((row, i) => {
    const tech = row[DAYPLAN_COL.TECH - 1];
    let plan;
    try { plan = JSON.parse(row[DAYPLAN_COL.PLAN_JSON - 1]); } catch (e) { return; }
    const route = plan.route || [];
    const completed = route.filter(s => s.complete).length;
    viewSheet.getRange(i + 2, 1, 1, 4).setValues([[tech, route.length, completed, plan.status || 'building']]);
  });
}

// ─── One-time setup ─────────────────────────────────────────────────────────
// Run once from the Apps Script editor after clasp push. Safe to re-run —
// only adds missing tabs/headers, never clears existing data.

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const tabs = {
    WorkOrders: [
      'Work Order Number', 'Property Address', 'Unit', 'Job Description',
      'Status Notes', 'Maintenance Limit', 'Assigned User', 'Status',
      'AppFolio Scheduled Start', 'Created At',
      'GPM Scheduled Date', 'GPM Scheduled Window Start', 'GPM Scheduled Window End',
    ],
    TechList:       ['Tech Name'],
    TechProperties: ['Tech Name', 'Property Address Prefix'],
    DayPlan:        ['Date', 'Tech', 'Plan JSON', 'Updated At'],
    Config:         ['Key', 'Value'],
    ManagerView:    [],
  };

  for (const [name, headers] of Object.entries(tabs)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (headers.length > 0 && sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    }
  }

  const configSheet = ss.getSheetByName('Config');
  if (configSheet.getDataRange().getNumRows() < 2) {
    configSheet.getRange(2, 1, 4, 2).setValues([
      ['DepotAddress', ''],
      ['DefaultStartTime', '08:00'],
      ['GcpProjectId', ''],
      ['RouteOptimizationEnabled', 'N'],
    ]);
  }

  Logger.log('Setup complete. Fill in DepotAddress and GcpProjectId in the Config tab, add techs to TechList, then run seedSampleData() to load test data.');
}
