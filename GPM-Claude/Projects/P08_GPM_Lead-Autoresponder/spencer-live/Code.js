// GPM Lead Autoresponder — Indian Village, Eaglebrook, Grand Central Lofts
// Separate GAS project from the VoL autoresponder (vol-live/). Watches the same
// automation@greenpropertymgt.com inbox, but that inbox receives guest-card/lead
// notifications for EVERY GPM property from the same sender, so sender alone is
// not a safe filter — see detectProperty_ below.

// "match" phrases must each be unique enough to appear ONLY for this property,
// since they're matched against the subject line alone (see searchQuery below).
// Indian Village's "New Lead" format (fresh leads, not guest-card follow-ups)
// puts the property's street address in the subject instead of its name. Indian
// Village is a multi-building complex on Burton St SE. Matt confirmed the
// building numbers: 1960, 1966, and 1970 — each listed individually. Do NOT
// broaden this to a bare "Burton St" match: GPM separately manages 2737 Burton
// St SE (CC Main Street Properties LLC, per
// GPM-Claude/property_directory-20260904.csv) — an unrelated property on the
// same street — so a bare street-name match would misroute its leads here.
// If Eaglebrook or Grand Central Lofts ever generate that same
// "New Lead: ... interested in {address}" subject format, their street
// address isn't in here yet and would need to be added the same way, or
// those leads won't match on subject alone.
var PROPERTIES = [
  { key: 'INDIAN_VILLAGE', displayName: 'Indian Village Apartments', match: ['indian village', '1960 burton', '1966 burton', '1970 burton'] },
  { key: 'EAGLEBROOK', displayName: 'Eaglebrook Apartments', match: ['eaglebrook'] },
  { key: 'GRAND_CENTRAL_LOFTS', displayName: 'Grand Central Lofts', match: ['grand central lofts'] }
];

// TODO: replace with the real shared Google Calendar booking link once it exists.
// It's one link for all three properties, so the reply asks the prospect to name
// the property in the booking notes — that's how Spencer tells bookings apart
// until there's a per-property link or booking form field.
var SHOWING_LINK = 'https://calendar.google.com/PLACEHOLDER-SCHEDULING-LINK';

var SENDER_NAME = 'Spencer';
var SENDER_SIGNATURE = 'Spencer';
var REPLY_TO_EMAIL = 'spencer@greenpropertymgt.com';

function autoResponder() {
  // Prevents overlapping executions from double-sending (see vol-live/Code.js —
  // same fix, same reason: a frequent trigger + a backlog can overlap).
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    autoResponder_run_();
  } finally {
    lock.releaseLock();
  }
}

function autoResponder_run_() {
  // Subject-only, on purpose: automation@ gets guest-card/lead mail for every GPM
  // property from this same sender, so sender alone can't be the filter — but we
  // don't want to pull every message's full body just to check it either. The
  // match phrases in PROPERTIES are each unique to one property's subject line.
  var searchQuery = 'from:guestcards@appfolio.com is:unread ' +
    'subject:("Indian Village" OR "1960 Burton" OR "1966 Burton" OR "1970 Burton" OR "Eaglebrook" OR "Grand Central Lofts")';
  var threads = GmailApp.search(searchQuery);
  var cache = CacheService.getScriptCache();

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();

    // Walk every message in the thread, not just the last one. AppFolio's near-
    // identical subject lines make Gmail bundle unrelated prospects into a single
    // thread (confirmed live: one thread held 4 messages from 3 different people)
    // — reading only the last message would silently skip everyone earlier in
    // that thread and then archive their unanswered messages along with it.
    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      if (!message.isUnread()) continue;

      var property = detectProperty_(message.getSubject());
      if (!property) {
        // Not one of ours (shouldn't happen given the search query above, but
        // defensive) — leave this specific message unread rather than touch it.
        continue;
      }

      var prospectEmail = message.getReplyTo();
      var fromHeader = message.getFrom();
      var name = fromHeader.split('<')[0].trim();
      var firstName = name.split(' ')[0];

      if (!firstName || firstName.indexOf('@') !== -1 || firstName === '') {
        firstName = 'there';
      }

      var subject = property.displayName + ' - Schedule Your Showing';
      var htmlBody = `
        Hello ${firstName},<br><br>
        Thanks for your interest in ${property.displayName}! I'd love to get you scheduled for a showing.<br><br>
        <strong><a href="${SHOWING_LINK}">SCHEDULE YOUR SHOWING</a></strong><br><br>
        When you book, please note "${property.displayName}" in the event details so I know which property to prepare for.<br><br>
        Looking forward to meeting you,<br>
        ${SENDER_SIGNATURE}<br>
        Green Property Management
      `;

      var cachedFlag = cache.get(prospectEmail);

      if (!cachedFlag) {
        GmailApp.sendEmail(prospectEmail, subject, "", {
          htmlBody: htmlBody,
          name: SENDER_NAME,
          replyTo: REPLY_TO_EMAIL
        });

        cache.put(prospectEmail, "sent", 900);
      }

      message.markRead();
    }

    // Only archive once nothing unread is left in the thread — if a message
    // didn't match one of our properties, it stays unread and the thread stays
    // in the inbox instead of getting buried by an archive.
    if (!threads[i].isUnread()) {
      threads[i].moveToArchive();
    }
  }
}

// Returns the matching entry from PROPERTIES, or null if none of our three
// properties' subject phrases are present. Re-checked here (not just relied on
// via the Gmail search above) so a stray match never gets marked read/archived.
function detectProperty_(subjectText) {
  var lower = subjectText.toLowerCase();
  for (var i = 0; i < PROPERTIES.length; i++) {
    var prop = PROPERTIES[i];
    for (var j = 0; j < prop.match.length; j++) {
      if (lower.indexOf(prop.match[j]) !== -1) return prop;
    }
  }
  return null;
}

// Run this ONCE from the Apps Script editor (select createAutoResponderTrigger in
// the function dropdown, then click Run) to install the recurring trigger. Safe
// to re-run — it clears any existing trigger on autoResponder first so you don't
// end up with duplicates stacking up and double-sending.
function createAutoResponderTrigger() {
  deleteAutoResponderTriggers_();
  ScriptApp.newTrigger('autoResponder')
    .timeBased()
    .everyMinutes(1)
    .create();
}

function deleteAutoResponderTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoResponder') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
