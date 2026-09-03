// ─── WOImporter.gs ────────────────────────────────────────────────────────
// Reads the 5 daily "<Realm> - Route" emails from AppFolio, parses each
// attached work_order-YYYYMMDD.csv, and upserts rows into WorkOrders.
// Dedup key: Work Order Number. GPM-only columns (11-13) are never touched
// here — those belong to flagWorkOrderScheduled() only.

const ROUTING_SUBJECTS = [
  'App11 - Route',
  'Oakwood - Route',
  'Jefferson - Route',
  'Pinery - Route',
  'IVA - Route',
];
const APPFOLIO_SENDER = 'donotreply@appfolio.com'; // TODO: confirm exact sender address

// CSV column indices (0-based) — matches the real AppFolio export header:
// Property Address, Unit, Created At, Work Order Number, Job Description,
// Status Notes, Maintenance Limit, Assigned User, Status, Scheduled Start
const CSV = {
  ADDRESS:       0,
  UNIT:          1,
  CREATED_AT:    2,
  WO_NUMBER:     3,
  JOB_DESC:      4,
  STATUS_NOTES:  5,
  MAINT_LIMIT:   6,
  ASSIGNED_USER: 7,
  STATUS:        8,
  SCHED_TEXT:    9,
};

function importWOsFromEmail() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const afterStr = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  const parsedWOs = {}; // woNumber -> row array (last one wins if duplicated across realms)
  let attachmentsSeen = 0;

  for (const subject of ROUTING_SUBJECTS) {
    const query = 'from:' + APPFOLIO_SENDER + ' subject:"' + subject + '" after:' + afterStr;
    const threads = GmailApp.search(query, 0, 1);

    if (!threads.length) {
      Logger.log('No email found today for: ' + subject);
      continue;
    }

    const messages = threads[0].getMessages();
    const latest = messages[messages.length - 1];

    for (const att of latest.getAttachments()) {
      if (!att.getName().match(/^work_order.*\.csv$/i)) continue;
      attachmentsSeen++;

      const rows = Utilities.parseCsv(att.getDataAsString());
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const woNum = (r[CSV.WO_NUMBER] || '').trim();
        const status = (r[CSV.STATUS] || '').trim();
        if (!woNum) continue;
        if (TERMINAL_STATUSES.includes(status)) continue;

        parsedWOs[woNum] = [
          woNum,
          (r[CSV.ADDRESS] || '').trim(),
          (r[CSV.UNIT] || '').trim(),
          (r[CSV.JOB_DESC] || '').trim(),
          (r[CSV.STATUS_NOTES] || '').trim(),
          (r[CSV.MAINT_LIMIT] || '').trim(),
          (r[CSV.ASSIGNED_USER] || '').trim().replace(/\s+/g, ' '),
          status,
          (r[CSV.SCHED_TEXT] || '').trim(),
          (r[CSV.CREATED_AT] || '').trim(),
        ];
      }
    }
  }

  if (!Object.keys(parsedWOs).length) {
    Logger.log('No WOs parsed — nothing to import. Attachments seen: ' + attachmentsSeen);
    return;
  }

  const sheet = getSheet_('WorkOrders');
  const existing = sheet.getDataRange().getValues();
  const woRowMap = {};
  for (let i = 1; i < existing.length; i++) {
    const n = String(existing[i][WO_COL.WO_NUMBER - 1]).trim();
    if (n) woRowMap[n] = i + 1;
  }

  const newRows = [];
  let updatedCount = 0;

  for (const [woNum, sheetRow] of Object.entries(parsedWOs)) {
    if (woRowMap[woNum]) {
      // Columns 1-10 come from AppFolio and are safe to overwrite in place;
      // columns 11-13 (GPM scheduling fields) are never touched here.
      sheet.getRange(woRowMap[woNum], 1, 1, sheetRow.length).setValues([sheetRow]);
      updatedCount++;
    } else {
      // Pad to full row width so GPM columns start blank, not undefined.
      while (sheetRow.length < 13) sheetRow.push('');
      newRows.push(sheetRow);
    }
  }

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  Logger.log('WO import done — ' + newRows.length + ' new, ' + updatedCount + ' updated, ' + attachmentsSeen + ' attachments processed.');
}

function createDailyImportTrigger() {
  const existing = ScriptApp.getProjectTriggers();
  for (const t of existing) {
    if (t.getHandlerFunction() === 'importWOsFromEmail') {
      Logger.log('Daily trigger already exists.');
      return;
    }
  }
  ScriptApp.newTrigger('importWOsFromEmail')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .nearMinute(20)
    .create();
  Logger.log('Daily ~7:20 AM trigger created.');
}

// ─── One-time local test data (no Gmail required) ──────────────────────────
// Loads a small fixed sample so the app is usable before the daily email
// import is confirmed working. Safe to re-run — upserts by WO number, same
// as importWOsFromEmail().

function seedSampleData() {
  const today = new Date();
  const fmt = (d) => Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  const plus = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d; };

  // Rows below are written in raw-CSV column order (matches the CSV map above,
  // same as a real AppFolio export) — reordered into WorkOrders sheet order
  // (WO_COL) before writing, same as importWOsFromEmail() does.
  const sample = [
    ['418 Cedar Ridge Dr, Wyoming, MI 49509', 'Unit 3B', fmt(plus(-2)), 'S1001', 'Garbage disposal not working', '', '0.00', 'Miguel R.', 'Assigned', ''],
    ['92 Willow Park Ln, Wyoming, MI 49509', 'Unit 7', fmt(plus(-5)), 'S1002', 'Replace HVAC filter, unit blowing warm', '', '0.00', 'Miguel R.', 'Assigned', ''],
    ['77 Birchwood Ct, Kentwood, MI 49548', 'Unit 4A', fmt(plus(0)), 'S1003', 'No hot water reported by tenant', '', '300.00', 'Miguel R.', 'Assigned', ''],
    ['14 Maple Grove Ave, Kentwood, MI 49548', '', fmt(plus(0)), 'S1004', 'Smoke detector beeping, tenant anxious', '', '0.00', '', 'New', ''],
    ['205 Oakhaven Way, Grand Rapids, MI 49503', 'Unit 12', fmt(plus(-1)), 'S1005', 'Tenant walk-through — move-in inspection', '', '0.00', 'Miguel R.', 'Scheduled', fmt(today) + ' at 01:30 PM'],
    ['30 Gold St SE, Grand Rapids, MI 49503', 'Unit 02', fmt(plus(-3)), 'S1006', 'Power button on the air conditioner unresponsive', '', '500.00', '', 'Waiting', ''],
  ];

  const sheet = getSheet_('WorkOrders');
  const existing = sheet.getDataRange().getValues();
  const woRowMap = {};
  for (let i = 1; i < existing.length; i++) {
    const n = String(existing[i][WO_COL.WO_NUMBER - 1]).trim();
    if (n) woRowMap[n] = i + 1;
  }

  const newRows = [];
  for (const row of sample) {
    const woNum = row[CSV.WO_NUMBER];
    const sheetRow = [
      row[CSV.WO_NUMBER], row[CSV.ADDRESS], row[CSV.UNIT], row[CSV.JOB_DESC],
      row[CSV.STATUS_NOTES], row[CSV.MAINT_LIMIT], row[CSV.ASSIGNED_USER],
      row[CSV.STATUS], row[CSV.SCHED_TEXT], row[CSV.CREATED_AT],
    ];
    if (woRowMap[woNum]) {
      sheet.getRange(woRowMap[woNum], 1, 1, sheetRow.length).setValues([sheetRow]);
    } else {
      const padded = sheetRow.slice();
      while (padded.length < 13) padded.push('');
      newRows.push(padded);
    }
  }
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }

  const techSheet = getSheet_('TechList');
  if (techSheet.getDataRange().getNumRows() < 2) {
    techSheet.getRange(2, 1).setValue('Miguel R.');
  }
  const propSheet = getSheet_('TechProperties');
  if (propSheet.getDataRange().getNumRows() < 2) {
    propSheet.getRange(2, 1, 2, 2).setValues([
      ['Miguel R.', '418 Cedar Ridge Dr'],
      ['Miguel R.', '92 Willow Park Ln'],
    ]);
  }

  Logger.log('Sample data loaded: ' + sample.length + ' work orders, plus a test tech (Miguel R.) and property mapping.');
}

// ─── Real tech roster + property mapping ────────────────────────────────────
// REAL_TECH_ROSTER / REAL_TECH_PROPERTIES live in TechRosterData.gs, which is
// gitignored (real tech names + property addresses, same reasoning as the
// work_order-*.csv exclusion — this repo is public). Push both files to the
// GAS project with `clasp push`; only this function ships in git.
// REPLACES TechList/TechProperties content (clears the "Miguel R." placeholder
// from seedSampleData()) rather than upserting. Safe to re-run.

function seedRealTechRoster() {
  const techSheet = getSheet_('TechList');
  if (techSheet.getLastRow() > 1) {
    techSheet.getRange(2, 1, techSheet.getLastRow() - 1, techSheet.getLastColumn()).clearContent();
  }
  techSheet.getRange(2, 1, REAL_TECH_ROSTER.length, 1).setValues(REAL_TECH_ROSTER.map(t => [t]));

  const propSheet = getSheet_('TechProperties');
  if (propSheet.getLastRow() > 1) {
    propSheet.getRange(2, 1, propSheet.getLastRow() - 1, propSheet.getLastColumn()).clearContent();
  }
  propSheet.getRange(2, 1, REAL_TECH_PROPERTIES.length, 2).setValues(REAL_TECH_PROPERTIES);

  Logger.log('Real tech roster loaded: ' + REAL_TECH_ROSTER.length + ' techs, ' + REAL_TECH_PROPERTIES.length + ' property mappings.');
}
