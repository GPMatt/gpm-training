// GPM Lead Comments — what prospects actually write on their guest cards
//
// READ-ONLY against Gmail: nothing is marked read, labeled, replied to, or
// sent. The only writes are the "LeadComments" and "LeadCounts" tabs in the
// "GPM Pre-Screening Responses" spreadsheet, wiped and rebuilt on every run.
//
// Run dumpLeadComments() from the Apps Script editor (LeadComments.gs →
// function dropdown → dumpLeadComments → Run). It covers EVERY property's
// guest cards in this mailbox, not just the three this project handles.

var LEAD_COMMENTS_SHEET_NAME = 'LeadComments';
var LEAD_COUNTS_SHEET_NAME = 'LeadCounts';
var LEAD_COMMENTS_DAYS = 180;
var LEAD_COMMENTS_HEADER = [
  'Date', 'Kind', 'Property', 'Prospect', 'Source', 'AsksForShowing', 'Comments', 'Subject', 'MsgId'
];
var LEAD_COMMENTS_TIME_LIMIT_MS = 5 * 60 * 1000; // stop before Apps Script's 6-minute cap

// Rough first-pass tag only: a comment that ALSO asks a question still tags
// SHOWING, so every comment gets read, not just the NO rows.
var SHOWING_RE = /\b(tour|showing|viewing|view it|see (it|the|this)|schedule)\b/i;

function dumpLeadComments() {
  var started = Date.now();
  var rows = [];
  var seen = {};
  var query = 'in:anywhere from:guestcards@appfolio.com newer_than:' + LEAD_COMMENTS_DAYS + 'd';
  var truncated = false;

  for (var start = 0; ; start += 100) {
    var threads = GmailApp.search(query, start, 100);
    if (!threads.length) break;
    var batches = GmailApp.getMessagesForThreads(threads);
    for (var t = 0; t < batches.length; t++) {
      for (var m = 0; m < batches[t].length; m++) {
        var msg = batches[t][m];
        if (seen[msg.getId()]) continue;
        seen[msg.getId()] = true;
        rows.push(readLeadComment_(msg));
      }
    }
    if (Date.now() - started > LEAD_COMMENTS_TIME_LIMIT_MS) { truncated = true; break; }
  }

  rows.sort(function (a, b) { return b.Date - a.Date; });

  var ss = SpreadsheetApp.openById(getPreScreenResponsesSpreadsheetId_());
  writeLeadTab_(ss, LEAD_COMMENTS_SHEET_NAME, LEAD_COMMENTS_HEADER, rows.map(function (r) {
    return LEAD_COMMENTS_HEADER.map(function (h) { return r[h] === undefined ? '' : r[h]; });
  }));
  writeLeadTab_(ss, LEAD_COUNTS_SHEET_NAME, ['Property', 'Leads', 'WithComments', 'CommentsBeyondShowing'],
    leadCounts_(rows));

  Logger.log('Wrote ' + rows.length + ' guest cards (' + LEAD_COMMENTS_DAYS + ' days)' +
    (truncated ? ' — STOPPED EARLY at the time limit, older cards missing' : '') + '. ' + ss.getUrl());
}

function readLeadComment_(msg) {
  var subject = msg.getSubject();
  var text = htmlToText_(msg.getBody());
  var flat = text.replace(/\s+/g, ' ').trim();

  // "New Lead for 1960 Burton St SE CONTACT INFO ..." /
  // "New Interest for Indian Village Apartments CONTACT INFO ..."
  var head = flat.match(/New (Lead|Interest) for (.+?) CONTACT INFO/i);
  var kind = head ? head[1] : (/^New Lead/i.test(subject) ? 'Lead' : /Interest/i.test(subject) ? 'Interest' : '?');
  var property = head ? head[2].trim() : subject;

  var contact = (flat.split(/CONTACT INFO/i)[1] || '').trim();
  var prospect = contact.split(/[A-Za-z0-9._%+-]+@/)[0].trim();

  var commentsMatch = flat.match(/COMMENTS (.*?)(?: Reply)? (?:LEAD INFO|INTEREST INFO)/i);
  var comments = commentsMatch ? commentsMatch[1].trim() : '';

  var sourceMatch = flat.match(/Source: (.+?) Received:/i);

  return {
    Date: msg.getDate(),
    Kind: kind,
    Property: property,
    Prospect: prospect.slice(0, 60),
    Source: sourceMatch ? sourceMatch[1].trim() : '',
    AsksForShowing: !comments ? '' : (SHOWING_RE.test(comments) ? 'SHOWING' : 'NO'),
    Comments: comments.slice(0, 2000),
    Subject: subject,
    MsgId: msg.getId()
  };
}

function leadCounts_(rows) {
  var byProp = {};
  rows.forEach(function (r) {
    var c = byProp[r.Property] || (byProp[r.Property] = { leads: 0, withComments: 0, beyond: 0 });
    c.leads++;
    if (r.Comments) c.withComments++;
    if (r.AsksForShowing === 'NO') c.beyond++;
  });
  return Object.keys(byProp)
    .map(function (p) { return [p, byProp[p].leads, byProp[p].withComments, byProp[p].beyond]; })
    .sort(function (a, b) { return b[1] - a[1]; });
}

function writeLeadTab_(ss, name, header, rows) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear();
  var out = [header].concat(rows);
  sheet.getRange(1, 1, out.length, header.length).setValues(out);
  sheet.setFrozenRows(1);
}
