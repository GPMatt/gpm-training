// Weekly proposed update to the Cunningham list (Matt, 2026-11-18).
//
// Wednesday noon: weeklyRun() compares the list with the active properties in
// Supabase and emails Matt a proposal with ONE review link. The link opens a
// page (doGet in Api.js routes ?review=<token> here) where each change is
// Apply / Skip / Ignore always, and each addition has a PM dropdown
// (pre-filled from Supabase pm_name, default Blake). Nothing changes until
// Apply is pressed on the page: opening the link alone is safe, so email
// link scanners can't approve anything. Apply edits the Truth tab, re-syncs
// the Cunningham sheet and emails a confirmation.
//
// The token is single-use and replaced by the next week's proposal.
// "Ignore always" keys live in Script Property IGNORED_KEYS (JSON array of
// address keys); delete an entry there to have it proposed again.

const PROPOSAL = {
  DEFAULT_PM: 'Blake Roush',
  // Pinned: ScriptApp.getService().getUrl() is unreliable from triggers (P25).
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycby89x_P0sHMh6Y_e75EqRjovnGyEMHoqs7fn3gZSLueMzUla1IJZlP2CjqQmhaxUVQEtA/exec',
};

function buildProposal_() {
  const list = buildList_();
  const listKeys = new Map(list.map(([addr, pm]) => [addressKey_(addr), { addr, pm }]));
  const ignore = new Set(CONFIG.NOT_MANAGED.map(addressKey_).concat(ignoredKeys_()));
  const extras = new Set(CONFIG.EXTRA_ADDRESSES.map(([addr]) => addressKey_(addr)));

  const sb = fetchActiveProperties_();
  const sbKeys = new Map();
  sb.forEach(p => sbKeys.set(addressKey_(p.canonical_address), p));

  const changes = [];
  sbKeys.forEach((p, k) => {
    if (listKeys.has(k) || ignore.has(k)) return;
    changes.push({
      id: 'a' + changes.length, kind: 'add', key: k,
      address: propertyAddress_(p),
      name: p.af_property_name || p.canonical_address,
      type: p.property_type || '',
      account: p.af_account || '',
      pm: p.pm_name || PROPOSAL.DEFAULT_PM,
      pmFromSupabase: !!p.pm_name,
    });
  });
  // Extra addresses aren't AppFolio properties, so they're never proposed for removal.
  listKeys.forEach((v, k) => {
    if (sbKeys.has(k) || extras.has(k) || ignore.has(k)) return;
    changes.push({ id: 'r' + changes.length, kind: 'remove', key: k, address: v.addr, pm: v.pm });
  });
  return { changes: changes, listCount: list.length, sbCount: sb.length };
}

// "2159 Galewood - 2159 Galewood Ave SW Wyoming, MI 49509" -> full address.
function propertyAddress_(p) {
  const name = String(p.af_property_name || '');
  const tail = name.includes(' - ') ? name.slice(name.lastIndexOf(' - ') + 3) : name;
  return normalizeAddress_(tail) || normalizeAddress_(name) || p.canonical_address;
}

function sendProposal_() {
  const date = Utilities.formatDate(new Date(), 'America/Detroit', 'yyyy-MM-dd');
  const prop = buildProposal_();
  const n = prop.changes.length;
  const props = PropertiesService.getScriptProperties();

  if (!n) {
    props.deleteProperty('PROPOSAL');
    MailApp.sendEmail({
      to: CONFIG.REPORT_TO,
      subject: `Cunningham list: no changes proposed (${date})`,
      htmlBody: `<p>The Cunningham list (${prop.listCount} addresses) matches the ${prop.sbCount} ` +
        `active properties in Supabase. Nothing to approve this week.</p>`,
    });
    return;
  }

  const token = Utilities.getUuid().replace(/-/g, '');
  props.setProperty('PROPOSAL', JSON.stringify({ token: token, date: date, changes: prop.changes }));
  const url = `${PROPOSAL.WEB_APP_URL}?review=${token}`;
  const adds = prop.changes.filter(c => c.kind === 'add');
  const rems = prop.changes.filter(c => c.kind === 'remove');
  const li = arr => arr.length ? '<ul>' + arr.join('') + '</ul>' : '<p><i>None.</i></p>';
  const html =
    `<p>Proposed update to the Cunningham list (${prop.listCount} addresses), ` +
    `compared with ${prop.sbCount} active properties in Supabase.</p>` +
    `<p><a href="${url}" style="display:inline-block;background:#2f6b3a;color:#fff;padding:10px 18px;` +
    `border-radius:6px;text-decoration:none;font-weight:bold">Review and approve ${n} change${n === 1 ? '' : 's'}</a></p>` +
    `<p style="color:#666;font-size:12px">Opening the link changes nothing. You pick each change and the PM on the page, ` +
    `then press Apply. The link works once and is replaced by next week's email.</p>` +
    `<h3>Add (${adds.length})</h3>` +
    li(adds.map(c => `<li>${esc_(c.address)}: PM ${esc_(c.pm)}${c.pmFromSupabase ? '' : ' (default, no PM in Supabase)'} ` +
      `<span style="color:#666">(${esc_(c.type || '?')}, account ${esc_(c.account)})</span></li>`)) +
    `<h3>Remove (${rems.length})</h3>` +
    li(rems.map(c => `<li>${esc_(c.address)} (${esc_(c.pm)}): not active in AppFolio/Supabase</li>`));

  MailApp.sendEmail({
    to: CONFIG.REPORT_TO,
    subject: `Cunningham list: ${n} proposed change${n === 1 ? '' : 's'} (${date})`,
    htmlBody: html,
  });
}

function loadProposal_(token) {
  const raw = PropertiesService.getScriptProperties().getProperty('PROPOSAL');
  if (!raw || !token) return null;
  const p = JSON.parse(raw);
  return p.token === String(token) ? p : null;
}

// Called by doGet (Api.js) for ?review=<token>.
function reviewPage_(token) {
  const p = loadProposal_(token);
  const t = HtmlService.createTemplate(REVIEW_HTML_);
  t.data = JSON.stringify(p ? {
    token: p.token, date: p.date, changes: p.changes,
    pms: [...new Set(buildList_().map(r => r[1]).concat(p.changes.map(c => c.pm), [PROPOSAL.DEFAULT_PM])
      .filter(Boolean))].sort(),
  } : null);
  return t.evaluate().setTitle('Cunningham list update')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// decisions: { <change id>: { action: 'apply'|'skip'|'ignore', pm: '...' } }
function applyProposal(token, decisions) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Busy, try again in a minute.');
  let p;
  try {
    p = loadProposal_(token);
    if (!p) throw new Error('This link was already used or replaced by a newer proposal.');
    PropertiesService.getScriptProperties().deleteProperty('PROPOSAL');   // single use
  } finally {
    lock.releaseLock();
  }

  const done = { added: [], removed: [], ignored: [], skipped: [] };
  const toRemove = [];
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.TAB);
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const newIgnored = [];

  p.changes.forEach(c => {
    const d = (decisions || {})[c.id] || { action: 'skip' };
    if (d.action === 'ignore') { newIgnored.push(c.key); done.ignored.push(c); return; }
    if (d.action !== 'apply') { done.skipped.push(c); return; }
    if (c.kind === 'add') {
      const pm = String(d.pm || c.pm || PROPOSAL.DEFAULT_PM).trim();
      const row = h.map(col => ({ 'Property Name': c.name, 'Property Address': c.address,
        'PM': pm, 'Type': c.type })[col] || '');
      sh.appendRow(row);
      done.added.push(Object.assign({}, c, { pm: pm }));
    } else {
      toRemove.push(c.key);
      done.removed.push(c);
    }
  });
  if (toRemove.length) removeRows_(toRemove);
  if (newIgnored.length) setIgnoredKeys_(ignoredKeys_().concat(newIgnored));
  syncPublicSheet();

  const count = buildList_().length;
  const li = (arr, f) => arr.length ? '<ul>' + arr.map(f).join('') + '</ul>' : '<p><i>None.</i></p>';
  MailApp.sendEmail({
    to: CONFIG.REPORT_TO,
    subject: `Cunningham list updated: ${done.added.length} added, ${done.removed.length} removed`,
    htmlBody:
      `<p>Applied the ${p.date} proposal. The Cunningham sheet and API now list ${count} addresses.</p>` +
      `<h3>Added (${done.added.length})</h3>` + li(done.added, c => `<li>${esc_(c.address)}: ${esc_(c.pm)}</li>`) +
      `<h3>Removed (${done.removed.length})</h3>` + li(done.removed, c => `<li>${esc_(c.address)} (${esc_(c.pm)})</li>`) +
      `<h3>Ignored from now on (${done.ignored.length})</h3>` + li(done.ignored, c => `<li>${esc_(c.address)}</li>`) +
      `<h3>Skipped this week (${done.skipped.length})</h3>` + li(done.skipped, c => `<li>${esc_(c.address)}</li>`),
  });
  return { added: done.added.length, removed: done.removed.length,
    ignored: done.ignored.length, skipped: done.skipped.length, count: count };
}

function ignoredKeys_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('IGNORED_KEYS') || '[]'); }
  catch (e) { return []; }
}

function setIgnoredKeys_(keys) {
  PropertiesService.getScriptProperties().setProperty('IGNORED_KEYS', JSON.stringify([...new Set(keys)]));
}

// Run from the editor to send a proposal right now (same as Wednesday's email).
function testProposal() {
  sendProposal_();
}

const REVIEW_HTML_ = `<!doctype html><html><head><base target="_top"><style>
body{font:15px/1.4 -apple-system,Segoe UI,Arial,sans-serif;margin:0;padding:16px;background:#f6f5f1;color:#222}
.wrap{max-width:720px;margin:0 auto}h1{font-size:20px}h2{font-size:16px;margin-top:24px}
.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin:8px 0}
.addr{font-weight:600}.meta{color:#666;font-size:13px}.opts{margin-top:8px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
select{font-size:14px;padding:4px}button{background:#2f6b3a;color:#fff;border:0;border-radius:6px;padding:12px 22px;font-size:16px;font-weight:600;margin-top:16px}
button:disabled{opacity:.5}.msg{padding:12px;border-radius:8px;margin-top:16px}.ok{background:#e3f1e5}.err{background:#f8e1e1}
</style></head><body><div class="wrap" id="app"></div><script>
var D = <?!= data ?>;
var app = document.getElementById('app');
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
if (!D) { app.innerHTML = '<h1>Cunningham list update</h1><div class="msg err">This link was already used or replaced by a newer proposal.</div>'; }
else {
  var h = '<h1>Cunningham list update</h1><p class="meta">Proposal from ' + esc(D.date) + '. Nothing changes until you press Apply.</p>';
  function card(c){
    var r = '<div class="card"><div class="addr">' + esc(c.address) + '</div><div class="meta">' +
      (c.kind === 'add' ? esc(c.type || '?') + ', AppFolio account ' + esc(c.account) + (c.pmFromSupabase ? '' : ', no PM in Supabase')
                        : 'PM ' + esc(c.pm) + '. Not active in AppFolio/Supabase') + '</div><div class="opts">';
    ['apply','skip','ignore'].forEach(function(a){
      r += '<label><input type="radio" name="' + c.id + '" value="' + a + '"' + (a === 'apply' ? ' checked' : '') + '> ' +
        {apply: c.kind === 'add' ? 'Add' : 'Remove', skip: 'Skip this week', ignore: 'Ignore always'}[a] + '</label>';
    });
    if (c.kind === 'add') {
      r += '<label>PM <select id="pm_' + c.id + '">' + D.pms.map(function(p){
        return '<option' + (p === c.pm ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></label>';
    }
    return r + '</div></div>';
  }
  var adds = D.changes.filter(function(c){return c.kind==='add';});
  var rems = D.changes.filter(function(c){return c.kind==='remove';});
  if (adds.length) h += '<h2>Add (' + adds.length + ')</h2>' + adds.map(card).join('');
  if (rems.length) h += '<h2>Remove (' + rems.length + ')</h2>' + rems.map(card).join('');
  h += '<button id="go">Apply</button><div id="out"></div>';
  app.innerHTML = h;
  document.getElementById('go').onclick = function(){
    var dec = {};
    D.changes.forEach(function(c){
      var a = document.querySelector('input[name="' + c.id + '"]:checked').value;
      var pm = document.getElementById('pm_' + c.id);
      dec[c.id] = {action: a, pm: pm ? pm.value : ''};
    });
    var b = this; b.disabled = true; b.textContent = 'Applying...';
    google.script.run.withSuccessHandler(function(r){
      b.textContent = 'Done';
      document.getElementById('out').innerHTML = '<div class="msg ok">Added ' + r.added + ', removed ' + r.removed +
        ', ignored ' + r.ignored + ', skipped ' + r.skipped + '. The list now has ' + r.count +
        ' addresses. A confirmation email is on its way.</div>';
    }).withFailureHandler(function(e){
      b.disabled = false; b.textContent = 'Apply';
      document.getElementById('out').innerHTML = '<div class="msg err">' + esc(e.message || e) + '</div>';
    }).applyProposal(D.token, dec);
  };
}
</script></body></html>`;
