// ---------- Entry points ----------

// Run once from the editor: adds 2201 Oakwood (if missing) and installs the
// Thursday trigger. Safe to re-run.
function setup() {
  addOakwoodRow_();
  removeRows_(['1044 Muskegon', '1133 Dogwood']);   // no longer managed (Matt, 2026-10-14)
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'weeklyRun')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('weeklyRun').timeBased()
    .onWeekDay(CONFIG.TRIGGER_DAY).atHour(CONFIG.TRIGGER_HOUR).create();
  Logger.log('Thursday trigger installed.');
}

function weeklyRun() {
  const sent = exportList();
  sendDiscrepancyReport(sent);
}

// ---------- 1. Export ----------

function exportList() {
  const rows = readAssignments_();
  const seen = new Set();
  const list = [];
  rows.forEach(r => {
    if (!r.address || r.units === 0) return;   // skips the 0-unit Watson corporate row
    const k = addressKey_(r.address);
    if (seen.has(k)) return;
    seen.add(k);
    list.push([r.address, r.pm]);
  });

  const date = Utilities.formatDate(new Date(), 'America/Detroit', 'yyyy-MM-dd');
  const csv = [['Property Address', 'Property Manager']].concat(list)
    .map(row => row.map(csvCell_).join(',')).join('\r\n');
  const blob = Utilities.newBlob(csv, 'text/csv', `GPM Property List ${date}.csv`);
  const file = exportFolder_().createFile(blob);
  PropertiesService.getScriptProperties().setProperty('LAST_SENT_FILE_ID', file.getId());

  const live = !!CONFIG.CUNNINGHAM_EMAIL;
  const body =
    `Hello,\n\nAttached is Green Property Management's current property list ` +
    `(${list.length} properties) with the property manager for each address. ` +
    `This replaces any earlier list.\n\nThank you,\nGreen Property Management`;
  MailApp.sendEmail({
    to: live ? CONFIG.CUNNINGHAM_EMAIL : CONFIG.REPORT_TO,
    cc: live ? CONFIG.REPORT_TO : '',
    subject: (live ? '' : '[DRY RUN - not sent to Cunningham] ') +
             `Green Property Management - Property List ${date}`,
    body: body,
    attachments: [blob],
  });
  return { list: list, date: date, live: live };
}

// ---------- 2. Discrepancy report ----------

function sendDiscrepancyReport(sent) {
  if (!sent) sent = lastSentList_();
  const sentKeys = new Map(sent.list.map(([addr, pm]) => [addressKey_(addr), { addr, pm }]));
  const ignore = new Set(CONFIG.NOT_MANAGED.map(addressKey_));

  const sb = fetchActiveProperties_();
  const sbKeys = new Map();
  sb.forEach(p => sbKeys.set(addressKey_(p.canonical_address), p));

  const missingFromList = [];   // active in AppFolio/Supabase, not on the list
  sbKeys.forEach((p, k) => {
    if (!sentKeys.has(k) && !ignore.has(k)) missingFromList.push(p);
  });
  const notInSupabase = [];     // on the list, not active in AppFolio/Supabase
  sentKeys.forEach((v, k) => { if (!sbKeys.has(k)) notInSupabase.push(v); });

  const n = missingFromList.length + notInSupabase.length;
  const li = arr => arr.length ? '<ul>' + arr.join('') + '</ul>' : '<p><i>None.</i></p>';
  const html =
    `<p>Compared the property list ${sent.live ? 'sent to Cunningham' : 'prepared (dry run)'} ` +
    `on ${sent.date} (${sent.list.length} properties) with the ${sb.length} active properties in Supabase ` +
    `(AppFolio rent roll). ${CONFIG.NOT_MANAGED.length} known not-managed properties are ignored.</p>` +
    `<h3>In AppFolio, missing from the list (${missingFromList.length})</h3>` +
    `<p>Add to the Truth tab with a PM, or add to NOT_MANAGED in Config.js if we don't manage it.</p>` +
    li(missingFromList.map(p => `<li>${esc_(p.af_property_name || p.canonical_address)} ` +
      `(${esc_(p.property_type || '?')}, account ${esc_(p.af_account)})</li>`)) +
    `<h3>On the list, not active in AppFolio (${notInSupabase.length})</h3>` +
    `<p>Probably no longer managed. Remove from the Truth tab.</p>` +
    li(notInSupabase.map(v => `<li>${esc_(v.addr)} (${esc_(v.pm)})</li>`));

  MailApp.sendEmail({
    to: CONFIG.REPORT_TO,
    subject: `Cunningham list vs AppFolio: ${n ? n + ' discrepanc' + (n === 1 ? 'y' : 'ies') : 'no discrepancies'} (${sent.date})`,
    htmlBody: html,
  });
}

// ---------- Helpers ----------

function readAssignments_() {
  const values = SpreadsheetApp.getActive().getSheetByName(CONFIG.TAB).getDataRange().getValues();
  const h = values[0].map(String);
  const col = name => {
    const i = h.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" not found on ${CONFIG.TAB}`);
    return i;
  };
  const cName = col('Property Name'), cAddr = col('Property Address'), cUnits = col('Units'), cPm = col('PM');
  return values.slice(1).map(r => ({
    name: String(r[cName]).trim(),
    address: String(r[cAddr]).trim(),
    units: r[cUnits] === '' ? null : Number(r[cUnits]),
    pm: String(r[cPm]).trim(),
  }));
}

// House number + first street word, ignoring punctuation and a leading
// direction: "2201 Oakwood Ave NE, Grand Rapids" -> "2201 OAKWOOD",
// "31 E Ash" -> "31 ASH". Sheet and AppFolio spell suffixes differently, so
// the rest of the address is deliberately not compared.
function addressKey_(addr) {
  const t = String(addr).toUpperCase().replace(/[.,#-]/g, '').split(/\s+/).filter(Boolean);
  if (!t.length) return '';
  let i = 1;
  if (['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'].includes(t[i])) i++;
  return t[0] + ' ' + (t[i] || '');
}

function fetchActiveProperties_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('SUPABASE_URL'), key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in Script Properties');
  const res = UrlFetchApp.fetch(
    `${url}/rest/v1/dim_property?select=canonical_address,af_property_name,property_type,af_account&active=eq.true&limit=5000`,
    { headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Supabase ' + res.getResponseCode() + ': ' + res.getContentText());
  const rows = JSON.parse(res.getContentText());
  if (!rows.length) throw new Error('Supabase returned 0 active properties; refusing to report');
  return rows;
}

function lastSentList_() {
  const id = PropertiesService.getScriptProperties().getProperty('LAST_SENT_FILE_ID');
  if (!id) throw new Error('No list exported yet; run exportList first');
  const file = DriveApp.getFileById(id);
  const rows = Utilities.parseCsv(file.getBlob().getDataAsString()).slice(1);
  const date = (file.getName().match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  return { list: rows, date: date, live: !!CONFIG.CUNNINGHAM_EMAIL };
}

function exportFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.EXPORT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.EXPORT_FOLDER_NAME);
}

function addOakwoodRow_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.TAB);
  const exists = readAssignments_().some(r => addressKey_(r.address) === '2201 OAKWOOD');
  if (exists) { Logger.log('2201 Oakwood already on the sheet.'); return; }
  // Tech left blank on purpose: not assigned yet.
  sh.appendRow(['Oakwood Ave - Joy Smith', '2201 Oakwood Ave NE Grand Rapids, MI 49505',
                1, 'Mike Green', '', 'Single-Family', 'Joy Smith']);
  Logger.log('Added 2201 Oakwood Ave NE.');
}

// Deletes Truth rows whose address matches one of the given keys.
// Bottom-up so earlier row numbers stay valid.
function removeRows_(addresses) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.TAB);
  const targets = new Set(addresses.map(addressKey_));
  const rows = readAssignments_();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (targets.has(addressKey_(rows[i].address))) {
      sh.deleteRow(i + 2);
      Logger.log('Removed ' + rows[i].address);
    }
  }
}

function csvCell_(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
