// Read-only property list API for Cunningham, served from the Cunningham sheet
// (see Sync.js), so the API and the shared sheet always say the same thing.
// Deployed as a web app (execute as Matt, anyone with the link). Every call
// must carry ?key=<API_KEY>; GAS web apps can't read request headers, so the
// key rides in the URL. Only address, PM and PM contacts leave this endpoint.
//
//   GET <web app url>?key=...                     -> full list
//   GET <web app url>?key=...&address=2201 Oakwood -> matching properties only
//
// GAS can't set HTTP status codes: errors come back as 200 with {ok:false}.

function doGet(e) {
  const p = (e && e.parameter) || {};
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key || urlKey_(e) !== key) return json_({ ok: false, error: 'unauthorized' });

  const ss = publicSheet_();
  if (!ss) return json_({ ok: false, error: 'not configured' });
  const sh = ss.getSheetByName(PUBLIC.PROPS_TAB);
  let list = sh.getDataRange().getValues().slice(1)
    .filter(r => String(r[0]).trim())
    .map(r => ({ address: String(r[0]).trim(), property_manager: String(r[1]).trim() }));
  if (p.address) {
    const k = addressKey_(p.address);
    list = list.filter(r => addressKey_(r.address) === k);
  }
  // A-Z by address, numbers in numeric order (Cunningham asked, 2026-10-17).
  list.sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true, sensitivity: 'base' }));
  return json_({
    ok: true,
    updated: String(sh.getRange('D1').getValue()).replace(/^.*Last updated /, ''),
    count: list.length,
    properties: list,
    contacts: readContacts_(),
  });
}

// Run once from the editor to create (or rotate) the key. Rotating breaks
// Cunningham's link until they get the new URL.
function makeApiKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('API_KEY set: ' + key);
}

// The key, even when the link was mangled on the way to the caller: a link
// copied out of a Gmail redirect arrives as ?key%3D<key>, which GAS doesn't
// parse as a key param (Cunningham hit this 2026-10-16). Decode the raw query
// string until it stops changing, then read key= from it.
function urlKey_(e) {
  if (e && e.parameter && e.parameter.key) return String(e.parameter.key).trim();
  let qs = String((e && e.queryString) || '');
  for (let i = 0; i < 3; i++) {
    let next;
    try { next = decodeURIComponent(qs); } catch (err) { break; }
    if (next === qs) break;
    qs = next;
  }
  const m = qs.match(/(?:^|[?&])key=([0-9a-f]{32})/i);
  return m ? m[1] : '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
