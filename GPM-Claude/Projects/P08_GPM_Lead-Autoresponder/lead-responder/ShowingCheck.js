// GPM Lead Responder — "Showing Links" tab
//
// refreshShowingLinks() runs every 10 minutes (installShowingCheck() sets it
// up). It re-checks every posted unit for AppFolio's blue "Schedule Showing"
// button (same two-step check the emails use, Listings.gs showingCheck_) and
// rewrites the Showing Links tab of the profiles sheet. Because it refreshes
// the same cache the responder reads, the emails always match this tab.

var SHOWING_TAB = 'Showing Links';
var SHOWING_HEADER = ['Property (sheet row)', 'Unit', 'AppFolio button', 'Why', 'First open time',
  'In our emails', 'Since', 'Last checked', 'Listing page', 'Account', 'uid'];

function installShowingCheck() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'refreshShowingLinks'; });
  if (!exists) ScriptApp.newTrigger('refreshShowingLinks').timeBased().everyMinutes(10).create();
  refreshShowingLinks();
  Logger.log('Showing Links tab now refreshes every 10 minutes.');
}

function uninstallShowingCheck() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshShowingLinks') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Showing Links refresh off.');
}

function refreshShowingLinks() {
  var listings = fetchAllListings_();
  var checks = showingCheck_(listings, true);
  var properties = loadProfiles_().properties;
  var now = new Date();

  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(SHOWING_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SHOWING_TAB);
    sheet.setFrozenRows(1);
  }

  // Keep "Since" (when the button last appeared/disappeared) across refreshes.
  var prev = {};
  if (sheet.getLastRow() > 1) {
    var uidCol = SHOWING_HEADER.indexOf('uid');
    sheet.getRange(2, 1, sheet.getLastRow() - 1, SHOWING_HEADER.length).getValues().forEach(function (r) {
      if (r[uidCol]) prev[r[uidCol]] = { button: r[2], since: r[6] };
    });
  }

  var rows = listings.map(function (l) {
    var c = checks[l.uid] || { v: -1, why: 'Not checked', first: '' };
    var button = c.v === 1 ? 'Yes' : c.v === 0 ? 'No' : 'Check failed';
    var m = matchCard_({ headline: l.address, interestedIn: l.title, account: l.account }, [l], properties);
    var p = m.profile || null;
    var link = p ? String(p.ShowingLink || '').trim() : '';
    var emails;
    if (!p) emails = m.outcome === 'AMBIGUOUS' ? 'Matches 2+ rows: ' + m.reason.replace('Matches rows: ', '') : 'No sheet row';
    else if (/^(off|none|no)$/i.test(link)) emails = 'No Book link (ShowingLink = Off)';
    else if (link) emails = 'Book link (custom ShowingLink)';
    else emails = c.v === 1 ? 'Book link' : 'Apply only';
    var since = prev[l.uid] && prev[l.uid].button === button && prev[l.uid].since ? prev[l.uid].since : now;
    return [p ? p.Property : '', l.address, button, c.why, c.first ? c.first : '', emails, since, now,
      l.detailUrl, l.account, l.uid];
  });
  var order = { 'Yes': 0, 'No': 1, 'Check failed': 2 };
  rows.sort(function (a, b) { return (order[a[2]] - order[b[2]]) || String(a[0] || '~').localeCompare(String(b[0] || '~')) || a[1].localeCompare(b[1]); });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, SHOWING_HEADER.length).setValues([SHOWING_HEADER]).setFontWeight('bold');
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, SHOWING_HEADER.length).setValues(rows);
    sheet.getRange(2, 7, rows.length, 2).setNumberFormat('m/d h:mm am/pm');
  }
  sheet.getRange(2, 3, Math.max(rows.length, 1), 1).clearFormat();
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Yes').setBackground('#d9ead3').setRanges([sheet.getRange('C2:C')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('No').setBackground('#f4cccc').setRanges([sheet.getRange('C2:C')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Check failed').setBackground('#fff2cc').setRanges([sheet.getRange('C2:C')]).build()
  ];
  sheet.setConditionalFormatRules(rules);
  sheet.hideColumns(10, 2);
}
