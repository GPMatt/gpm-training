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
 *   EMAIL_TEST_TO         - optional; when set, every app email goes ONLY to this address
 *   cal_<turnId>          - written by the app (calendar event ids per turn); don't edit by hand
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
    return withCalendar_(sb_('post', 'p03_turns', row)[0]);
  }
  var out = sb_('patch', 'p03_turns?id=eq.' + encodeURIComponent(turn.id), row);
  if (!out.length) throw new Error('Turn not found (it may have been deleted).');
  return withCalendar_(out[0]);
}

function apiArchiveTurn(id, archived) {
  return withCalendar_(sb_('patch', 'p03_turns?id=eq.' + encodeURIComponent(id),
    { archived: archived !== false, updated_by: userEmail_(), updated_at: new Date().toISOString() })[0]);
}

/** Syncs the saved row to Google Calendar; a failure only adds row.calendarError. */
function withCalendar_(row) {
  var err = syncCalendarSafe_(row);
  if (err && row && typeof row === 'object') row.calendarError = err;
  return row;
}

function apiArchivedTurns() {
  return sb_('get', 'p03_turns?archived=eq.true&select=*&order=updated_at.desc&limit=100');
}

function apiSaveSettings(value) {
  CacheService.getScriptCache().remove('settings_v1');
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

/**
 * Emails the AppFolio WO description built from the saved Tech Prep (text builder: Describe.js).
 * Reads the turn fresh from Supabase, sends one email, stamps tech_prep.email_sent_at.
 */
function apiSendTechPrepEmail(turnId) {
  var rows = sb_('get', 'p03_turns?id=eq.' + encodeURIComponent(turnId || '') + '&select=*');
  if (!rows.length) throw new Error('Turn not found (it may have been deleted).');
  var turn = rows[0];
  if (!turn.tech_prep) throw new Error('This turn has no Tech Prep saved yet, so there is nothing to email.');
  var settingsRows = sb_('get', 'p03_turn_settings?id=eq.config&select=value');
  var mail = buildTechPrepMail(turn, settingsRows.length ? settingsRows[0].value : {}, emailTestTo_());
  var msg = { to: mail.to.join(','), subject: mail.subject, body: mail.text, htmlBody: mail.html };
  if (mail.cc.length) msg.cc = mail.cc.join(',');
  MailApp.sendEmail(msg);
  var sentAt = new Date().toISOString();
  var tp = turn.tech_prep;
  tp.email_sent_at = sentAt;
  sb_('patch', 'p03_turns?id=eq.' + encodeURIComponent(turn.id), { tech_prep: tp });
  return { to: msg.to, cc: msg.cc || '', subject: mail.subject, sentAt: sentAt };
}

/**
 * V1 (2026-11-11): the AppFolio WO description for Spencer's "Copy for AppFolio WO" button. Built from the
 * SAVED Tech Prep (same builder as the email), so it is identical to the email's top block. Sends nothing.
 */
function apiWoDescription(turnId) {
  var rows = sb_('get', 'p03_turns?id=eq.' + encodeURIComponent(turnId || '') + '&select=*');
  if (!rows.length) throw new Error('Turn not found (it may have been deleted).');
  var turn = rows[0];
  if (!turn.tech_prep) throw new Error('Tech Prep is not saved yet, so there is no WO description.');
  var settings = cachedSettings_();
  var d = describeTechPrep(turn, CHECK_ROOMS_SERVER, settings);
  return { subject: d.subject, paste: d.paste, wo: turn.af_wo_number || '' };
}

/**
 * Emails the move-out scope change + schedule impact (text builder: Describe.js). Called once by the
 * client right after "Apply to schedule". Stamps move_out_check.impact.email_sent_at.
 */
function apiSendMoveOutEmail(turnId) {
  var rows = sb_('get', 'p03_turns?id=eq.' + encodeURIComponent(turnId || '') + '&select=*');
  if (!rows.length) throw new Error('Turn not found (it may have been deleted).');
  var turn = rows[0];
  if (!turn.move_out_check || !turn.move_out_check.impact) throw new Error('Apply the scope changes to the schedule first, then send.');
  var settingsRows = sb_('get', 'p03_turn_settings?id=eq.config&select=value');
  var mail = buildMoveOutMail(turn, settingsRows.length ? settingsRows[0].value : {}, emailTestTo_());
  var msg = { to: mail.to.join(','), subject: mail.subject, body: mail.text, htmlBody: mail.html };
  if (mail.cc.length) msg.cc = mail.cc.join(',');
  MailApp.sendEmail(msg);
  var sentAt = new Date().toISOString();
  var mo = turn.move_out_check;
  mo.impact.email_sent_at = sentAt;
  sb_('patch', 'p03_turns?id=eq.' + encodeURIComponent(turn.id), { move_out_check: mo });
  return { to: msg.to, cc: msg.cc || '', subject: mail.subject, sentAt: sentAt,
    review: sendConflictReview_(turn, mo.impact, true, settingsRows.length ? settingsRows[0].value : {}) };
}

/**
 * Optional alert when a "No" move-out check is submitted WITHOUT Apply (text builder: Describe.js).
 * Reads move_out_check.pending_impact (the client's preview), stamps pending_impact.alert_sent_at.
 */
function apiSendMoveOutAlert(turnId) {
  var rows = sb_('get', 'p03_turns?id=eq.' + encodeURIComponent(turnId || '') + '&select=*');
  if (!rows.length) throw new Error('Turn not found (it may have been deleted).');
  var turn = rows[0];
  if (!turn.move_out_check || !turn.move_out_check.pending_impact) throw new Error('No scope change preview saved on this turn.');
  var settingsRows = sb_('get', 'p03_turn_settings?id=eq.config&select=value');
  var mail = buildMoveOutAlertMail(turn, settingsRows.length ? settingsRows[0].value : {}, emailTestTo_());
  var msg = { to: mail.to.join(','), subject: mail.subject, body: mail.text, htmlBody: mail.html };
  if (mail.cc.length) msg.cc = mail.cc.join(',');
  MailApp.sendEmail(msg);
  var sentAt = new Date().toISOString();
  var mo = turn.move_out_check;
  mo.pending_impact.alert_sent_at = sentAt;
  sb_('patch', 'p03_turns?id=eq.' + encodeURIComponent(turn.id), { move_out_check: mo });
  return { to: msg.to, cc: msg.cc || '', subject: mail.subject, sentAt: sentAt,
    review: sendConflictReview_(turn, mo.pending_impact, false, settingsRows.length ? settingsRows[0].value : {}) };
}

/**
 * R4.5: separate email to Matt when confirmed vendors move, listing the same vendors' bookings on other
 * open turns. Returns {sentAt}, null when nothing confirmed moved, or {error} (the main email already went).
 */
function sendConflictReview_(turn, impact, applied, settings) {
  try {
    if (!((impact && impact.moved) || []).some(function (m) { return m.was_confirmed; })) return null;
    var others = sb_('get', 'p03_turns?archived=eq.false&select=id,property_label,unit_label,steps,archived');
    var mail = buildConflictReviewMail(turn, impact, applied, others, settings, emailTestTo_());
    if (!mail) return null;
    MailApp.sendEmail({ to: mail.to.join(','), subject: mail.subject, body: mail.text, htmlBody: mail.html });
    return { sentAt: new Date().toISOString() };
  } catch (e) {
    console.error('Conflict review email failed: ' + e.message);
    return { error: e.message };
  }
}

function emailTestTo_() {
  return cleanTestTo(PropertiesService.getScriptProperties().getProperty('EMAIL_TEST_TO'));
}

// ---------- R4.6 Google Calendar sync (event list: calendarEvents in Describe.js) ----------

function calendar_(settings) {
  var id = (settings && settings.calendarId) || 'primary';
  var cal = id === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('Calendar not found: ' + id);
  return cal;
}

function detroitDate_(s) { return Utilities.parseDate(s.length > 10 ? s : s + ' 00:00', TZ, 'yyyy-MM-dd HH:mm'); }

/**
 * Upserts one event per step + rent ready on automation@'s calendar. Mapping stepKey -> {id, h} lives in
 * Script Property cal_<turnId> (not in the turn row, so a client save can't clobber it). Unchanged events
 * (same hash) are skipped unless force. Archived turn = delete all + the key.
 */
function syncTurnCalendar_(turn, settings, force) {
  if (!turn || !turn.id) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var props = PropertiesService.getScriptProperties(), pk = 'cal_' + turn.id;
  var map = JSON.parse(props.getProperty(pk) || '{}');
  try {
    var cal = calendar_(settings);
    var events = turn.archived ? [] : calendarEvents(turn, ScriptApp.getService().getUrl());
    var want = {};
    events.forEach(function (ev) {
      want[ev.key] = true;
      var h = eventHash(ev), old = map[ev.key];
      if (old && old.h === h && !force) return;
      var e = old ? cal.getEventById(old.id) : null;
      var start = detroitDate_(ev.start), end = detroitDate_(ev.end);
      if (e) {
        e.setTitle(ev.title);
        e.setDescription(ev.description);
        if (ev.allDay) e.setAllDayDates(start, end); else e.setTime(start, end);
      } else {
        e = ev.allDay ? cal.createAllDayEvent(ev.title, start, end, { description: ev.description })
          : cal.createEvent(ev.title, start, end, { description: ev.description });
      }
      map[ev.key] = { id: e.getId(), h: h };
    });
    Object.keys(map).forEach(function (k) {
      if (want[k]) return;
      var e = cal.getEventById(map[k].id);
      if (e) e.deleteEvent();
      delete map[k];
    });
  } finally {
    if (Object.keys(map).length) props.setProperty(pk, JSON.stringify(map)); else props.deleteProperty(pk);
    lock.releaseLock();
  }
}

/** Settings for the calendar sync, cached 5 minutes (apiSaveSettings clears it). */
function cachedSettings_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('settings_v1');
  if (hit) return JSON.parse(hit);
  var s = sb_('get', 'p03_turn_settings?id=eq.config&select=value');
  var value = s.length ? s[0].value : {};
  try { cache.put('settings_v1', JSON.stringify(value), 300); } catch (e) { /* too big for cache: fine */ }
  return value;
}

/** Calendar sync that never fails a save: returns '' or the error message (also logged). */
function syncCalendarSafe_(turn) {
  try {
    syncTurnCalendar_(turn, cachedSettings_(), false);
    return '';
  } catch (e) {
    console.error('Calendar sync failed for turn ' + (turn && turn.id) + ': ' + e.message);
    return e.message || String(e);
  }
}

/** Run once from the editor (Code.js) to backfill: syncs every open turn, clears events of turns no longer open. */
function apiSyncAllCalendar() {
  var s = sb_('get', 'p03_turn_settings?id=eq.config&select=value');
  var settings = s.length ? s[0].value : {};
  var turns = sb_('get', 'p03_turns?archived=eq.false&select=*');
  var open = {}, failed = 0;
  turns.forEach(function (t) {
    open[t.id] = true;
    try { syncTurnCalendar_(t, settings, true); } catch (e) { failed++; console.error('Turn ' + t.id + ': ' + e.message); }
  });
  var keys = PropertiesService.getScriptProperties().getKeys().filter(function (k) { return k.indexOf('cal_') === 0 && !open[k.slice(4)]; });
  keys.forEach(function (k) {
    try { syncTurnCalendar_({ id: k.slice(4), archived: true }, settings, true); } catch (e) { failed++; console.error(k + ': ' + e.message); }
  });
  Logger.log('Calendar sync: %s open turns, %s closed turns cleared, %s failed', turns.length, keys.length, failed);
}

/** Run from the editor (Code.js) after setting Script Properties: confirms the tables exist + are granted. */
function checkSetup() {
  var t = sb_('get', 'p03_turns?select=id&limit=1');
  var s = sb_('get', 'p03_turn_settings?select=id&limit=1');
  var p = sb_('get', 'dim_property?select=property_id&limit=1');
  Logger.log('OK: p03_turns rows=%s, settings rows=%s, dim_property reachable=%s', t.length, s.length, p.length > 0);
  // Touches every scope so running this from the editor forces consent for all of them, and proves them.
  var settingsRows = sb_('get', 'p03_turn_settings?id=eq.config&select=value');
  var cal = calendar_(settingsRows.length ? settingsRows[0].value : {});
  Logger.log('Calendar: OK %s', cal.getName());
  Logger.log('Mail quota: %s', MailApp.getRemainingDailyQuota());
  Logger.log('EMAIL_TEST_TO: %s', emailTestTo_() || '(off: real recipients)');
}
