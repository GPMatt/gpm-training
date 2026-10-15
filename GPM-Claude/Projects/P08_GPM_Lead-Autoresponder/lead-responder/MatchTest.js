// GPM Lead Responder — dry run of the matcher against the real inbox
//
// testMatching() (MatchTest.gs) reads recent guest-card emails in this
// mailbox and writes what the responder WOULD have linked to into the
// "MatchTest" tab of the profiles sheet. READ-ONLY against Gmail: nothing is
// sent, labeled or marked read.

var MATCH_TEST_DAYS = 14;
var MATCH_TEST_TAB = 'MatchTest';
var MATCH_TEST_HEADER = ['Received', 'Account', 'Kind', 'Headline', 'InterestedIn', 'Outcome', 'Property', 'Status',
  'Unit', 'ApplyLink', 'BuildingUnits', 'Reason', 'ProspectEmail', 'Parse', 'Comments', 'MsgId'];

function testMatching() {
  var started = Date.now();
  var listings = fetchAllListings_();
  var profiles = loadProfiles_().properties;
  var rows = [], seen = {};

  for (var start = 0; Date.now() - started < 4.5 * 60 * 1000; start += 100) {
    var threads = GmailApp.search('in:anywhere from:guestcards@appfolio.com newer_than:' + MATCH_TEST_DAYS + 'd', start, 100);
    if (!threads.length) break;
    GmailApp.getMessagesForThreads(threads).forEach(function (msgs) {
      msgs.forEach(function (msg) {
        if (seen[msg.getId()] || msg.getFrom().indexOf('guestcards@appfolio.com') < 0) return;
        seen[msg.getId()] = true;
        var card = parseGuestCard_(msg.getSubject(), msg.getBody());
        var r = matchCard_(card, listings, profiles);
        var problems = [];
        if (!card.headline) problems.push('no headline');
        if (!card.account) problems.push('no account');
        if (!card.email) problems.push('no email');
        rows.push([msg.getDate(), card.account, card.kind, card.headline, card.interestedIn, r.outcome,
          r.profile ? r.profile.Property : '', r.profile ? r.profile.Status : '',
          r.unit ? r.unit.address : '', r.unit ? r.unit.applyUrl : '',
          r.building.map(function (l) { return l.address.split(',').slice(0, 2).join(','); }).join(' | '),
          r.reason, card.email, problems.join(', ') || 'OK', card.comments.slice(0, 300), msg.getId()]);
      });
    });
  }
  rows.sort(function (a, b) { return b[0] - a[0]; });

  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(MATCH_TEST_TAB) || ss.insertSheet(MATCH_TEST_TAB);
  sheet.clear();
  var out = [MATCH_TEST_HEADER].concat(rows);
  sheet.getRange(1, 1, out.length, MATCH_TEST_HEADER.length).setValues(out);
  sheet.getRange(1, 1, 1, MATCH_TEST_HEADER.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var tally = {};
  rows.forEach(function (r) { tally[r[5]] = (tally[r[5]] || 0) + 1; });
  Logger.log(rows.length + ' guest cards, ' + listings.length + ' live listings. ' + JSON.stringify(tally) + '\n' + ss.getUrl());
}
