// GAS Script #2 — Van Audit Web App  [RETIRED 2026-08-20]
// Superseded by the PWA talking directly to Supabase (see ../supabase/ and
// ../pwa/index.html) — kept here for reference only, no longer deployed to.
// Deploy as: Execute as Me | Anyone can access
// Spreadsheet: 1ml2RvfV2kqd5tsp7phZzI3SUX6_YYWEyYx9JqTo0OYU

const CFG = {
  SPREADSHEET_ID: '1ml2RvfV2kqd5tsp7phZzI3SUX6_YYWEyYx9JqTo0OYU',
  LIVE_SHEET:     'Live Inventory',
  AUDIT_SHEET:    'Audit Log',
  CYCLE_SHEET:    'Cycle State',
  TRACKER_SHEET:  'Discrepancy Tracker',
  ALERT_EMAIL:    'matt@greenpropertymgt.com',
};

// Category prefixes per set — name column must start with one of these
const SETS = {
  1: ['Bathroom', 'Battery', 'Door'],
  2: ['Electric'],
  3: ['Kitchen'],
  4: ['Shower', 'Sink Faucet'],
  5: ['Sink Plumbing', 'Smoke', 'Toilet', 'Window'],
};

const SET_NAMES = {
  1: 'Bathroom · Battery · Door',
  2: 'Electric',
  3: 'Kitchen',
  4: 'Shower · Sink Faucet',
  5: 'Sink Plumbing · Smoke · Toilet · Window',
};

function doGet(e) {
  const p = e.parameter;
  let result;

  if      (p.action === 'vans')            result = getVanList();
  else if (p.action === 'lookup')          result = lookupPart(p.partNumber, p.van);
  else if (p.action === 'submit')          result = logAudit(p);
  else if (p.action === 'getSession')      result = getSession(p.van);
  else if (p.action === 'completeSession') result = completeSession(p);
  else                                     result = { error: 'unknown action' };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Van list ──────────────────────────────────────────────────────────────────
function getVanList() {
  const data = SpreadsheetApp.openById(CFG.SPREADSHEET_ID)
    .getSheetByName(CFG.LIVE_SHEET).getDataRange().getValues();
  const vans = [...new Set(data.slice(1).map(r => r[0]).filter(Boolean))].sort();
  return { vans };
}

// ── Part lookup (optional barcode verify) ─────────────────────────────────────
function lookupPart(partNumber, van) {
  const data = SpreadsheetApp.openById(CFG.SPREADSHEET_ID)
    .getSheetByName(CFG.LIVE_SHEET).getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1]?.toString().trim() === partNumber &&
        data[i][0]?.toString().trim() === van) {
      return { found: true, name: data[i][2], expectedQty: data[i][3] };
    }
  }
  return { found: false };
}

// ── Get session items for current set ────────────────────────────────────────
function getSession(van) {
  const ss       = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const setNum   = getCurrentSet(ss, van);
  const prefixes = SETS[setNum];

  const liveData = ss.getSheetByName(CFG.LIVE_SHEET).getDataRange().getValues();
  const items    = [];

  for (let i = 1; i < liveData.length; i++) {
    const rowVan  = liveData[i][0]?.toString().trim();
    const partNum = liveData[i][1]?.toString().trim();
    const name    = liveData[i][2]?.toString().trim();
    const qty     = liveData[i][3];

    if (rowVan !== van) continue;
    if (!prefixes.some(p => name.startsWith(p))) continue;

    items.push({ partNumber: partNum, name, expectedQty: qty });
  }

  return { setNum, setName: SET_NAMES[setNum], setTotal: 5, items };
}

// ── Advance set counter after session completes ───────────────────────────────
function completeSession(p) {
  const ss   = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const van  = p.van;
  const tech = p.tech || '';
  const log  = p.log ? JSON.parse(p.log) : [];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let next;
  try {
    const current = getCurrentSet(ss, van);
    next = current >= 5 ? 1 : current + 1;
    setCurrentSet(ss, van, next);
    updateDiscrepancyTracker(ss, van, log);
  } finally {
    lock.releaseLock();
  }

  sendSessionSummary(van, tech, log);
  return { success: true, nextSet: next };
}

// ── One summary email per session instead of one per item ────────────────────
function sendSessionSummary(van, tech, log) {
  const bad = log.filter(r => r.delta !== 0);
  if (!bad.length) return;

  const subject = `Van Audit Summary — ${van}: ${bad.length} discrepanc${bad.length === 1 ? 'y' : 'ies'}`;
  const lines = bad.map(r =>
    `${r.delta < 0 ? 'SHORTAGE' : 'Overage'}: ${r.name} (#${r.partNumber}) — expected ${r.expectedQty}, found ${r.actual} (${r.delta > 0 ? '+' : ''}${r.delta})`
  );
  const body = [
    `Van:  ${van}`,
    `Tech: ${tech || '(not entered)'}`,
    '',
    ...lines,
    '',
    `https://docs.google.com/spreadsheets/d/${CFG.SPREADSHEET_ID}`,
  ].join('\n');

  GmailApp.sendEmail(CFG.ALERT_EMAIL, subject, body);
}

// ── Rolling tally so recurring discrepancies stand out across weeks ──────────
function updateDiscrepancyTracker(ss, van, log) {
  const bad = log.filter(r => r.delta !== 0);
  if (!bad.length) return;

  let sheet = ss.getSheetByName(CFG.TRACKER_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.TRACKER_SHEET);
    sheet.getRange(1, 1, 1, 6)
      .setValues([['Van', 'Part #', 'Name', 'Times Flagged', 'Last Delta', 'Last Flagged']])
      .setFontWeight('bold');
  }

  const data = sheet.getDataRange().getValues();
  bad.forEach(r => {
    const idx = data.findIndex((row, i) =>
      i > 0 && row[0] === van && String(row[1]) === String(r.partNumber));

    if (idx === -1) {
      const newRow = [van, r.partNumber, r.name, 1, r.delta, new Date()];
      sheet.appendRow(newRow);
      data.push(newRow);
    } else {
      const rowNum = idx + 1;
      const timesFlagged = Number(data[idx][3]) + 1;
      sheet.getRange(rowNum, 4, 1, 3).setValues([[timesFlagged, r.delta, new Date()]]);
      data[idx][3] = timesFlagged;
    }
  });
}

function getCurrentSet(ss, van) {
  const sheet = getCycleSheet(ss);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]?.toString().trim() === van) return Number(data[i][1]) || 1;
  }
  sheet.appendRow([van, 1, '']);
  return 1;
}

function setCurrentSet(ss, van, setNum) {
  const sheet = getCycleSheet(ss);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]?.toString().trim() === van) {
      sheet.getRange(i + 1, 2).setValue(setNum);
      sheet.getRange(i + 1, 3).setValue(new Date());
      return;
    }
  }
  sheet.appendRow([van, setNum, new Date()]);
}

function getCycleSheet(ss) {
  let sheet = ss.getSheetByName(CFG.CYCLE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.CYCLE_SHEET);
    sheet.getRange(1, 1, 1, 3)
      .setValues([['Van', 'Current Set', 'Last Session']])
      .setFontWeight('bold');
  }
  return sheet;
}

// ── Log audit result (discrepancy alerting is batched — see sendSessionSummary) ─
function logAudit(p) {
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CFG.AUDIT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CFG.AUDIT_SHEET);
    sheet.getRange(1, 1, 1, 9)
      .setValues([['Timestamp', 'Van', 'Part #', 'Name', 'Expected', 'Actual', 'Delta', 'Tech', 'Sub ID']])
      .setFontWeight('bold');
  }
  // Sheet predates the Tech/Sub ID columns — add headers if missing without touching old rows.
  if (sheet.getRange(1, 8).getValue() !== 'Tech')   sheet.getRange(1, 8).setValue('Tech').setFontWeight('bold');
  if (sheet.getRange(1, 9).getValue() !== 'Sub ID') sheet.getRange(1, 9).setValue('Sub ID').setFontWeight('bold');

  const today    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const existing = findTodaysEntry(sheet, p.van, p.partNumber, today);

  const expected = Number(p.expectedQty);
  const actual   = Number(p.actualQty);
  const delta    = actual - expected;
  const row      = [new Date(), p.van, p.partNumber, p.name, expected, actual, delta, p.tech || '', p.subId || ''];

  if (existing) {
    sheet.getRange(existing.row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { success: true, delta };
}

// Same van + part number already logged today — used to catch accidental re-audits/retries.
function findTodaysEntry(sheet, van, partNumber, todayStr) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const tz   = Session.getScriptTimeZone();
  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (Utilities.formatDate(new Date(r[0]), tz, 'yyyy-MM-dd') !== todayStr) continue;
    if (String(r[1]).trim() === van && String(r[2]).trim() === partNumber) {
      return { row: i + 2, actual: r[5], timestamp: r[0] };
    }
  }
  return null;
}
