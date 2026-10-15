// GPM Lead Responder — the auto-reply itself
//
// processNewGuestCards() runs every 5 minutes (installResponder() in
// Responder.gs sets that up). For each new AppFolio guest-card email in this
// mailbox it finds the property row and the live listings, then acts on the
// row's Status:
//   Off   → ignored completely: nothing sent, nothing logged
//   Draft → nothing sent (logged only)
//   Test  → the email the prospect WOULD get goes to the PM instead
//   Live  → the email goes to the prospect, with Reply-To set to the PM
// Every decision is written to the ResponderLog tab of the profiles sheet.
// Only guest cards received AFTER installResponder() was first run are
// answered, so turning it on never replies to old leads.

var RESPONDER_LOG_TAB = 'ResponderLog';
var RESPONDER_LOG_HEADER = ['Logged', 'Received', 'Action', 'Property', 'Status', 'SentTo', 'Prospect', 'ProspectEmail',
  'Outcome', 'Unit', 'UnitsShown', 'Bookable', 'Reason', 'Headline', 'MsgId'];
var RESPONDER_SEARCH = 'from:guestcards@appfolio.com newer_than:2d';
var REPEAT_WINDOW_DAYS = 14;  // one auto-reply per prospect per property in this window
var MAX_ERROR_RETRIES = 3;
var RESPONDER_TIME_BUDGET_MS = 4.5 * 60 * 1000;
var ALERT_EMAIL = 'matt@greenpropertymgt.com'; // copied on every "no posted unit" alert
var OFFICE_DAYS = [1, 2, 3, 4, 5];             // Mon-Fri (ISO weekday numbers)
var OFFICE_START_HOUR = 9, OFFICE_END_HOUR = 17; // 9:00-17:00 America/Detroit

function installResponder() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('RESPONDER_START')) props.setProperty('RESPONDER_START', String(Date.now()));
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'processNewGuestCards'; });
  if (!exists) ScriptApp.newTrigger('processNewGuestCards').timeBased().everyMinutes(5).create();
  responderLogSheet_();
  fillBlankDefaults_();
  ensureStatusDropdown_();
  Logger.log('Responder on. Answers guest cards received after ' + new Date(Number(props.getProperty('RESPONDER_START'))) +
    '. Only rows with Status Test or Live send anything.');
}

// Writes code defaults (e.g. ApplicationFee $50) into blank Defaults-tab
// cells so the sheet shows what the emails actually say.
function fillBlankDefaults_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(DEFAULTS_TAB);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  DEFAULTS.forEach(function (d) {
    if (!d[1]) return;
    rows.forEach(function (r, i) {
      if (r[0] === d[0] && String(r[1]).trim() === '') sheet.getRange(i + 2, 2).setValue(d[1]);
    });
  });
}

function uninstallResponder() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processNewGuestCards') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Responder off.');
}

function processNewGuestCards() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // previous run still going
  try {
    var startedAt = Date.now();
    var since = Number(PropertiesService.getScriptProperties().getProperty('RESPONDER_START'));
    if (!since) return;

    var log = responderLogSheet_();
    var history = readResponderHistory_(log);
    var quiet = loadQuietIds_();
    Object.keys(quiet).forEach(function (id) { history.done[id] = true; });
    var profiles = null, listings = null, rows = [];

    var threads = GmailApp.search(RESPONDER_SEARCH, 0, 100);
    var messages = [];
    GmailApp.getMessagesForThreads(threads).forEach(function (msgs) {
      msgs.forEach(function (m) {
        if (m.getDate().getTime() < since) return;
        if (m.getFrom().indexOf('guestcards@appfolio.com') < 0) return;
        if (history.done[m.getId()]) return;
        messages.push(m);
      });
    });
    messages.sort(function (a, b) { return a.getDate() - b.getDate(); });

    for (var i = 0; i < messages.length && Date.now() - startedAt < RESPONDER_TIME_BUDGET_MS; i++) {
      var msg = messages[i];
      try {
        profiles = profiles || loadProfiles_();
        listings = listings || fetchAllListings_();
        var row = handleGuestCard_(msg, profiles, listings, history);
        if (row) rows.push(row); else quiet[msg.getId()] = Date.now();
      } catch (err) {
        rows.push(logRow_(msg, 'ERROR', null, null, {}, '', String(err && err.message || err)));
      }
    }
    saveQuietIds_(quiet);
    if (rows.length) log.getRange(log.getLastRow() + 1, 1, rows.length, RESPONDER_LOG_HEADER.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

function handleGuestCard_(msg, profiles, listings, history) {
  var card = parseGuestCard_(msg.getSubject(), msg.getBody());
  var match = matchCard_(card, listings, profiles.properties);
  var p = match.profile;

  if (match.outcome === 'NO_PROFILE' || match.outcome === 'AMBIGUOUS') return logRow_(msg, 'SKIP', card, match, {}, '', match.reason);
  if (p.Status === 'Off') return null; // no log row; remembered in QUIET_IDS so it isn't re-read
  if (p.Status !== 'Test' && p.Status !== 'Live') return logRow_(msg, 'SKIP', card, match, {}, '', 'Row is ' + (p.Status || 'blank'));
  if (!card.email) return logRow_(msg, 'SKIP', card, match, {}, '', 'No prospect email on the guest card');
  if (p.Status === 'Live' && p.Missing) return logRow_(msg, 'BLOCKED', card, match, {}, '', 'Row is Live but missing: ' + p.Missing);

  var key = card.email + '|' + p.Property;
  var answeredRecently = history.recent[key] && Date.now() - history.recent[key] < REPEAT_WINDOW_DAYS * 864e5;

  // Nothing posted for a property they just inquired about means the listing
  // and the lead don't line up — the PM (and Matt) must look. The prospect
  // only gets the holding reply when the office is closed.
  if (match.outcome === 'NO_VACANCY') {
    var afterHours = !isOfficeHours_(msg.getDate());
    sendNoListingAlert_(p, card, msg, afterHours && !answeredRecently);
    if (!afterHours) return logRow_(msg, 'ALERT', card, match, {}, '', 'No posted unit found; PM alerted, prospect left to the PM (office hours)');
    if (answeredRecently) return logRow_(msg, 'ALERT', card, match, {}, '', 'No posted unit found; PM alerted; prospect already answered recently');
  } else if (answeredRecently) {
    return logRow_(msg, 'SKIP', card, match, {}, '', 'Already answered this prospect for this property in the last ' + REPEAT_WINDOW_DAYS + ' days');
  }

  var mail = renderEmail_(p, profiles, firstName_(card.name), match);
  var to, subject;
  if (p.Status === 'Live') {
    to = card.email;
    subject = mail.subject;
  } else {
    to = p.PMEmail || PREVIEW_FALLBACK_EMAIL;
    subject = '[TEST — would go to ' + card.email + '] ' + mail.subject;
  }
  var options = { htmlBody: mail.html, name: SENDER_NAME };
  if (p.PMEmail) options.replyTo = p.PMEmail;
  GmailApp.sendEmail(to, subject, mail.text, options);
  history.recent[key] = Date.now();

  var action = (match.outcome === 'NO_VACANCY' ? 'ALERT+' : '') + (p.Status === 'Live' ? 'SENT' : 'TEST');
  return logRow_(msg, action, card, match, mail, to,
    match.outcome === 'NO_VACANCY' ? 'No posted unit found; PM alerted; after-hours holding reply sent' : match.reason);
}

// Guest cards for Off rows: handled without a log row, so their IDs are kept
// in a Script Property for a few days (longer than the 2-day search window).
function loadQuietIds_() {
  var raw = PropertiesService.getScriptProperties().getProperty('QUIET_IDS');
  var ids = raw ? JSON.parse(raw) : {};
  var cutoff = Date.now() - 4 * 864e5;
  Object.keys(ids).forEach(function (id) { if (ids[id] < cutoff) delete ids[id]; });
  return ids;
}

function saveQuietIds_(ids) {
  PropertiesService.getScriptProperties().setProperty('QUIET_IDS', JSON.stringify(ids));
}

// Adds "Off" to the Status dropdown of an existing sheet.
function ensureStatusDropdown_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var c = header.indexOf('Status') + 1;
  sheet.getRange(2, c, 99, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS_VALUES, true).build());
  sheet.getRange(1, c).setNote(PROPERTY_HEADER_NOTES.Status);

  // One time: every row still on Draft becomes Off, so nothing is logged
  // for a property until someone deliberately moves it to Draft/Test/Live.
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DRAFT_TO_OFF_DONE')) return;
  var range = sheet.getRange(2, c, sheet.getLastRow() - 1, 1);
  range.setValues(range.getValues().map(function (r) { return [r[0] === 'Draft' ? 'Off' : r[0]]; }));
  props.setProperty('DRAFT_TO_OFF_DONE', '1');
}

function isOfficeHours_(date) {
  var day = Number(Utilities.formatDate(date, 'America/Detroit', 'u'));
  var hour = Number(Utilities.formatDate(date, 'America/Detroit', 'H'));
  return OFFICE_DAYS.indexOf(day) >= 0 && hour >= OFFICE_START_HOUR && hour < OFFICE_END_HOUR;
}

// To the PM, cc Matt: the lead could not be matched to a posted unit, so no
// listing links went out. Test rows tag the subject so nobody chases a test.
function sendNoListingAlert_(p, card, msg, prospectGetsHoldingReply) {
  var to = p.PMEmail || ALERT_EMAIL;
  var subject = (p.Status === 'Test' ? '[TEST] ' : '') + 'Lead not auto-answered: ' + p.Property + ' — no posted unit found';
  var lines = [
    'A guest card came in for ' + p.Property + ', but nothing is posted to the website for it right now,',
    'so the auto-responder could not send listing links.',
    '',
    prospectGetsHoldingReply
      ? 'It came in after hours, so the prospect got a short holding reply saying you will follow up.'
      : 'The prospect has NOT been emailed. Please follow up with them directly.',
    '',
    'Prospect: ' + (card.name || '(no name)'),
    'Email: ' + (card.email || '(none)'),
    'Phone: ' + (card.phone || '(none)'),
    'Card: ' + (card.headline || '') + (card.interestedIn ? ' / ' + card.interestedIn : ''),
    'Source: ' + (card.source || ''),
    'Received: ' + Utilities.formatDate(msg.getDate(), 'America/Detroit', 'EEE M/d h:mm a'),
    'Comments: ' + (card.comments || '(none)'),
    '',
    'If the unit should be posted, post it to the website in AppFolio so the next lead gets links automatically.'
  ];
  var options = { name: SENDER_NAME };
  if (to.toLowerCase() !== ALERT_EMAIL) options.cc = ALERT_EMAIL;
  GmailApp.sendEmail(to, subject, lines.join('\n'), options);
}

function logRow_(msg, action, card, match, mail, sentTo, reason) {
  card = card || {};
  match = match || {};
  return [new Date(), msg.getDate(), action, match.profile ? match.profile.Property : '', match.profile ? match.profile.Status : '',
    sentTo || '', card.name || '', card.email || '', match.outcome || '', match.unit ? match.unit.address : '',
    mail.unitsShown === undefined ? '' : mail.unitsShown, mail.bookable === undefined ? '' : mail.bookable,
    reason || '', card.headline || '', msg.getId()];
}

// done: message IDs already handled (an ERROR counts once it has failed
// MAX_ERROR_RETRIES times). recent: last SENT/TEST time per prospect|property.
function readResponderHistory_(log) {
  var done = {}, errors = {}, recent = {};
  var n = log.getLastRow() - 1;
  if (n > 0) {
    var take = Math.min(n, 5000);
    var col = function (name) { return RESPONDER_LOG_HEADER.indexOf(name); };
    log.getRange(log.getLastRow() - take + 1, 1, take, RESPONDER_LOG_HEADER.length).getValues().forEach(function (r) {
      var id = r[col('MsgId')], action = r[col('Action')];
      if (action === 'ERROR') {
        errors[id] = (errors[id] || 0) + 1;
        if (errors[id] >= MAX_ERROR_RETRIES) done[id] = true;
      } else {
        done[id] = true;
      }
      if (action === 'SENT' || action === 'TEST') {
        var key = String(r[col('ProspectEmail')]).toLowerCase() + '|' + r[col('Property')];
        recent[key] = Math.max(recent[key] || 0, new Date(r[col('Logged')]).getTime());
      }
    });
  }
  return { done: done, recent: recent };
}

function responderLogSheet_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(RESPONDER_LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(RESPONDER_LOG_TAB);
    sheet.getRange(1, 1, 1, RESPONDER_LOG_HEADER.length).setValues([RESPONDER_LOG_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// "chandler unknown" → "Chandler"; anything odd → "there".
function firstName_(name) {
  var first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!/^[A-Za-z][A-Za-z'-]{1,}$/.test(first) || /^unknown$/i.test(first)) return 'there';
  // Keep "JoNisa" as typed; only fix all-lowercase or ALL-CAPS names.
  if (first === first.toLowerCase() || first === first.toUpperCase()) first = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return first;
}
