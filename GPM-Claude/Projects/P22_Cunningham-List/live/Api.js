// Read-only property list API for Cunningham, served from the Truth tab.
// Deployed as a web app (execute as Matt, anyone with the link). Every call
// must carry ?key=<API_KEY>; GAS web apps can't read request headers, so the
// key rides in the URL. Only address + PM ever leave this endpoint.
//
//   GET <web app url>?key=...                     -> full list
//   GET <web app url>?key=...&address=2201 Oakwood -> matching properties only
//
// GAS can't set HTTP status codes: errors come back as 200 with {ok:false}.

function doGet(e) {
  const p = (e && e.parameter) || {};
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key || p.key !== key) return json_({ ok: false, error: 'unauthorized' });

  let list = buildList_().map(([address, pm]) => ({ address: address, property_manager: pm }));
  if (p.address) {
    const k = addressKey_(p.address);
    list = list.filter(r => addressKey_(r.address) === k);
  }
  return json_({
    ok: true,
    updated: new Date().toISOString(),
    count: list.length,
    properties: list,
  });
}

// Run once from the editor to create (or rotate) the key. Rotating breaks
// Cunningham's link until they get the new URL.
function makeApiKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('API_KEY set: ' + key);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
