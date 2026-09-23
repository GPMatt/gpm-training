// GPM Spencer Showing Pre-Screen — Indian Village, Eaglebrook, Grand Central Lofts
//
// Booking-first flow (redesigned 2026-09-23, replaces the old guest-card
// autoresponder that emailed the form as soon as a lead came in):
//
//   1. Prospect books a showing in AppFolio. AppFolio emails Spencer a
//      "New Showing Assignment" (name, date/time, unit — but NO prospect
//      email). A Gmail filter on spencer@ forwards it to automation@.
//   2. showingWatcher (this file, every minute) pairs that showing with the
//      AppFolio guest-card email that arrives alongside it (which DOES carry
//      the prospect's email), then emails the prospect the prefilled
//      pre-screen form (PreScreenForm.js).
//   3. The form submission is scored live against the Requirements tab
//      (PreScreenSubmit.js): Spencer gets a summary, the prospect gets either
//      a confirmation + calendar invite or a cancellation.
//   4. showingWatcher also sweeps open showings: 2h before a showing with no
//      form back, the prospect gets a reminder and Spencer gets a flag.
//
// Guest-card emails are only READ here (as the email lookup) — never replied
// to, marked read, or archived.

// "match" phrases are checked against subject + body text. Each must be unique
// to its property: GPM also manages 2737 Burton St SE (unrelated owner), so
// Indian Village is matched per building number, never a bare "Burton St".
// Eaglebrook is nine buildings on 8th Ave SW (Grandville); showing emails only
// carry the street address, so every building number is listed.
var PROPERTIES = [
  { key: 'INDIAN_VILLAGE', displayName: 'Indian Village Apartments',
    match: ['indian village', '1960 burton', '1966 burton', '1970 burton'] },
  { key: 'EAGLEBROOK', displayName: 'Eaglebrook Apartments',
    match: ['eaglebrook', 'eagle brook', '5943 8th', '5957 8th', '5969 8th', '5979 8th', '5993 8th',
            '5999 8th', '6009 8th', '6025 8th', '6029 8th'] },
  // Guest cards say "Grand Central Lofts" or "100 Commerce" inconsistently —
  // both have to work.
  { key: 'GRAND_CENTRAL_LOFTS', displayName: 'Grand Central Lofts',
    match: ['grand central lofts', '100 commerce'] }
];

var SENDER_NAME = 'Spencer';
var SENDER_SIGNATURE = 'Spencer';
var REPLY_TO_EMAIL = 'spencer@greenpropertymgt.com';
var TIME_ZONE = 'America/Detroit';

var SHOWING_DURATION_MIN = 30;
var REMINDER_LEAD_MIN = 120;          // reminder + Spencer flag this long before the showing
var GUEST_CARD_WAIT_MIN = 30;         // how long a showing waits for its guest card before escalating
var GUEST_CARD_WINDOW_MIN = 60;       // guest card must arrive within this of the showing email

var SHOWINGS_SHEET_NAME = 'Showings';
var SHOWINGS_HEADER = [
  'ShowingMsgId', 'Received', 'ProspectName', 'Email', 'PropertyKey', 'Property', 'Unit',
  'ShowingStart', 'Status', 'FormSentAt', 'ReminderSentAt', 'SpencerFlaggedAt',
  'Result', 'Reason', 'CalendarEventId'
];

// Where Spencer-facing emails (summaries, flags) go. Set the Script Property
// NOTIFY_EMAIL_OVERRIDE (Project Settings → Script Properties) to e.g.
// matt@greenpropertymgt.com while testing so Spencer isn't spammed; delete it
// to go live.
function getNotifyEmail_() {
  var override = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL_OVERRIDE');
  return override || REPLY_TO_EMAIL;
}

function showingWatcher() {
  // Shared script lock — also taken by the form-submit handler, so a submission
  // and a watcher run never write the Showings tab at the same time.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    processNewShowings_();
    sweepOpenShowings_();
  } catch (err) {
    logPreScreenError_('showingWatcher failed: ' + err + (err && err.stack ? ' | ' + err.stack : ''), null);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Step 1 — new showing emails
// ---------------------------------------------------------------------------

function processNewShowings_() {
  // newer_than bounds the rescan cost: non-Spencer showings on 8th Ave etc.
  // match the subject phrases but are skipped in code and left unread.
  var query = 'from:notifications@appfolio.com subject:"New Showing Assignment" is:unread newer_than:2d ' +
    'subject:("Burton" OR "8th Ave" OR "Commerce" OR "Indian Village" OR "Eaglebrook" OR "Grand Central")';
  var threads = GmailApp.search(query, 0, 50);
  if (threads.length === 0) return;

  var handledIds = getHandledShowingIds_();
  var guestCards = null; // loaded lazily, only if an unhandled showing of ours exists

  for (var i = 0; i < threads.length; i++) {
    // Gmail bundles near-identical AppFolio subjects into one thread, so walk
    // every unread message, not just the last.
    var messages = threads[i].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      if (!message.isUnread()) continue;
      if (handledIds[message.getId()]) { message.markRead(); continue; }

      var showing = parseShowingEmail_(message);
      if (!showing) continue; // not one of our three properties — leave it alone

      if (!showing.start) {
        logPreScreenError_('Could not parse date/time from showing email ' + message.getId() + ' (' + message.getSubject() + ')', null);
        continue;
      }

      if (!guestCards) guestCards = loadRecentGuestCards_();
      var card = findGuestCardForShowing_(showing, guestCards);

      if (card) {
        showing.email = card.email;
        if (card.name) showing.guestCardName = card.name;
        sendFormForShowing_(showing);
        message.markRead();
      } else {
        var waitedMin = (new Date() - showing.received) / 60000;
        if (waitedMin >= GUEST_CARD_WAIT_MIN) {
          escalateNoMatch_(showing);
          message.markRead();
        }
        // else: leave unread, try again next minute
      }
    }
  }
}

// Parses the AppFolio "New Showing Assignment" body. Works off the HTML with
// tags stripped (AppFolio's plain-text part isn't guaranteed), one line per
// block element. Returns null if the showing isn't at one of our properties.
function parseShowingEmail_(message) {
  var subject = message.getSubject();
  var text = htmlToText_(message.getBody());
  var property = detectProperty_(subject + '\n' + text);
  if (!property) return null;

  var unitMatch = text.match(/Unit:\s*([^\n]+)/);
  var unitText = unitMatch ? unitMatch[1].trim() : '';

  var nameMatch = text.match(/Prospect:\s*([^\n(]+)/) || text.match(/\n\s*([^\n]+?) has scheduled a showing/);
  var name = nameMatch ? nameMatch[1].trim() : '';

  return {
    msgId: message.getId(),
    received: message.getDate(),
    property: property,
    unitText: unitText,
    unitKey: unitKey_(property.key, unitText),
    name: name,
    start: parseShowingStart_(text)
  };
}

// "Date: Thursday, September 24, 2026" + "Time: 12:30pm EDT". The weekday is
// required in the date pattern so a forwarded-message header ("Date: Wed, Sep
// 23, 2026 at 10:50AM") can never be picked up by mistake. All three
// properties are in Michigan, so the script's own time zone (America/Detroit)
// is the showing's time zone.
function parseShowingStart_(text) {
  var d = text.match(/Date:\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  var t = text.match(/Time:\s*(\d{1,2}):(\d{2})\s*([ap]m)/i);
  if (!d || !t) return null;

  var months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
                'september', 'october', 'november', 'december'];
  var month = months.indexOf(d[1].toLowerCase());
  if (month === -1) return null;

  var hour = parseInt(t[1], 10) % 12;
  if (t[3].toLowerCase() === 'pm') hour += 12;
  return new Date(parseInt(d[3], 10), month, parseInt(d[2], 10), hour, parseInt(t[2], 10));
}

// Normalizes a unit reference to one key per physical unit, so the showing's
// "5993 8th Ave SW, Apt C" and the guest card's "5993C" compare equal.
// Formats confirmed from live emails 2026-09-23:
//   GCL        showing "100 Commerce Ave SW - 202"          guest card "Grand Central Lofts - 202"
//   Eaglebrook showing "5993 8th Ave SW, Apt C"             guest card "Eaglebrook Apartments - 5993C"
//   IV         showing "1966 Burton St SE Apt 32"           guest card "1966 IVA32"
//              showing "1960 Burton St SE - 1960 IVA05 Apt 05"
function unitKey_(propertyKey, text) {
  if (!text) return '';
  var m;
  if (propertyKey === 'INDIAN_VILLAGE') {
    m = text.match(/(1960|1966|1970)\s*IVA\s*0*(\d+)/i) || text.match(/(1960|1966|1970)\s+Burton[^\n]*?Apt\.?\s*#?\s*0*(\d+)/i);
    return m ? m[1] + '-' + m[2] : '';
  }
  if (propertyKey === 'EAGLEBROOK') {
    m = text.match(/(\d{4})\s+8th\s+Ave[^\n]*?(?:Apt|Unit|#)\.?\s*#?\s*([A-H])\b/i) || text.match(/\b(\d{4})\s*([A-H])\b/);
    return m ? m[1] + m[2].toUpperCase() : '';
  }
  if (propertyKey === 'GRAND_CENTRAL_LOFTS') {
    m = text.match(/Commerce\s+Ave(?:nue)?\s+SW\s*(?:-|,)?\s*(?:unit|apt|#)?\.?\s*#?\s*(\d{3})\b/i) ||
        text.match(/Lofts\s*-\s*(\d{3})\b/i);
    return m ? m[1] : '';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Step 2 — pair the showing with its guest card (for the prospect's email)
// ---------------------------------------------------------------------------

function loadRecentGuestCards_() {
  var threads = GmailApp.search('from:guestcards@appfolio.com newer_than:2d', 0, 100);
  var cards = [];
  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var text = msg.getSubject() + '\n' + htmlToText_(msg.getBody());
      var property = detectProperty_(text);
      if (!property) continue;

      var email = extractEmail_(msg.getReplyTo()) || extractProspectEmailFromBody_(text);
      if (!email) continue;

      cards.push({
        date: msg.getDate(),
        property: property,
        // Subject first — it names the specific unit; the body can mention others.
        unitKey: unitKey_(property.key, msg.getSubject()) || unitKey_(property.key, text),
        name: msg.getFrom().split('<')[0].replace(/"/g, '').trim(),
        email: email
      });
    }
  }
  return cards;
}

// Same property + same unit + arrived within the window is the primary match.
// Name is only a fallback, and only loosely compared — the same person has
// shown up as "Matt Fournier" on a showing and "Matthieu Fournier" on the guest
// card. When several candidates tie, the one closest in time wins.
function findGuestCardForShowing_(showing, cards) {
  var windowMs = GUEST_CARD_WINDOW_MIN * 60000;
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (c.property.key !== showing.property.key) continue;
    var gap = Math.abs(c.date - showing.received);
    if (gap > windowMs) continue;

    var unitHit = showing.unitKey && c.unitKey && showing.unitKey === c.unitKey;
    var nameHit = namesLooselyMatch_(showing.name, c.name);
    if (!unitHit && !nameHit) continue;

    // unit+name > unit > name, then closer in time
    var score = (unitHit ? 2 : 0) + (nameHit ? 1 : 0) + (1 - gap / windowMs) * 0.5;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

function namesLooselyMatch_(a, b) {
  var pa = normalizeName_(a), pb = normalizeName_(b);
  if (pa.length < 2 || pb.length < 2) return false;
  if (pa[pa.length - 1] !== pb[pb.length - 1]) return false; // last names must agree
  return pa[0].indexOf(pb[0]) === 0 || pb[0].indexOf(pa[0]) === 0; // "matt" vs "matthieu"
}

function normalizeName_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (x) { return x; });
}

// ---------------------------------------------------------------------------
// Step 3 — send the form, record the showing
// ---------------------------------------------------------------------------

function sendFormForShowing_(showing) {
  var name = showing.guestCardName || showing.name;
  var firstName = firstNameOf_(name);
  var when = formatShowingTime_(showing.start);
  var formUrl = buildPrescreenUrl_(name, showing.email, showing.property.displayName);

  var subject = 'Confirm your showing at ' + showing.property.displayName + ' — ' + when;
  var htmlBody = `
    Hi ${firstName},<br><br>
    Thanks for booking a showing at ${showing.property.displayName}!<br><br>
    📅 ${when}<br>
    📍 ${escapeHtml_(showing.unitText)}<br><br>
    To confirm your showing, please take two minutes to fill out this quick pre-screening form before your appointment:<br><br>
    <strong><a href="${formUrl}">COMPLETE YOUR PRE-SCREENING</a></strong><br><br>
    Once we've reviewed it, we'll send your confirmation.<br><br>
    Thanks,<br>
    ${SENDER_SIGNATURE}<br>
    Green Property Management
  `;
  GmailApp.sendEmail(showing.email, subject, '', { htmlBody: htmlBody, name: SENDER_NAME, replyTo: REPLY_TO_EMAIL });

  var now = new Date();
  var row = {
    ShowingMsgId: showing.msgId, Received: showing.received, ProspectName: name, Email: showing.email,
    PropertyKey: showing.property.key, Property: showing.property.displayName, Unit: showing.unitText,
    ShowingStart: showing.start, Status: 'FORM_SENT', FormSentAt: now
  };

  // Booked too close to the showing for a normal reminder — tell Spencer now
  // that the pre-screen may not be back in time, and skip the prospect
  // reminder (they literally just got the form).
  if (showing.start - now < REMINDER_LEAD_MIN * 60000) {
    notifySpencer_('⚠️ SHORT NOTICE — ' + name + ' — ' + showing.property.displayName + ' ' + when,
      'This showing was booked less than ' + (REMINDER_LEAD_MIN / 60) + ' hours out. The pre-screen form was sent, ' +
      'but the answers may not come back before the showing — check your email before heading out.',
      row);
    row.ReminderSentAt = 'skipped (short notice)';
    row.SpencerFlaggedAt = now;
  }

  appendShowingRow_(row);
}

function escalateNoMatch_(showing) {
  var when = showing.start ? formatShowingTime_(showing.start) : '(unknown time)';
  var row = {
    ShowingMsgId: showing.msgId, Received: showing.received, ProspectName: showing.name, Email: '',
    PropertyKey: showing.property.key, Property: showing.property.displayName, Unit: showing.unitText,
    ShowingStart: showing.start, Status: 'NO_MATCH', SpencerFlaggedAt: new Date(),
    Reason: 'no matching guest card within ' + GUEST_CARD_WAIT_MIN + ' min'
  };
  notifySpencer_('❓ NO EMAIL FOUND — ' + showing.name + ' — ' + showing.property.displayName + ' ' + when,
    'A showing was booked, but no matching AppFolio guest card arrived, so the automation has no email address ' +
    'for this prospect and did NOT send the pre-screen form. Please pre-screen them manually ' +
    '(the guest card link is in the original AppFolio showing email).',
    row);
  appendShowingRow_(row);
}

// ---------------------------------------------------------------------------
// Step 4 — reminder + Spencer flag, 2h before showings with no form back
// ---------------------------------------------------------------------------

function sweepOpenShowings_() {
  var sheet = getOrCreateShowingsSheet_();
  var data = sheet.getDataRange().getValues();
  var col = headerIndex_(data[0]);
  var now = new Date();

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (row[col.Status] !== 'FORM_SENT' || row[col.ReminderSentAt]) continue;
    var start = row[col.ShowingStart];
    if (!(start instanceof Date)) continue;
    var minsOut = (start - now) / 60000;
    if (minsOut > REMINDER_LEAD_MIN || minsOut <= 0) continue;

    var rec = rowToObject_(data[0], row);
    var when = formatShowingTime_(start);
    var firstName = firstNameOf_(rec.ProspectName);
    var formUrl = buildPrescreenUrl_(rec.ProspectName, rec.Email, rec.Property);

    GmailApp.sendEmail(rec.Email, 'Reminder: pre-screening needed for your ' + rec.Property + ' showing', '', {
      htmlBody: `
        Hi ${firstName},<br><br>
        Just a reminder — we still need your quick pre-screening form before your showing at ${rec.Property} (${when}).<br><br>
        <strong><a href="${formUrl}">COMPLETE YOUR PRE-SCREENING</a></strong><br><br>
        Thanks,<br>
        ${SENDER_SIGNATURE}<br>
        Green Property Management
      `,
      name: SENDER_NAME, replyTo: REPLY_TO_EMAIL
    });

    notifySpencer_('⏳ NO PRE-SCREEN YET — ' + rec.ProspectName + ' — ' + rec.Property + ' ' + when,
      'This prospect hasn\'t submitted the pre-screening form and the showing is about ' + Math.round(minsOut) +
      ' minutes away. A reminder was just sent to them. Your call whether to keep the showing.',
      rec);

    sheet.getRange(r + 1, col.ReminderSentAt + 1).setValue(now);
    sheet.getRange(r + 1, col.SpencerFlaggedAt + 1).setValue(now);
  }
}

// ---------------------------------------------------------------------------
// Showings tab helpers (lives in the "GPM Pre-Screening Responses" spreadsheet)
// ---------------------------------------------------------------------------

function getOrCreateShowingsSheet_() {
  var ss = SpreadsheetApp.openById(getPreScreenResponsesSpreadsheetId_());
  var sheet = ss.getSheetByName(SHOWINGS_SHEET_NAME);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHOWINGS_SHEET_NAME);
  sheet.appendRow(SHOWINGS_HEADER);
  sheet.setFrozenRows(1);
  return sheet;
}

function appendShowingRow_(obj) {
  var sheet = getOrCreateShowingsSheet_();
  sheet.appendRow(SHOWINGS_HEADER.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function getHandledShowingIds_() {
  var data = getOrCreateShowingsSheet_().getDataRange().getValues();
  var ids = {};
  for (var r = 1; r < data.length; r++) ids[data[r][0]] = true;
  return ids;
}

// Returns { rowNumber, record } for the prospect's open (FORM_SENT) showing,
// preferring one at the same property, then the most recently booked.
function findOpenShowingForEmail_(email, propertyDisplayName) {
  var sheet = getOrCreateShowingsSheet_();
  var data = sheet.getDataRange().getValues();
  var col = headerIndex_(data[0]);
  var target = String(email).trim().toLowerCase();
  var best = null;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (row[col.Status] !== 'FORM_SENT') continue;
    if (String(row[col.Email]).trim().toLowerCase() !== target) continue;
    var sameProperty = row[col.Property] === propertyDisplayName;
    var received = row[col.Received] instanceof Date ? row[col.Received].getTime() : 0;
    var score = (sameProperty ? 1e15 : 0) + received;
    if (!best || score > best.score) best = { score: score, rowNumber: r + 1, record: rowToObject_(data[0], row) };
  }
  return best;
}

function updateShowingRow_(rowNumber, updates) {
  var sheet = getOrCreateShowingsSheet_();
  var col = headerIndex_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  for (var key in updates) {
    if (col[key] === undefined) continue;
    sheet.getRange(rowNumber, col[key] + 1).setValue(updates[key]);
  }
}

function headerIndex_(header) {
  var col = {};
  for (var c = 0; c < header.length; c++) col[header[c]] = c;
  return col;
}

function rowToObject_(header, row) {
  var obj = {};
  for (var c = 0; c < header.length; c++) obj[header[c]] = row[c];
  return obj;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Builds a prefilled link into the pre-screen form (PreScreenForm.js). Falls
// back to the bare form URL if the form hasn't been built yet.
function buildPrescreenUrl_(fullName, email, propertyDisplayName) {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty('PRESCREEN_PUBLISHED_URL');
  var entryName = props.getProperty('PRESCREEN_ENTRY_NAME');
  var entryEmail = props.getProperty('PRESCREEN_ENTRY_EMAIL');
  var entryProperty = props.getProperty('PRESCREEN_ENTRY_PROPERTY');

  if (!baseUrl || !entryName || !entryEmail || !entryProperty) {
    return baseUrl || 'https://forms.google.com/';
  }

  return baseUrl + '?usp=pp_url'
    + '&entry.' + entryName + '=' + encodeURIComponent(fullName)
    + '&entry.' + entryEmail + '=' + encodeURIComponent(email)
    + '&entry.' + entryProperty + '=' + encodeURIComponent(propertyDisplayName);
}

// Returns the matching PROPERTIES entry, or null. Every caller re-checks with
// this before touching a message, so a loose Gmail search match never causes
// another property's email to be marked read.
function detectProperty_(text) {
  var lower = String(text).toLowerCase();
  for (var i = 0; i < PROPERTIES.length; i++) {
    var prop = PROPERTIES[i];
    for (var j = 0; j < prop.match.length; j++) {
      if (lower.indexOf(prop.match[j]) !== -1) return prop;
    }
  }
  return null;
}

function htmlToText_(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|h\d|tr|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ *\n */g, '\n');
}

function extractEmail_(s) {
  var m = String(s || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (!m) return '';
  return /@(appfolio\.com|.*sendgrid\.net)$/i.test(m[0]) ? '' : m[0];
}

// Guest-card bodies list the prospect's email right under CONTACT INFO.
function extractProspectEmailFromBody_(text) {
  var section = String(text).split(/CONTACT INFO/i)[1] || '';
  var re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, m;
  while ((m = re.exec(section)) !== null) {
    if (!/@(appfolio\.com|.*sendgrid\.net)$/i.test(m[0])) return m[0];
  }
  return '';
}

function formatShowingTime_(date) {
  return Utilities.formatDate(date, TIME_ZONE, "EEE, MMM d 'at' h:mm a");
}

function firstNameOf_(name) {
  var first = String(name || '').trim().split(/\s+/)[0];
  return first && first.indexOf('@') === -1 ? first : 'there';
}

function escapeHtml_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Setup — run installShowingWorkflow() ONCE from the Apps Script editor
// (Code.gs → function dropdown → installShowingWorkflow → Run). Safe to re-run:
// it removes the OLD guest-card autoResponder trigger, then (re)creates the
// every-minute showingWatcher trigger and the form-submit trigger without
// stacking duplicates.
// ---------------------------------------------------------------------------

function installShowingWorkflow() {
  deleteTriggersFor_('autoResponder');   // old flow, retired 2026-09-23
  deleteTriggersFor_('showingWatcher');
  ScriptApp.newTrigger('showingWatcher').timeBased().everyMinutes(1).create();
  createPreScreenSubmitTrigger();
  getOrCreateShowingsSheet_();
  Logger.log('Installed: showingWatcher (every 1 min) + onPreScreenSubmit_ (form submit). Old autoResponder trigger removed.');
}

function deleteTriggersFor_(handlerName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(triggers[i]);
  }
}
