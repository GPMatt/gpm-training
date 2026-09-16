// GPM Lead Autoresponder — Indian Village, Eaglebrook, Grand Central Lofts
// Separate GAS project from the VoL autoresponder (vol-live/). Watches the same
// automation@greenpropertymgt.com inbox, but that inbox receives guest-card/lead
// notifications for EVERY GPM property from the same sender, so sender alone is
// not a safe filter — see detectProperty_ below.

var PROPERTIES = [
  { key: 'INDIAN_VILLAGE', displayName: 'Indian Village Apartments', match: ['indian village'] },
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
  // AppFolio's subject line varies between "New Lead: ..." and "New Interest on an
  // existing guest card for ..." depending on lead source, and for at least one
  // format (Indian Village's "New Lead") the property name isn't in the subject at
  // all — only in the body. So we match sender + property phrase together, and the
  // phrase search covers subject AND body, which is what actually narrows this down
  // to our three properties out of every property this mailbox gets mail for.
  var searchQuery = 'from:guestcards@appfolio.com is:unread ' +
    '("Indian Village" OR "Eaglebrook" OR "Grand Central Lofts")';
  var threads = GmailApp.search(searchQuery);
  var cache = CacheService.getScriptCache();

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    var lastMessage = messages[messages.length - 1];

    var haystack = lastMessage.getSubject() + ' ' + lastMessage.getPlainBody();
    var property = detectProperty_(haystack);

    if (!property) {
      // Defensive: shouldn't happen given the search query above, but if it does,
      // leave the thread untouched (unread, in inbox) rather than archive a lead
      // for a property this script doesn't own.
      continue;
    }

    var prospectEmail = lastMessage.getReplyTo();
    var fromHeader = lastMessage.getFrom();
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

    threads[i].markRead();
    threads[i].moveToArchive();
  }
}

// Returns the matching entry from PROPERTIES, or null if none of our three
// properties are mentioned anywhere in the subject/body.
function detectProperty_(text) {
  var lower = text.toLowerCase();
  for (var i = 0; i < PROPERTIES.length; i++) {
    var prop = PROPERTIES[i];
    for (var j = 0; j < prop.match.length; j++) {
      if (lower.indexOf(prop.match[j]) !== -1) return prop;
    }
  }
  return null;
}
