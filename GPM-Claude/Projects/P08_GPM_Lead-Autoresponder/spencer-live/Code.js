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
//      pre-screen form (PreScreenForm.js). No card alongside → the prospect's
//      most recent guest card at that property from the last 30 days is used.
//      Still nothing (always the case when staff book the showing themselves —
//      AppFolio sends no guest-card email for those) → Spencer gets a
//      [NEED EMAIL] alert and can reply to it with the prospect's email; the
//      watcher picks the reply up and sends the form.
//   3. The form submission is scored live against the Requirements tab
//      (PreScreenSubmit.js): Spencer gets a summary, the prospect gets either
//      a confirmation or a cancellation.
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

var REMINDER_LEAD_MIN = 120;          // reminder + Spencer flag this long before the showing
var GUEST_CARD_WAIT_MIN = 30;         // how long a showing waits for its guest card before escalating
var GUEST_CARD_WINDOW_MIN = 60;       // guest card must arrive within this of the showing email
var GUEST_CARD_LOOKBACK_DAYS = 30;    // fallback: prospect's own earlier guest card, matched by name
var AUTOMATION_EMAIL = 'automation@greenpropertymgt.com';
var STAFF_EMAIL_DOMAIN = 'greenpropertymgt.com'; // only replies from here can supply a prospect email
var ERROR_ALERT_EMAIL = 'matt@greenpropertymgt.com'; // every Errors-tab entry is also emailed here...
var ERROR_ALERTS_PER_DAY = 5;                        // ...up to this many a day

var SHOWINGS_SHEET_NAME = 'Showings';
var SHOWINGS_HEADER = [
  'ShowingMsgId', 'Received', 'ProspectName', 'Email', 'PropertyKey', 'Property', 'Unit',
  'ShowingStart', 'Status', 'FormSentAt', 'ReminderSentAt', 'SpencerFlaggedAt',
  'Result', 'Reason'
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
    // Each step is isolated so a failure in one never starves the others.
    runWatcherStep_('processNewShowings_', processNewShowings_);
    runWatcherStep_('processEmailReplies_', processEmailReplies_);
    runWatcherStep_('processBounces_', processBounces_);
    runWatcherStep_('sweepOpenShowings_', sweepOpenShowings_);
  } finally {
    lock.releaseLock();
  }
}

function runWatcherStep_(name, fn) {
  try {
    fn();
  } catch (err) {
    logPreScreenError_(name + ' failed: ' + err + (err && err.stack ? ' | ' + err.stack : ''), null);
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

  var ctx = { known: loadKnownShowings_(), guestCards: null }; // cards load lazily, only if an unhandled showing of ours exists

  for (var i = 0; i < threads.length; i++) {
    // Gmail bundles near-identical AppFolio subjects into one thread, so walk
    // every unread message, not just the last.
    var messages = threads[i].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      if (!message.isUnread()) continue;
      // One showing failing must never block the ones behind it.
      try {
        handleShowingMessage_(message, ctx);
      } catch (err) {
        logPreScreenError_('Showing email ' + message.getId() + ' (' + message.getSubject() + ') failed: ' + err +
          (err && err.stack ? ' | ' + err.stack : ''), null);
        // Left unread, so it is retried next minute — but only while it's
        // fresh. After that it is handed to Spencer rather than retried (and
        // logged) every minute for two days.
        if ((new Date() - message.getDate()) / 60000 >= GUEST_CARD_WAIT_MIN) {
          giveUpOnShowing_(message, 'ERROR', 'automation error: ' + err);
        }
      }
    }
  }
}

function handleShowingMessage_(message, ctx) {
  var known = ctx.known;
  if (known.ids[message.getId()]) { message.markRead(); return; }

  var showing = parseShowingEmail_(message);
  if (!showing) return; // not one of our three properties — leave it alone

  if (!showing.start) {
    // Deterministic — retrying won't help. Hand it over once.
    logPreScreenError_('Could not parse date/time from showing email ' + message.getId() + ' (' + message.getSubject() + ')', null);
    giveUpOnShowing_(message, 'UNPARSED', 'could not read the showing date/time from the AppFolio email', showing);
    known.ids[message.getId()] = true;
    return;
  }

  // AppFolio re-sends the assignment when the same showing is assigned
  // again — same prospect, property and time is not a new showing.
  var key = showingKey_(showing.name, showing.property.key, showing.start);
  if (known.keys[key]) { message.markRead(); return; }

  if (!ctx.guestCards) ctx.guestCards = loadRecentGuestCards_();
  var card = findGuestCardForShowing_(showing, ctx.guestCards) || findGuestCardByName_(showing);

  if (card) {
    showing.email = card.email;
    if (card.name) showing.guestCardName = card.name;
    sendFormForShowing_(showing);
    message.markRead();
    known.keys[key] = true;
    return;
  }

  // Staff-booked showings never produce a guest-card email, so there is
  // nothing to wait for.
  var waitedMin = (new Date() - showing.received) / 60000;
  if (showing.staffBooked || waitedMin >= GUEST_CARD_WAIT_MIN) {
    escalateNoMatch_(showing);
    message.markRead();
    known.keys[key] = true;
  }
  // else: leave unread, try again next minute
}

// Stops processing a showing email the automation can't handle: records it,
// tells Spencer once, and marks it read so it is never picked up again.
// Best-effort throughout — this runs when something has already gone wrong.
function giveUpOnShowing_(message, status, reason, showing) {
  var row = {
    ShowingMsgId: message.getId(), Received: message.getDate(),
    ProspectName: showing ? showing.name : '', Email: '',
    PropertyKey: showing ? showing.property.key : '', Property: showing ? showing.property.displayName : '',
    Unit: showing ? showing.unitText : '', ShowingStart: showing && showing.start ? showing.start : '',
    Status: status, SpencerFlaggedAt: new Date(), Reason: reason
  };
  try { appendShowingRow_(row); } catch (e1) { Logger.log('giveUpOnShowing_ row failed: ' + e1); }
  try {
    notifySpencer_('[NOT PROCESSED] ' + message.getSubject(),
      'The automation could not process this AppFolio showing email (' + reason + '), so no pre-screen form was ' +
      'sent. Please handle this prospect manually — the details are in the original AppFolio showing email.',
      row);
  } catch (e2) { Logger.log('giveUpOnShowing_ notify failed: ' + e2); }
  try { message.markRead(); } catch (e3) { Logger.log('giveUpOnShowing_ markRead failed: ' + e3); }
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
    start: parseShowingStart_(text),
    // "<staff name> assigned you the following showing" = booked by hand in
    // AppFolio. "System assigned you" is a Zillow tour and "<prospect> has
    // scheduled a showing" is self-booked — both of those DO get a guest card.
    staffBooked: /assigned you the following showing/i.test(text) && !/\bSystem assigned you/i.test(text)
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
      var card = parseGuestCard_(messages[m]);
      if (card) cards.push(card);
    }
  }
  return cards;
}

// Returns null unless the card is for one of our properties and carries the
// prospect's email.
function parseGuestCard_(msg) {
  var text = msg.getSubject() + '\n' + htmlToText_(msg.getBody());
  var property = detectProperty_(text);
  if (!property) return null;

  var email = extractEmail_(msg.getReplyTo()) || extractProspectEmailFromBody_(text);
  if (!email) return null;

  return {
    date: msg.getDate(),
    property: property,
    // Subject first — it names the specific unit; the body can mention others.
    unitKey: unitKey_(property.key, msg.getSubject()) || unitKey_(property.key, text),
    name: msg.getFrom().split('<')[0].replace(/"/g, '').trim(),
    email: email
  };
}

// Same property + same name + arrived within the window. The name is always
// required: units like GCL 209 get several inquiries a day, so a unit-only
// match would hand the form to whoever else asked about that unit in the same
// hour. The unit only breaks ties between two cards for the same name, then
// the one closest in time wins.
function findGuestCardForShowing_(showing, cards) {
  var windowMs = GUEST_CARD_WINDOW_MIN * 60000;
  var best = null;
  var bestScore = -1;

  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    if (c.property.key !== showing.property.key) continue;
    var gap = Math.abs(c.date - showing.received);
    if (gap > windowMs) continue;
    if (!namesLooselyMatch_(showing.name, c.name)) continue;

    var unitHit = showing.unitKey && c.unitKey && showing.unitKey === c.unitKey;
    var score = (unitHit ? 1 : 0) + (1 - gap / windowMs) * 0.5;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// Fallback when nothing arrived alongside the showing: AppFolio doesn't always
// send a fresh guest card at booking time (a prospect who inquired through
// Zillow yesterday and books today gets none), so use that prospect's most
// recent card at the same property. Name is the only link available — the
// showing email carries no prospect email or phone.
function findGuestCardByName_(showing) {
  var parts = normalizeName_(showing.name);
  if (parts.length < 2) return null;

  var threads = GmailApp.search('from:guestcards@appfolio.com "' + parts[parts.length - 1] + '" newer_than:' +
    GUEST_CARD_LOOKBACK_DAYS + 'd', 0, 30);
  var best = null;
  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var card = parseGuestCard_(messages[m]);
      if (!card || card.property.key !== showing.property.key) continue;
      if (!namesLooselyMatch_(showing.name, card.name)) continue;
      if (!best || card.date > best.date) best = card;
    }
  }
  return best;
}

function namesLooselyMatch_(a, b) {
  var pa = normalizeName_(a), pb = normalizeName_(b);
  if (pa.length < 2 || pb.length < 2) return false;
  if (pa[pa.length - 1] !== pb[pb.length - 1]) return false; // last names must agree
  if (pa[0] === pb[0]) return true;
  // "matt" vs "matthieu" — but the short form needs 4+ letters, so "al" can't
  // stand in for "alex" or "alicia". A miss just means Spencer is asked.
  var shorter = pa[0].length <= pb[0].length ? pa[0] : pb[0];
  var longer = pa[0].length <= pb[0].length ? pb[0] : pa[0];
  return shorter.length >= 4 && longer.indexOf(shorter) === 0;
}

function normalizeName_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (x) { return x; });
}

// ---------------------------------------------------------------------------
// Step 3 — send the form, record the showing
// ---------------------------------------------------------------------------

// rowNumber: pass the existing Showings row when the form is going out late
// for a NO_MATCH showing (Spencer supplied the email) — that row is updated
// instead of a second one being added.
//
// Order matters: the row is written BEFORE the email goes out. If the write
// came second and failed, the showing would look unhandled and the prospect
// would get the same email again every minute. A failed send is recorded on
// the row (SEND_FAILED) and reported — never retried blindly.
function sendFormForShowing_(showing, rowNumber) {
  var name = showing.guestCardName || showing.name;
  var when = formatShowingTime_(showing.start);
  // Throws if the form can't be opened — nothing is recorded yet, so the
  // caller simply tries again next minute.
  var mail = buildFormEmail_(name, showing.email, showing.property.displayName, when, showing.unitText);

  var now = new Date();
  var shortNotice = showing.start - now < REMINDER_LEAD_MIN * 60000;
  var row = {
    ShowingMsgId: showing.msgId, Received: showing.received, ProspectName: name, Email: showing.email,
    PropertyKey: showing.property.key, Property: showing.property.displayName, Unit: showing.unitText,
    ShowingStart: showing.start, Status: 'FORM_SENT', FormSentAt: now,
    // Booked too close to the showing for a normal reminder (they literally
    // just got the form).
    ReminderSentAt: shortNotice ? 'skipped (short notice)' : ''
  };

  if (rowNumber) {
    updateShowingRow_(rowNumber, { Email: row.Email, Status: row.Status, FormSentAt: row.FormSentAt,
      ReminderSentAt: row.ReminderSentAt, Reason: '' });
  } else {
    rowNumber = appendShowingRow_(row);
  }

  try {
    GmailApp.sendEmail(showing.email, mail.subject, '', { htmlBody: mail.htmlBody, name: SENDER_NAME, replyTo: REPLY_TO_EMAIL });
  } catch (err) {
    updateShowingRow_(rowNumber, { Status: 'SEND_FAILED', Reason: 'form email failed: ' + err, SpencerFlaggedAt: now });
    logPreScreenError_('Form email to ' + showing.email + ' failed: ' + err, null);
    notifySpencer_('[FORM NOT SENT] ' + name + ' — ' + showing.property.displayName + ' ' + when,
      'The pre-screen form could not be emailed to this prospect (' + err + '). The address may be wrong in AppFolio. ' +
      'Please pre-screen them manually.', row);
    return false;
  }

  if (shortNotice) {
    notifySpencer_('[SHORT NOTICE] ' + name + ' — ' + showing.property.displayName + ' ' + when,
      'This showing was booked less than ' + (REMINDER_LEAD_MIN / 60) + ' hours out. The pre-screen form was sent, ' +
      'but the answers may not come back before the showing — check your email before heading out.',
      row);
    updateShowingRow_(rowNumber, { SpencerFlaggedAt: now });
  }
  return true;
}

function buildFormEmail_(name, email, propertyDisplayName, when, unitText) {
  var formUrl = buildPrescreenUrl_(name, email, propertyDisplayName);
  return {
    subject: 'Confirm your showing at ' + propertyDisplayName + ' — ' + when,
    htmlBody: `
    Hi ${firstNameOf_(name)},<br><br>
    Thanks for booking a showing at ${propertyDisplayName}!<br><br>
    <b>Date:</b> ${when}<br>
    <b>Location:</b> ${escapeHtml_(unitText)}<br><br>
    To confirm your showing, please take two minutes to fill out this quick pre-screening form before your appointment:<br><br>
    <strong><a href="${formUrl}">COMPLETE YOUR PRE-SCREENING</a></strong><br><br>
    Once we've reviewed it, we'll send your confirmation.<br><br>
    Thanks,<br>
    ${SENDER_SIGNATURE}<br>
    Green Property Management
  `
  };
}

function escalateNoMatch_(showing) {
  var when = showing.start ? formatShowingTime_(showing.start) : '(unknown time)';
  var row = {
    ShowingMsgId: showing.msgId, Received: showing.received, ProspectName: showing.name, Email: '',
    PropertyKey: showing.property.key, Property: showing.property.displayName, Unit: showing.unitText,
    ShowingStart: showing.start, Status: 'NO_MATCH', SpencerFlaggedAt: new Date(),
    Reason: showing.staffBooked
      ? 'booked by staff in AppFolio — no guest-card email is sent for those'
      : 'no guest card in the last ' + GUEST_CARD_LOOKBACK_DAYS + ' days'
  };
  var why = showing.staffBooked
    ? 'This showing was booked by staff in AppFolio. AppFolio doesn\'t email a guest card for those, so the ' +
      'automation has no email address for this prospect and did NOT send the pre-screen form.'
    : 'A showing was booked, but AppFolio sent no guest card for this prospect, so the automation has no email ' +
      'address for them and did NOT send the pre-screen form.';
  appendShowingRow_(row); // before the email, so a failed write can't cause repeat alerts
  // The subject is how processEmailReplies_ ties a reply back to this showing
  // (prospect name + showing time) — keep both in it.
  notifySpencer_('[NEED EMAIL] ' + showing.name + ' — ' + showing.property.displayName + ' ' + when,
    why + ' Want them pre-screened? Reply to this email with the prospect\'s email address and the form will be ' +
    'sent to them automatically. Otherwise no action is needed.',
    row);
}

// Spencer replies to a [NEED EMAIL] alert with the prospect's address → send
// the form for that showing. Replies land in this mailbox because the alert
// is sent from it.
function processEmailReplies_() {
  var threads = GmailApp.search('subject:("NEED EMAIL" OR "NO EMAIL FOUND") is:unread newer_than:30d', 0, 20);
  if (threads.length === 0) return;

  var sheet = getOrCreateShowingsSheet_();
  var data = sheet.getDataRange().getValues();
  var col = headerIndex_(data[0]);
  var now = new Date();

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      if (!msg.isUnread()) continue;

      // Only staff can point the automation at an address.
      var from = extractEmail_(msg.getFrom()).toLowerCase();
      if (from === AUTOMATION_EMAIL || from.split('@')[1] !== STAFF_EMAIL_DOMAIN) continue;

      var subject = msg.getSubject();
      var rowNumber = 0;
      for (var r = 1; r < data.length; r++) {
        var start = data[r][col.ShowingStart];
        if (data[r][col.Status] !== 'NO_MATCH' || !(start instanceof Date)) continue;
        if (subject.indexOf(String(data[r][col.ProspectName])) === -1) continue;
        if (subject.indexOf(formatShowingTime_(start)) === -1) continue;
        rowNumber = r + 1;
        break;
      }
      // Read first: whatever happens below, one reply is acted on once.
      msg.markRead();
      if (!rowNumber) continue; // already handled, or not one of ours

      try {
        var rec = rowToObject_(data[0], data[rowNumber - 1]);
        var email = extractEmailFromReply_(msg.getPlainBody(), from);
        if (!email) {
          msg.reply('I couldn\'t find an email address in your reply, so nothing was sent to ' + rec.ProspectName +
            '. Reply again with just their email address.', { name: 'Showing Pre-Screen' });
          continue;
        }
        if (rec.ShowingStart <= now) {
          msg.reply('That showing time has already passed, so nothing was sent to ' + email + '.', { name: 'Showing Pre-Screen' });
          continue;
        }

        data[rowNumber - 1][col.Status] = 'FORM_SENT'; // a second reply in this run must not send again
        var sent = sendFormForShowing_({
          msgId: rec.ShowingMsgId, received: rec.Received, name: rec.ProspectName, email: email,
          property: { key: rec.PropertyKey, displayName: rec.Property }, unitText: rec.Unit, start: rec.ShowingStart
        }, rowNumber);
        if (sent) msg.reply('Sent the pre-screen form to ' + email + '.', { name: 'Showing Pre-Screen' });
      } catch (err) {
        logPreScreenError_('Reply ' + msg.getId() + ' (' + subject + ') failed: ' + err, null);
        try {
          msg.reply('Something went wrong and the form was NOT sent (' + err + '). Please pre-screen this prospect manually.',
            { name: 'Showing Pre-Screen' });
        } catch (replyErr) { Logger.log('reply failed: ' + replyErr); }
      }
    }
  }
}

// First address in what the sender actually typed — everything from the
// quoted original down is ignored, as are our own addresses (signatures).
function extractEmailFromReply_(plainBody, senderEmail) {
  var typed = String(plainBody || '').split(/\n\s*(?:On .*wrote:|>|-{2,} ?(?:Original|Forwarded) message|From:)/i)[0];
  var re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, m;
  while ((m = re.exec(typed)) !== null) {
    var found = m[0].toLowerCase();
    if (found === senderEmail || found === AUTOMATION_EMAIL || found === REPLY_TO_EMAIL.toLowerCase()) continue;
    return m[0];
  }
  return '';
}

// A form or reminder that bounces means the address on the guest card is
// wrong, and nobody reads this mailbox — so tell Spencer. Only bounces that
// name a prospect on the Showings tab are touched; this mailbox is shared with
// other automations, and their bounces are left exactly as they are.
function processBounces_() {
  var threads = GmailApp.search('from:(mailer-daemon OR postmaster) is:unread newer_than:3d', 0, 10);
  if (threads.length === 0) return;

  var sheet = getOrCreateShowingsSheet_();
  var data = sheet.getDataRange().getValues();
  var col = headerIndex_(data[0]);

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      if (!msg.isUnread()) continue;
      var body = (msg.getSubject() + '\n' + msg.getPlainBody()).toLowerCase();

      for (var r = data.length - 1; r >= 1; r--) {
        var email = String(data[r][col.Email] || '').trim().toLowerCase();
        if (!email || body.indexOf(email) === -1) continue;
        if (data[r][col.Status] !== 'FORM_SENT') continue; // already decided or already flagged

        var rec = rowToObject_(data[0], data[r]);
        var when = rec.ShowingStart instanceof Date ? formatShowingTime_(rec.ShowingStart) : '';
        msg.markRead();
        // BOUNCED also takes the row out of the reminder sweep.
        updateShowingRow_(r + 1, { Status: 'BOUNCED', Reason: 'email to prospect bounced', SpencerFlaggedAt: new Date() });
        data[r][col.Status] = 'BOUNCED';
        notifySpencer_('[EMAIL BOUNCED] ' + rec.ProspectName + ' — ' + rec.Property + ' ' + when,
          'The pre-screen email to this prospect bounced, so they never received the form. The email address on ' +
          'their guest card is probably wrong. Please pre-screen them manually.', rec);
        break;
      }
    }
  }
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

    // Isolated per row, and the row is stamped BEFORE the email goes out: a
    // failure after sending must never mean the prospect is reminded again
    // every minute until the showing.
    try {
      var rec = rowToObject_(data[0], row);
      var when = formatShowingTime_(start);
      var firstName = firstNameOf_(rec.ProspectName);
      var formUrl = buildPrescreenUrl_(rec.ProspectName, rec.Email, rec.Property); // throws → retried next minute

      sheet.getRange(r + 1, col.ReminderSentAt + 1).setValue(now);
      sheet.getRange(r + 1, col.SpencerFlaggedAt + 1).setValue(now);

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

      notifySpencer_('[NO PRE-SCREEN YET] ' + rec.ProspectName + ' — ' + rec.Property + ' ' + when,
        'This prospect hasn\'t submitted the pre-screening form and the showing is about ' + Math.round(minsOut) +
        ' minutes away. A reminder was just sent to them. Your call whether to keep the showing.',
        rec);
    } catch (err) {
      logPreScreenError_('Reminder for Showings row ' + (r + 1) + ' failed: ' + err, null);
    }
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
  return sheet.getLastRow();
}

// ids: showing emails already recorded. keys: prospect + property + showing
// time, so a re-sent assignment for the same showing is recognised.
function loadKnownShowings_() {
  var data = getOrCreateShowingsSheet_().getDataRange().getValues();
  var col = headerIndex_(data[0]);
  var known = { ids: {}, keys: {} };
  for (var r = 1; r < data.length; r++) {
    known.ids[data[r][col.ShowingMsgId]] = true;
    known.keys[showingKey_(data[r][col.ProspectName], data[r][col.PropertyKey], data[r][col.ShowingStart])] = true;
  }
  return known;
}

function showingKey_(name, propertyKey, start) {
  return normalizeName_(name).join(' ') + '|' + propertyKey + '|' + (start instanceof Date ? start.getTime() : '');
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

// Builds a prefilled link into the pre-screen form (PreScreenForm.js) via
// FormApp's own toPrefilledUrl(). Hand-built "entry.<item id>" links don't
// work: Item.getId() is NOT the entry ID a prefill URL needs, and Forms
// silently ignores unknown entry params — so links opened blank (found in
// live testing 2026-09-23). Falls back to the bare form URL if only the
// prefill fails. If the form itself can't be opened this THROWS — callers
// retry rather than send a link to nowhere, and nothing is ever created here.
function buildPrescreenUrl_(fullName, email, propertyDisplayName) {
  var form = getPreScreenForm_();
  try {
    var items = form.getItems();
    var byTitle = {};
    for (var i = 0; i < items.length; i++) byTitle[items[i].getTitle()] = items[i];

    var response = form.createResponse();
    if (byTitle['Full Name'] && fullName) {
      response.withItemResponse(byTitle['Full Name'].asTextItem().createResponse(String(fullName)));
    }
    if (byTitle['Email Address'] && email) {
      response.withItemResponse(byTitle['Email Address'].asTextItem().createResponse(String(email)));
    }
    if (byTitle['Property'] && propertyDisplayName) {
      response.withItemResponse(byTitle['Property'].asMultipleChoiceItem().createResponse(propertyDisplayName));
    }
    return response.toPrefilledUrl();
  } catch (err) {
    logPreScreenError_('Prefilled link failed, sent bare form URL instead: ' + err, null);
    return form.getPublishedUrl();
  }
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
// Deliverability check — run sendDeliverabilityTest() by hand
// ---------------------------------------------------------------------------

// Sends the real "Confirm your showing" email to test inboxes so you can see
// whether it lands in the inbox or in spam. Set the Script Property
// DELIVERABILITY_TEST_EMAILS (Project Settings → Script Properties) to a
// comma-separated list — ideally one Gmail, one iCloud, one Yahoo/Outlook —
// then run this from the editor. Nothing is written to the Showings tab.
function sendDeliverabilityTest() {
  var raw = PropertiesService.getScriptProperties().getProperty('DELIVERABILITY_TEST_EMAILS') || '';
  var addresses = raw.split(',').map(function (a) { return a.trim(); }).filter(function (a) { return a; });
  if (addresses.length === 0) throw new Error('Set the Script Property DELIVERABILITY_TEST_EMAILS first.');

  var when = formatShowingTime_(new Date(Date.now() + 2 * 86400000));
  addresses.forEach(function (address) {
    var mail = buildFormEmail_('Test Prospect', address, PROPERTIES[2].displayName, when, '100 Commerce Ave SW - 202 Grand Rapids, MI 49503');
    GmailApp.sendEmail(address, mail.subject, '', { htmlBody: mail.htmlBody, name: SENDER_NAME, replyTo: REPLY_TO_EMAIL });
    Logger.log('Sent test to ' + address);
  });
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
