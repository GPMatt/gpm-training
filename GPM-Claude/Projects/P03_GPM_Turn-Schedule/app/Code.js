/**
 * P03 GPM Turns: Spencer's scheduling assistant (MVP, 2026-11-06).
 *
 * Flow: PMI Scope form -> recommended schedule -> Spencer books vendors by hand, checks steps
 * off -> Tech Prep + Move-out forms -> rent ready. No automated vendor contact in the MVP.
 *
 * Data: Supabase (Executive Dash / warehouse project), tables p03_turns + p03_turn_settings
 * (db/001_turn_app.sql). Property + unit dropdowns come from dim_property / dim_unit.
 *
 * Script Properties (Matt sets these once):
 *   SUPABASE_URL          - same project as the warehouse pipeline
 *   SUPABASE_SERVICE_KEY  - service_role key (server side only, never sent to the browser)
 */

var TZ = 'America/Detroit';
var TURN_COLS = ['property_id', 'unit_id', 'property_label', 'unit_label', 'af_wo_number', 'move_out_date',
  'move_in_date', 'rent_ready_date', 'stage', 'scope', 'tech_prep', 'move_out_check', 'steps', 'archived'];

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('GPM Turns')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

// ---------- Supabase ----------

function sb_(method, path, body, prefer) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL'), key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Setup needed: SUPABASE_URL and SUPABASE_SERVICE_KEY Script Properties are not set.');
  var opts = {
    method: method, muteHttpExceptions: true,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' }
  };
  if (body !== undefined) opts.payload = JSON.stringify(body);
  var resp = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/' + path, opts);
  var code = resp.getResponseCode(), text = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error('Database error ' + code + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

function userEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

// ---------- API (called from the browser with google.script.run) ----------

function apiBoot() {
  var settingsRows = sb_('get', 'p03_turn_settings?id=eq.config&select=value');
  var turns = sb_('get', 'p03_turns?archived=eq.false&select=*&order=move_out_date.asc.nullslast');
  return { user: userEmail_(), settings: settingsRows.length ? settingsRows[0].value : null, turns: turns };
}

function apiSaveTurn(turn) {
  var row = {};
  TURN_COLS.forEach(function (c) { if (turn[c] !== undefined) row[c] = turn[c] === '' ? null : turn[c]; });
  row.updated_by = userEmail_();
  row.updated_at = new Date().toISOString();
  if (!turn.id) {
    if (!row.property_label) throw new Error('Pick a property first.');
    row.created_by = row.updated_by;
    return sb_('post', 'p03_turns', row)[0];
  }
  var out = sb_('patch', 'p03_turns?id=eq.' + encodeURIComponent(turn.id), row);
  if (!out.length) throw new Error('Turn not found (it may have been deleted).');
  return out[0];
}

function apiArchiveTurn(id, archived) {
  return sb_('patch', 'p03_turns?id=eq.' + encodeURIComponent(id),
    { archived: archived !== false, updated_by: userEmail_(), updated_at: new Date().toISOString() })[0];
}

function apiArchivedTurns() {
  return sb_('get', 'p03_turns?archived=eq.true&select=*&order=updated_at.desc&limit=100');
}

function apiSaveSettings(value) {
  return sb_('post', 'p03_turn_settings?on_conflict=id',
    [{ id: 'config', value: value, updated_by: userEmail_(), updated_at: new Date().toISOString() }],
    'resolution=merge-duplicates,return=representation')[0].value;
}

function apiProperties() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('props_v1');
  if (hit) return JSON.parse(hit);
  var rows = sb_('get', 'dim_property?active=eq.true&select=property_id,canonical_address,af_property_name,af_account,property_type&order=canonical_address.asc');
  try { cache.put('props_v1', JSON.stringify(rows), 21600); } catch (e) { /* too big for cache: fine */ }
  return rows;
}

function apiUnits(propertyId) {
  if (!/^[0-9a-f-]{36}$/i.test(propertyId || '')) return [];
  return sb_('get', 'dim_unit?active=eq.true&property_id=eq.' + propertyId + '&select=unit_id,unit_label_af&order=unit_label_af.asc');
}

/** Run from the editor (Code.js) after setting Script Properties: confirms the tables exist + are granted. */
function checkSetup() {
  var t = sb_('get', 'p03_turns?select=id&limit=1');
  var s = sb_('get', 'p03_turn_settings?select=id&limit=1');
  var p = sb_('get', 'dim_property?select=property_id&limit=1');
  Logger.log('OK: p03_turns rows=%s, settings rows=%s, dim_property reachable=%s', t.length, s.length, p.length > 0);
}
