// GAS Script #1 — Van Inventory Email Sync
// Trigger: Friday 7:20am EST via setup()
// No Master sheet required — writes Live Inventory directly from CSV
// Spreadsheet: 1ml2RvfV2kqd5tsp7phZzI3SUX6_YYWEyYx9JqTo0OYU

const CONFIG = {
  SPREADSHEET_ID: '1ml2RvfV2kqd5tsp7phZzI3SUX6_YYWEyYx9JqTo0OYU',
  LIVE_SHEET:     'Live Inventory',
  SENDER:         'donotreply@appfolio.com',
  SUBJECT:        'Van Inventory',
  ALERT_EMAIL:    'matt@greenpropertymgt.com',
};

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncVanInventory')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(7)
    .nearMinute(20)
    .inTimezone('America/New_York')
    .create();
}

function syncVanInventory() {
  const csv = getTodaysInventoryCSV();
  if (!csv) {
    GmailApp.sendEmail(
      CONFIG.ALERT_EMAIL,
      'Van Inventory Sync FAILED — No Email Found Today',
      `The Friday sync ran at 7:20am EST but could not find a Van Inventory email from ${CONFIG.SENDER} received today.\n\nCheck that AppFolio sent the report. Live Inventory was NOT updated.`
    );
    return;
  }
  const parsed = parseInventoryCSV(csv);
  writeLiveInventory(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID), parsed);
}

function getTodaysInventoryCSV() {
  const now   = new Date();
  const after  = formatGmailDate(now);
  const before = formatGmailDate(new Date(now.getTime() + 86400000));
  const query  = `from:${CONFIG.SENDER} subject:"${CONFIG.SUBJECT}" after:${after} before:${before}`;

  const threads = GmailApp.search(query);
  for (const thread of threads) {
    const messages = thread.getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      for (const att of messages[i].getAttachments()) {
        const name = att.getName().toLowerCase();
        const type = att.getContentType().toLowerCase();
        if (name.endsWith('.csv') || type.includes('csv') || type.includes('text/plain')) {
          return att.getDataAsString();
        }
      }
    }
  }
  return null;
}

function formatGmailDate(date) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function parseInventoryCSV(csvContent) {
  // CSV columns: Location | Part Number | Name | Quantity
  // Van name is in col A of every data row — no section headers
  const rows = Utilities.parseCsv(csvContent);
  const result = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const van        = row[0] ? row[0].toString().trim() : '';
    const partNumber = row[1] ? row[1].toString().trim() : '';

    if (!van || van === 'Location' || !partNumber || isNaN(partNumber)) continue;

    const qty = parseFloat(row[3]);
    if (isNaN(qty)) continue;

    result.push({
      van,
      partNumber,
      name:     (row[2]?.toString().trim() || '').replace(/\*$/, ''),
      quantity: qty,
    });
  }
  return result;
}

function writeLiveInventory(ss, data) {
  const sheet = ss.getSheetByName(CONFIG.LIVE_SHEET);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 4)
    .setValues([['Van', 'Part Number', 'Name', 'Expected Qty']])
    .setFontWeight('bold');
  if (data.length) {
    sheet.getRange(2, 1, data.length, 4)
      .setValues(data.map(r => [r.van, r.partNumber, r.name, r.quantity]));
  }
}
