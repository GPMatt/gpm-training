// GPM Spencer Showing Pre-Screen — pairing diagnostics
//
// READ-ONLY against Gmail: nothing is marked read, labeled, replied to, or
// sent. The only write is the "Diag" tab in the "GPM Pre-Screening Responses"
// spreadsheet, which is wiped and rebuilt on every run.
//
// Run diagnoseShowingPairing() from the Apps Script editor (Diagnostics.gs →
// function dropdown → diagnoseShowingPairing → Run). It answers, for every row
// on the Showings tab: did a guest-card email for this prospect ever reach
// this mailbox, when, and why did (or didn't) the watcher pair it?

var DIAG_SHEET_NAME = 'Diag';
var DIAG_HEADER = [
  'Section', 'Prospect', 'ShowingStatus', 'ShowingReceived', 'Item', 'MsgDate', 'GapMin',
  'From', 'ReplyTo', 'To', 'Subject', 'Property', 'ShowingUnitKey', 'CardUnitKey',
  'ExtractedEmail', 'UnitHit', 'NameHit', 'InWindow', 'WouldMatch', 'Where', 'Notes'
];
var DIAG_INVENTORY_DAYS = 30;

function diagnoseShowingPairing() {
  var rows = [];
  diagShowings_(rows);
  diagInventory_(rows);

  var ss = SpreadsheetApp.openById(getPreScreenResponsesSpreadsheetId_());
  var sheet = ss.getSheetByName(DIAG_SHEET_NAME) || ss.insertSheet(DIAG_SHEET_NAME);
  sheet.clear();
  var out = [DIAG_HEADER].concat(rows.map(function (r) {
    return DIAG_HEADER.map(function (h) { return r[h] === undefined ? '' : r[h]; });
  }));
  sheet.getRange(1, 1, out.length, DIAG_HEADER.length).setValues(out);
  sheet.setFrozenRows(1);
  Logger.log('Diag tab written: ' + rows.length + ' rows.');
}

// ---------------------------------------------------------------------------
// Section 1 — every Showings row vs. every guest card that names the prospect
// ---------------------------------------------------------------------------

function diagShowings_(rows) {
  var data = getOrCreateShowingsSheet_().getDataRange().getValues();
  var col = headerIndex_(data[0]);
  var windowMs = GUEST_CARD_WINDOW_MIN * 60000;

  for (var r = 1; r < data.length; r++) {
    var rec = rowToObject_(data[0], data[r]);
    var base = { Section: 'SHOWING', Prospect: rec.ProspectName, ShowingStatus: rec.Status, ShowingReceived: rec.Received };
    var property = detectProperty_(rec.Property);
    var showingUnitKey = property ? unitKey_(property.key, rec.Unit) : '';
    var received = rec.Received instanceof Date ? rec.Received : null;

    // The showing email itself — who it was addressed to, and whether the
    // prospect's contact info or a guest-card link is sitting in the body.
    try {
      var sm = GmailApp.getMessageById(String(rec.ShowingMsgId));
      var sBody = sm.getBody();
      var sText = htmlToText_(sBody);
      rows.push(diagRow_(base, {
        Item: 'showing email', MsgDate: sm.getDate(), From: sm.getFrom(), ReplyTo: sm.getReplyTo(), To: sm.getTo(),
        Subject: sm.getSubject(), Property: rec.Property, ShowingUnitKey: showingUnitKey,
        ExtractedEmail: diagAllEmails_(sText).join(', '), Where: diagWhere_(sm),
        Notes: 'links: ' + diagLinks_(sBody).join(' | ') + ' || text: ' + sText.replace(/\s+/g, ' ').slice(0, 600)
      }));
    } catch (err) {
      rows.push(diagRow_(base, { Item: 'showing email', Notes: 'could not load message ' + rec.ShowingMsgId + ': ' + err }));
    }

    // Every guest card that mentions the prospect's last name, any age, any
    // folder. No newer_than and no window here on purpose — the point is to
    // see what the watcher's 2d search / 60 min window is throwing away.
    var nameParts = normalizeName_(rec.ProspectName);
    var lastName = nameParts.length ? nameParts[nameParts.length - 1] : '';
    if (!lastName) continue;

    var cardCount = 0;
    var seen = {};
    var threads = GmailApp.search('in:anywhere from:guestcards@appfolio.com "' + lastName + '"', 0, 20);
    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m];
        var text = msg.getSubject() + '\n' + htmlToText_(msg.getBody());
        if (text.toLowerCase().indexOf(lastName) === -1 && msg.getFrom().toLowerCase().indexOf(lastName) === -1) continue;
        seen[msg.getId()] = true;
        cardCount++;

        var cardProp = detectProperty_(text);
        var cardUnitKey = cardProp ? (unitKey_(cardProp.key, msg.getSubject()) || unitKey_(cardProp.key, text)) : '';
        var cardName = msg.getFrom().split('<')[0].replace(/"/g, '').trim();
        var email = extractEmail_(msg.getReplyTo()) || extractProspectEmailFromBody_(text);
        var gapMs = received ? msg.getDate() - received : null;

        var sameProp = !!(cardProp && property && cardProp.key === property.key);
        var unitHit = !!(showingUnitKey && cardUnitKey && showingUnitKey === cardUnitKey);
        var nameHit = namesLooselyMatch_(rec.ProspectName, cardName);
        var inWindow = gapMs !== null && Math.abs(gapMs) <= windowMs;
        var wouldMatch = sameProp && !!email && inWindow && (unitHit || nameHit);

        var why = [];
        if (!cardProp) why.push('property not detected');
        else if (!sameProp) why.push('different property (' + cardProp.displayName + ')');
        if (!email) why.push('no prospect email extracted');
        if (!inWindow) why.push('outside ' + GUEST_CARD_WINDOW_MIN + ' min window');
        if (!unitHit && !nameHit) why.push('neither unit nor name matched (card name "' + cardName + '")');

        rows.push(diagRow_(base, {
          Item: 'guest card', MsgDate: msg.getDate(), GapMin: gapMs === null ? '' : Math.round(gapMs / 60000),
          From: msg.getFrom(), ReplyTo: msg.getReplyTo(), To: msg.getTo(), Subject: msg.getSubject(),
          Property: cardProp ? cardProp.displayName : '', ShowingUnitKey: showingUnitKey, CardUnitKey: cardUnitKey,
          ExtractedEmail: email, UnitHit: unitHit, NameHit: nameHit, InWindow: inWindow, WouldMatch: wouldMatch,
          Where: diagWhere_(msg),
          Notes: (why.length ? 'BLOCKED: ' + why.join('; ') : 'ok') + ' || text: ' + text.replace(/\s+/g, ' ').slice(0, 400)
        }));
      }
    }

    // Anything else in the mailbox naming this prospect — catches guest cards
    // arriving from a different sender, or as a forward from spencer@.
    var others = GmailApp.search('in:anywhere "' + rec.ProspectName + '" -from:guestcards@appfolio.com', 0, 20);
    for (var j = 0; j < others.length; j++) {
      var oMessages = others[j].getMessages();
      for (var k = 0; k < oMessages.length; k++) {
        var o = oMessages[k];
        if (seen[o.getId()] || o.getId() === String(rec.ShowingMsgId)) continue;
        rows.push(diagRow_(base, {
          Item: 'other mention', MsgDate: o.getDate(),
          GapMin: received ? Math.round((o.getDate() - received) / 60000) : '',
          From: o.getFrom(), ReplyTo: o.getReplyTo(), To: o.getTo(), Subject: o.getSubject(), Where: diagWhere_(o)
        }));
      }
    }

    if (cardCount === 0) {
      rows.push(diagRow_(base, { Item: 'guest card', Notes: 'NONE IN MAILBOX — no guestcards@appfolio.com email mentions "' + lastName + '"' }));
    }
  }
}

// ---------------------------------------------------------------------------
// Section 2 — what AppFolio actually delivers to this mailbox
// ---------------------------------------------------------------------------

function diagInventory_(rows) {
  var bySender = {};
  var byDay = {};
  var start = 0;

  while (start < 1000) {
    var threads = GmailApp.search('in:anywhere from:appfolio.com newer_than:' + DIAG_INVENTORY_DAYS + 'd', start, 100);
    if (threads.length === 0) break;
    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m];
        var sender = extractSenderAddress_(msg.getFrom());
        var subject = msg.getSubject();
        var isShowing = /New Showing Assignment/i.test(subject);
        var isCard = sender === 'guestcards@appfolio.com';
        var ours = (isShowing || isCard) ? !!detectProperty_(subject + '\n' + htmlToText_(msg.getBody())) : false;

        var s = bySender[sender] || (bySender[sender] = { count: 0, sample: subject, to: msg.getTo() });
        s.count++;

        var day = Utilities.formatDate(msg.getDate(), TIME_ZONE, 'yyyy-MM-dd');
        var d = byDay[day] || (byDay[day] = { showOurs: 0, showOther: 0, cardOurs: 0, cardOther: 0 });
        if (isShowing) { if (ours) d.showOurs++; else d.showOther++; }
        if (isCard) { if (ours) d.cardOurs++; else d.cardOther++; }
      }
    }
    start += 100;
  }

  Object.keys(bySender).sort().forEach(function (sender) {
    rows.push({ Section: 'SENDERS', Item: sender, To: bySender[sender].to, Subject: bySender[sender].sample,
                Notes: bySender[sender].count + ' messages in last ' + DIAG_INVENTORY_DAYS + 'd' });
  });
  Object.keys(byDay).sort().forEach(function (day) {
    var d = byDay[day];
    rows.push({ Section: 'DAILY', Item: day,
                Notes: 'showings ours=' + d.showOurs + ' other=' + d.showOther +
                       ' | guest cards ours=' + d.cardOurs + ' other=' + d.cardOther });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function diagRow_(base, extra) {
  var row = {};
  var k;
  for (k in base) row[k] = base[k];
  for (k in extra) row[k] = extra[k];
  return row;
}

function diagWhere_(message) {
  if (message.isInTrash()) return 'TRASH';
  var thread = message.getThread();
  if (thread.isInSpam()) return 'SPAM';
  return (message.isInInbox() ? 'inbox' : 'archived') + (message.isUnread() ? ', unread' : ', read');
}

function diagAllEmails_(text) {
  var re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, m, found = {};
  while ((m = re.exec(String(text))) !== null) found[m[0].toLowerCase()] = true;
  return Object.keys(found);
}

function diagLinks_(html) {
  var re = /href="([^"]+)"/gi, m, found = {};
  while ((m = re.exec(String(html))) !== null) {
    if (/appfolio/i.test(m[1])) found[m[1].split('?')[0]] = true;
  }
  return Object.keys(found).slice(0, 8);
}

function extractSenderAddress_(from) {
  var m = String(from || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : String(from || '').toLowerCase();
}
