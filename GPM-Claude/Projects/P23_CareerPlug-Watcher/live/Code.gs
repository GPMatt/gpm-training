/**
 * GPM CareerPlug Applicant Watcher (P23)
 *
 * Collect-only: reads CareerPlug "New Applicant for ..." notification emails and
 * logs one row per applicant into the Applicants tab. It never replies, labels,
 * archives or touches CareerPlug. Filtering + auto-response come later.
 *
 * Install (container-bound): in the Gmail account that RECEIVES the CareerPlug
 * emails, create a blank Google Sheet → Extensions → Apps Script → paste this into
 * Code.gs → Save → run setupWatcher() once and approve permissions. That backfills
 * every past CareerPlug email and installs a trigger that checks every 15 minutes.
 *
 * Dedupe is by Gmail message ID (column K), so re-running anything is safe.
 *
 * KNOWN GAP: the notification email has NO applicant email or phone — only name,
 * position, job city, latest role, applicant location and a link into CareerPlug.
 */

var SHEET_NAME = 'Applicants';
var SENDER = 'notifications@careerplug.com';
var TRIGGER_MINUTES = 15;
// Routine runs only look back this far; setupWatcher() / backfillAll() look at everything.
var ROUTINE_LOOKBACK = 'newer_than:3d';

var HEADERS = [
  'Received', 'Applicant', 'Position', 'Job Location', 'Latest Role',
  'Applicant Location', 'Application Link', 'Status', 'Notes', 'Subject',
  'Gmail Message ID', 'Gmail Link'
];
var COL_MSG_ID = 11; // 1-based column of 'Gmail Message ID'

function onOpen() {
  SpreadsheetApp.getUi().createMenu('CareerPlug Watcher')
    .addItem('Check for new applicants now', 'collectApplicants')
    .addItem('Backfill all past emails', 'backfillAll')
    .addToUi();
}

/** One-time: build the tab, backfill history, install the 15-min trigger. */
function setupWatcher() {
  getSheet_();
  backfillAll();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'collectApplicants') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('collectApplicants').timeBased().everyMinutes(TRIGGER_MINUTES).create();
}

/** Trigger target: last few days only. */
function collectApplicants() {
  return run_('from:' + SENDER + ' subject:"New Applicant" ' + ROUTINE_LOOKBACK);
}

/** Every CareerPlug applicant email ever received. Safe to re-run. */
function backfillAll() {
  return run_('from:' + SENDER + ' subject:"New Applicant"');
}

function run_(query) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 0; // another run is mid-write; next trigger picks it up

  try {
    var sheet = getSheet_();
    var seen = existingIds_(sheet);
    var rows = [];

    for (var start = 0; ; start += 100) {
      var threads = GmailApp.search(query, start, 100);
      threads.forEach(function (thread) {
        thread.getMessages().forEach(function (msg) {
          var id = msg.getId();
          if (seen[id] || msg.getFrom().indexOf(SENDER) === -1) return;
          seen[id] = true;
          rows.push(toRow_(msg));
        });
      });
      if (threads.length < 100) break;
    }

    if (rows.length) {
      rows.sort(function (a, b) { return a[0] - b[0]; }); // oldest first
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    }
    return rows.length;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Subject: "Carlos Ferrer - New Applicant for Snow Removal Technician"
 * Body:    "Carlos Ferrer applied to Snow Removal Technician in Grand Rapids, MI."
 *          then latest role, then applicant location ("No ... provided" when blank),
 *          then "View full application".
 */
function toRow_(msg) {
  var subject = msg.getSubject();
  var text = msg.getPlainBody().replace(/\r/g, '');
  var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(String);

  var name = '', position = '', jobLocation = '', latestRole = '', applicantLocation = '';

  var s = subject.match(/^(.*?)\s+-\s+New Applicant for\s+(.*)$/i);
  if (s) { name = s[1].trim(); position = s[2].trim(); }

  // Body may wrap "applied / to X in City." across lines, so match on the joined text.
  var joined = lines.join(' ');
  var b = joined.match(/applied\s+to\s+(.+?)\s+in\s+([^.]+?,\s*[A-Z]{2})\b/);
  if (b) {
    if (!position) position = b[1].trim();
    jobLocation = b[2].trim();
  }

  // The two lines right after the "applied to" line, before "View full application".
  var i = lines.findIndex(function (l) { return /\bin\s+[^.]+,\s*[A-Z]{2}\.?$/.test(l); });
  var j = lines.findIndex(function (l) { return /view full application/i.test(l); });
  if (i > -1 && j > i) {
    var between = lines.slice(i + 1, j).filter(function (l) { return !/^https?:\/\//.test(l); });
    latestRole = blankIfNone_(between[0]);
    applicantLocation = blankIfNone_(between[1]);
  }

  return [
    msg.getDate(), name, position, jobLocation, latestRole, applicantLocation,
    applicationLink_(msg.getBody()), 'New', '', subject,
    // authuser, not u/0: this inbox isn't always the first signed-in account.
    msg.getId(), 'https://mail.google.com/mail/?authuser=' +
      encodeURIComponent(Session.getEffectiveUser().getEmail()) + '#all/' + msg.getId()
  ];
}

function applicationLink_(html) {
  var m = html.match(/<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?View full application/i);
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

function blankIfNone_(s) {
  if (!s || /^no .* provided$/i.test(s)) return '';
  return s;
}

function existingIds_(sheet) {
  var seen = {};
  var last = sheet.getLastRow();
  if (last < 2) return seen;
  sheet.getRange(2, COL_MSG_ID, last - 1, 1).getValues().forEach(function (r) {
    if (r[0]) seen[r[0]] = true;
  });
  return seen;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd h:mm am/pm');
    var blank = ss.getSheetByName('Sheet1');
    if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);
  }
  return sheet;
}
