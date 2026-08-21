// GAS Script #1 — Van Inventory Email Sync + Supabase bridge
// Triggers (all created by setup()):
//   - syncVanInventory   Monday 7:20am EST  — pulls AppFolio CSV, writes into Supabase
//   - keepSupabaseAwake  daily 3:00am EST   — free-tier projects pause after 7 days idle
//   - drawJasonSchedule  1st of month 5:00am EST — random-without-replacement Jason-audit picker
//
// syncVanInventoryManual has no trigger — run it by hand from the editor to
// backfill a missed week or seed the first baseline off whatever the latest
// Van Inventory email in the inbox is.
//
// Before running setup(): open Project Settings in the Apps Script editor and
// add two Script Properties — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY —
// using the values from Supabase (Project Settings -> API). Never put the
// service_role key anywhere client-side; this script is the only place it
// belongs.

const CONFIG = {
  SENDER:      'donotreply@appfolio.com',
  SUBJECT:     'Van Inventory',
  ALERT_EMAIL: 'matt@greenpropertymgt.com',
};

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('syncVanInventory')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(7).nearMinute(20).inTimezone('America/Detroit').create();

  ScriptApp.newTrigger('keepSupabaseAwake')
    .timeBased().everyDays(1).atHour(3).inTimezone('America/Detroit').create();

  ScriptApp.newTrigger('drawJasonSchedule')
    .timeBased().onMonthDay(1).atHour(5).inTimezone('America/Detroit').create();
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
function sbConfig() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY script properties.');
  return { url: url.replace(/\/$/, ''), key };
}

// Bulk upsert; returns the rows as saved (including their ids).
function sbUpsert(table, rows, conflictCol) {
  if (!rows.length) return [];
  const { url, key } = sbConfig();
  const res = UrlFetchApp.fetch(`${url}/rest/v1/${table}?on_conflict=${conflictCol}`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(`Supabase upsert failed on ${table}: ${res.getContentText()}`);
  return JSON.parse(res.getContentText());
}

function sbInsert(table, rows) {
  if (!rows.length) return [];
  const { url, key } = sbConfig();
  const res = UrlFetchApp.fetch(`${url}/rest/v1/${table}`, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=representation' },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(`Supabase insert failed on ${table}: ${res.getContentText()}`);
  return JSON.parse(res.getContentText());
}

function sbGet(table, query) {
  const { url, key } = sbConfig();
  const res = UrlFetchApp.fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'get',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(`Supabase read failed on ${table}: ${res.getContentText()}`);
  return JSON.parse(res.getContentText());
}

// ── Daily keep-alive so the free-tier project never crosses the 7-day idle line ─
function keepSupabaseAwake() {
  try { sbGet('vans', 'select=id&limit=1'); } catch (e) { /* a failed ping isn't worth alerting on */ }
}

// ── Weekly AppFolio -> Supabase sync ─────────────────────────────────────────
function syncVanInventory() {
  const csv = getTodaysInventoryCSV();
  if (!csv) {
    try { sbInsert('par_syncs', [{ status: 'failed', row_count: 0 }]); } catch (e) { /* Supabase down is secondary to the alert below */ }
    GmailApp.sendEmail(
      CONFIG.ALERT_EMAIL,
      'Van Inventory Sync FAILED — No Email Found Today',
      `The Monday sync ran at 7:20am EST but could not find a Van Inventory email from ${CONFIG.SENDER} received today.\n\nCheck that AppFolio sent the report. This week's baseline was NOT updated.`
    );
    return;
  }
  runInventorySync(csv);
}

// Manual backfill: pulls the most recent Van Inventory email regardless of
// date, instead of requiring one to have arrived today. For catching up a
// missed Monday, or seeding a baseline before the first scheduled run.
// Run by hand from the Apps Script editor: select this function, click Run.
function syncVanInventoryManual() {
  const csv = getLatestInventoryCSV();
  if (!csv) {
    GmailApp.sendEmail(CONFIG.ALERT_EMAIL, 'Van Inventory Manual Sync FAILED — No Email Found',
      `No Van Inventory email from ${CONFIG.SENDER} with subject "${CONFIG.SUBJECT}" was found in the inbox at all.`);
    return;
  }
  runInventorySync(csv);
}

function runInventorySync(csv) {
  const parsed = parseInventoryCSV(csv);
  if (!parsed.length) {
    sbInsert('par_syncs', [{ status: 'failed', row_count: 0 }]);
    GmailApp.sendEmail(CONFIG.ALERT_EMAIL, 'Van Inventory Sync FAILED — Empty CSV',
      'The sync found an email but the CSV parsed to zero usable rows.');
    return;
  }

  const vanLabels = [...new Set(parsed.map(r => r.van))];
  const partNumbers = [...new Set(parsed.map(r => r.partNumber))];

  const vans = sbUpsert('vans', vanLabels.map(label => ({ label })), 'label');
  const vanIdByLabel = Object.fromEntries(vans.map(v => [v.label, v.id]));

  // name comes from this week's CSV; part_number is the natural key
  const partsByNumber = {};
  parsed.forEach(r => { partsByNumber[r.partNumber] = r.name; });
  const parts = sbUpsert('parts',
    partNumbers.map(pn => ({ part_number: pn, name: partsByNumber[pn] })), 'part_number');
  const partIdByNumber = Object.fromEntries(parts.map(p => [p.part_number, p.id]));

  const [sync] = sbInsert('par_syncs', [{ status: 'ok', row_count: parsed.length }]);

  const vanParRows = parsed.map(r => ({
    par_sync_id: sync.id,
    van_id: vanIdByLabel[r.van],
    part_id: partIdByNumber[r.partNumber],
    expected_qty: r.quantity,
  }));
  sbInsert('van_par', vanParRows);
}

function getTodaysInventoryCSV() {
  const now    = new Date();
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

function getLatestInventoryCSV() {
  const query = `from:${CONFIG.SENDER} subject:"${CONFIG.SUBJECT}" has:attachment`;
  const threads = GmailApp.search(query, 0, 10);
  let newest = null;

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (newest && message.getDate() <= newest.date) continue;
      for (const att of message.getAttachments()) {
        const name = att.getName().toLowerCase();
        const type = att.getContentType().toLowerCase();
        if (name.endsWith('.csv') || type.includes('csv') || type.includes('text/plain')) {
          newest = { date: message.getDate(), csv: att.getDataAsString() };
          break;
        }
      }
    }
  }
  return newest ? newest.csv : null;
}

function formatGmailDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function parseInventoryCSV(csvContent) {
  // CSV columns: Location | Part Number | Name | Quantity
  const rows = Utilities.parseCsv(csvContent);
  const result = [];

  for (const row of rows) {
    const van        = row[0] ? row[0].toString().trim() : '';
    const partNumber = row[1] ? row[1].toString().trim() : '';
    if (!van || van === 'Location' || !partNumber || isNaN(partNumber)) continue;

    const qty = parseFloat(row[3]);
    if (isNaN(qty)) continue;

    result.push({
      van, partNumber,
      name: (row[2]?.toString().trim() || '').replace(/\*$/, ''),
      quantity: qty,
    });
  }
  return result;
}

// ── Monthly Jason-audit picker — random without replacement, reset each month ─
function drawJasonSchedule() {
  const vans = sbGet('vans', 'select=id,label&active=eq.true&order=label');
  if (!vans.length) return;

  const shuffled = [...vans];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const mondays = mondaysInUpcomingMonth();
  const audit_month = Utilities.formatDate(mondays[0], 'America/Detroit', 'yyyy-MM-01');

  // If there are more Mondays than vans (a 5-Monday month), the extras
  // are left unassigned for now — no van repeats within the same month.
  const rows = mondays.slice(0, shuffled.length).map((monday, i) => ({
    audit_month,
    van_id: shuffled[i].id,
    audit_date: Utilities.formatDate(monday, 'America/Detroit', 'yyyy-MM-dd'),
  }));

  sbInsert('jason_audit_schedule', rows);

  const lines = rows.map(r => {
    const van = vans.find(v => v.id === r.van_id);
    return `${r.audit_date} — ${van.label}`;
  });
  GmailApp.sendEmail(CONFIG.ALERT_EMAIL, 'Jason Audit Schedule — Next Month', lines.join('\n'));
}

function mondaysInUpcomingMonth() {
  const now = new Date();
  const nextMonth = now.getMonth() === 11 ? 0 : now.getMonth() + 1;
  const nextYear  = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();

  const mondays = [];
  const d = new Date(nextYear, nextMonth, 1);
  while (d.getMonth() === nextMonth) {
    if (d.getDay() === 1) mondays.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return mondays;
}
