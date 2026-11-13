/**
 * P25 Tech Daily Log (Wesley PIP)
 *
 * Web app where the tech logs every work order he worked on today:
 * WO #, start time, end time, work done. One row per WO in the "Log" tab.
 *
 * Triggers (installed by setup()):
 *   sendDailyReminder  - every day at 3 PM, only emails on Mon-Fri
 *   checkMissedDay     - every day at 8 AM, Mon-Fri, alerts if the
 *                        previous business day has no log
 *
 * Script Properties (defaults used if not set):
 *   TECH_EMAIL       - REQUIRED, Wesley's email
 *   TECH_NAME        - default "Wesley"
 *   REVIEWER_EMAILS  - gets each submission, default jason@
 *   ALERT_EMAILS     - gets missed-day alerts, default jason@ + matt@
 *   SHEET_ID         - set automatically by setup()
 *   START_DATE       - set automatically by setup(); no missed-day
 *                      alerts for days before this
 */

var LOG_SHEET = 'Log';
var HEADERS = ['Submitted At', 'Work Date', 'Tech', 'WO #', 'Start', 'End',
               'Hours', 'Work Done', 'Submission ID'];
var TZ = 'America/Detroit';
// ScriptApp.getService().getUrl() returns a dead (404) URL when called from a
// time trigger, so the reminder link is pinned to the @1 deployment instead.
var WEB_APP_URL = 'https://script.google.com/a/greenpropertymgt.com/macros/s/AKfycbwA9zyvTEk4K0hjqVvlHPQS5D65hRqOOeakjibvf7bqXF7ZJdFMLYrQWdJU9kz-YKmyLQ/exec';
function webAppUrl_() { return prop_('WEB_APP_URL', WEB_APP_URL); }

function prop_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v ? v.trim() : fallback;
}

function techName_() { return prop_('TECH_NAME', 'Wesley'); }

// ---------- Setup (run once from the editor, Code.js) ----------

function setup() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  var ss;
  if (sheetId) {
    ss = SpreadsheetApp.openById(sheetId);
  } else {
    ss = SpreadsheetApp.create(techName_() + ' - Daily Work Log');
    props.setProperty('SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(LOG_SHEET) || ss.getSheets()[0].setName(LOG_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(8, 420);
    sh.getRange('B:B').setNumberFormat('ddd m/d/yyyy');
    sh.getRange('G:G').setNumberFormat('0.00');
  }
  if (!props.getProperty('START_DATE')) {
    props.setProperty('START_DATE', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'sendDailyReminder' || fn === 'checkMissedDay') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyReminder').timeBased().everyDays(1).atHour(15).nearMinute(0).inTimezone(TZ).create();
  ScriptApp.newTrigger('checkMissedDay').timeBased().everyDays(1).atHour(8).nearMinute(0).inTimezone(TZ).create();

  Logger.log('Sheet: ' + ss.getUrl());
  Logger.log('Web app: ' + webAppUrl_());
}

// ---------- Web app ----------

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.techName = techName_();
  t.today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return t.evaluate()
    .setTitle('GPM Daily Work Log')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function toMinutes_(hhmm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function to12h_(hhmm) {
  var mins = toMinutes_(hhmm);
  var h = Math.floor(mins / 60), mm = mins % 60;
  var ap = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
}

/** Called from Index.html. payload = {workDate:'yyyy-MM-dd', wos:[{wo,start,end,details}]} */
function submitLog(payload) {
  if (!payload || !/^\d{4}-\d{2}-\d{2}$/.test(payload.workDate)) throw new Error('Pick the work date.');
  var wos = payload.wos || [];
  if (wos.length < 1) throw new Error('Add at least one work order.');

  var rows = [];
  var subId = Utilities.getUuid().slice(0, 8);
  var now = new Date();
  var p = payload.workDate.split('-');
  var workDate = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  var totalHrs = 0;

  wos.forEach(function (w, i) {
    var n = i + 1;
    var wo = String(w.wo || '').trim();
    var details = String(w.details || '').trim();
    var s = toMinutes_(w.start), e = toMinutes_(w.end);
    if (!wo) throw new Error('Work order ' + n + ': WO # is missing.');
    if (s === null || e === null) throw new Error('Work order ' + n + ': start and end time are required.');
    if (e <= s) throw new Error('Work order ' + n + ': end time must be after start time.');
    if (!details) throw new Error('Work order ' + n + ': describe the work done.');
    var hrs = Math.round((e - s) / 60 * 100) / 100;
    totalHrs += hrs;
    rows.push([now, workDate, techName_(), wo, to12h_(w.start), to12h_(w.end), hrs, details, subId]);
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(LOG_SHEET);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }

  try { emailReviewer_(payload.workDate, rows, totalHrs); } catch (err) { console.error(err); }
  return { count: rows.length, hours: Math.round(totalHrs * 100) / 100 };
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function prettyDate_(ymd) {
  var p = ymd.split('-');
  return Utilities.formatDate(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])), TZ, 'EEE M/d/yyyy');
}

function emailReviewer_(ymd, rows, totalHrs) {
  var to = prop_('REVIEWER_EMAILS', 'jason@greenpropertymgt.com');
  var td = 'style="border:1px solid #ccc;padding:6px;vertical-align:top"';
  var html = '<p><b>' + esc_(techName_()) + '</b> submitted ' + rows.length +
    ' work order(s) for <b>' + prettyDate_(ymd) + '</b>, total <b>' +
    (Math.round(totalHrs * 100) / 100) + ' hrs</b>.</p>' +
    '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">' +
    '<tr><th ' + td + '>WO #</th><th ' + td + '>Start</th><th ' + td + '>End</th><th ' + td +
    '>Hrs</th><th ' + td + '>Work Done</th></tr>';
  rows.forEach(function (r) {
    html += '<tr><td ' + td + '>' + esc_(r[3]) + '</td><td ' + td + '>' + r[4] + '</td><td ' + td + '>' +
      r[5] + '</td><td ' + td + '>' + r[6] + '</td><td ' + td + '>' + esc_(r[7]) + '</td></tr>';
  });
  html += '</table><p><a href="' + SpreadsheetApp.openById(prop_('SHEET_ID')).getUrl() + '">Open the log sheet</a></p>';
  MailApp.sendEmail({
    to: to,
    subject: techName_() + ' daily log - ' + prettyDate_(ymd) + ' (' + rows.length + ' WOs, ' +
      (Math.round(totalHrs * 100) / 100) + ' hrs)',
    htmlBody: html,
    name: 'GPM Daily Log'
  });
}

// ---------- Triggers ----------

function isWeekday_(d) {
  var dow = Number(Utilities.formatDate(d, TZ, 'u')); // 1=Mon .. 7=Sun
  return dow <= 5;
}

function sendDailyReminder() {
  if (!isWeekday_(new Date())) return;
  var to = prop_('TECH_EMAIL');
  if (!to) throw new Error('Set the TECH_EMAIL Script Property.');
  var url = webAppUrl_();
  var name = techName_();
  MailApp.sendEmail({
    to: to,
    subject: 'Daily work log - ' + Utilities.formatDate(new Date(), TZ, 'EEE M/d'),
    htmlBody: '<p>Hi ' + esc_(name) + ',</p>' +
      '<p>Please fill out today\'s work log before you finish for the day. Add every work order you ' +
      'worked on, with start time, end time, and the work you did.</p>' +
      '<p><a href="' + url + '" style="background:#2e6b3a;color:#fff;padding:10px 18px;' +
      'border-radius:6px;text-decoration:none;font-weight:bold">Open the daily log</a></p>' +
      '<p>Thanks,<br>GPM</p>',
    name: 'GPM Daily Log'
  });
}

/** Previous business day as yyyy-MM-dd (Mon -> Fri). */
function prevBusinessDay_(d) {
  var x = new Date(d.getTime());
  do { x.setDate(x.getDate() - 1); } while (!isWeekday_(x));
  return Utilities.formatDate(x, TZ, 'yyyy-MM-dd');
}

function checkMissedDay() {
  var now = new Date();
  if (!isWeekday_(now)) return;
  var day = prevBusinessDay_(now);
  if (day < prop_('START_DATE', '9999-12-31')) return;

  var sh = SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName(LOG_SHEET);
  var last = sh.getLastRow();
  if (last > 1) {
    var dates = sh.getRange(2, 2, last - 1, 1).getValues();
    for (var i = 0; i < dates.length; i++) {
      var v = dates[i][0];
      if (v instanceof Date && Utilities.formatDate(v, TZ, 'yyyy-MM-dd') === day) return;
    }
  }
  MailApp.sendEmail({
    to: prop_('ALERT_EMAILS', 'jason@greenpropertymgt.com,matt@greenpropertymgt.com'),
    subject: 'MISSED: ' + techName_() + ' daily log for ' + prettyDate_(day),
    htmlBody: '<p>' + esc_(techName_()) + ' has not submitted a daily work log for <b>' +
      prettyDate_(day) + '</b>.</p><p><a href="' + SpreadsheetApp.openById(prop_('SHEET_ID')).getUrl() +
      '">Open the log sheet</a></p>',
    name: 'GPM Daily Log'
  });
}

// ---------- Manual tests (run from the editor) ----------

function testReminderNow() { // emails the tech the link right now, ignores weekday check
  var to = prop_('TECH_EMAIL');
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[TEST] reminder that would go to ' + to,
    'Link: ' + webAppUrl_());
}
