// GPM Lead Responder — self-serve previews for PMs
//
// A PM ticks the Preview checkbox on their property's row (Properties tab).
// Within ~5 minutes sendRequestedPreviews() emails them the exact email a
// prospect would get right now (live units, Book/Apply links, their Special
// and write-up), from the same sender with Reply-To = the row's PM. A short
// yellow note at the top lists anything that would change or block it.
// Works on any Status (Off/Draft/Test/Live), so a PM can finalize a row
// before it goes Live. The box unticks itself and PreviewSent records when
// and to whom it went. Nothing is ever sent to a prospect from this file.
//
// installPreviews() (Preview.gs) adds the two columns and the 5-minute
// trigger. Run it once.

var PREVIEW_COL = 'Preview';
var PREVIEW_SENT_COL = 'PreviewSent';
var PREVIEW_MAX_PER_RUN = 15;

function installPreviews() {
  var sheet = propertiesSheet_();
  var col = headerCols_(sheet);
  var last = sheet.getLastColumn();
  if (!col[PREVIEW_COL]) { sheet.getRange(1, ++last).setValue(PREVIEW_COL); }
  if (!col[PREVIEW_SENT_COL]) { sheet.getRange(1, ++last).setValue(PREVIEW_SENT_COL); }
  col = headerCols_(sheet);
  // Checkboxes only on rows that have a property (re-run to cover rows added later).
  var names = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  var rows = 1;
  names.forEach(function (r, i) { if (String(r[0]).trim()) rows = i + 1; });
  sheet.getRange(1, col[PREVIEW_COL], 1, 2).setFontWeight('bold').setBackground('#d9ead3');
  sheet.getRange(1, col[PREVIEW_COL]).setNote('Tick this box to get a preview of the email a prospect would get for this property right now. ' +
    'It arrives in the PMEmail inbox within about 5 minutes, then the box unticks itself. Works whatever the Status is. Nothing goes to prospects.');
  sheet.getRange(1, col[PREVIEW_SENT_COL]).setNote('Filled in automatically: when the last preview went out and to whom.');
  sheet.getRange(2, col[PREVIEW_COL], rows, 1).insertCheckboxes();
  sheet.getRange(2, col[PREVIEW_SENT_COL], rows, 1).setFontColor('#666666');

  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sendRequestedPreviews'; });
  if (!exists) ScriptApp.newTrigger('sendRequestedPreviews').timeBased().everyMinutes(5).create();
  Logger.log('Preview checkboxes added (column ' + columnLetter_(col[PREVIEW_COL]) + '). Ticked boxes are handled every 5 minutes.');
}

function uninstallPreviews() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendRequestedPreviews') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Preview trigger off (columns left in place).');
}

function sendRequestedPreviews() {
  var sheet = propertiesSheet_();
  var col = headerCols_(sheet);
  if (!col[PREVIEW_COL] || sheet.getLastRow() < 2) return;
  var ticks = sheet.getRange(2, col[PREVIEW_COL], sheet.getLastRow() - 1, 1).getValues();
  var wanted = [];
  ticks.forEach(function (r, i) { if (r[0] === true || /^(true|yes|x)$/i.test(String(r[0]).trim())) wanted.push(i + 2); });
  if (!wanted.length) return;

  var profiles = loadProfiles_();
  var names = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  var listings = fetchAllListings_();
  wanted.slice(0, PREVIEW_MAX_PER_RUN).forEach(function (r) {
    var name = String(names[r - 1][0]).trim();
    var p = profiles.properties.filter(function (x) { return x.Property === name; })[0];
    var stamp = Utilities.formatDate(new Date(), 'America/Detroit', 'M/d h:mm a');
    var note;
    try {
      if (!p) throw new Error('row has no Property name');
      var to = p.PMEmail || PREVIEW_FALLBACK_EMAIL;
      var mail = previewMail_(p, profiles, listings);
      GmailApp.sendEmail(to, '[PREVIEW] ' + mail.subject, mail.text,
        { htmlBody: mail.html, name: SENDER_NAME, replyTo: p.PMEmail || PREVIEW_FALLBACK_EMAIL });
      note = 'Sent ' + stamp + ' to ' + to;
    } catch (err) {
      note = 'FAILED ' + stamp + ': ' + err.message;
    }
    sheet.getRange(r, col[PREVIEW_COL]).setValue(false);
    sheet.getRange(r, col[PREVIEW_SENT_COL]).setValue(note);
  });
}

// The email a building-level lead for this row would get right now (the most
// common kind of guest card), with a yellow note on top for the PM.
function previewMail_(p, profiles, listings) {
  var match = matchCard_({ headline: p.Property, interestedIn: '', account: '', subject: '' }, listings, profiles.properties);
  if (match.outcome === 'AMBIGUOUS' || match.outcome === 'NO_PROFILE' || match.profile !== p) {
    // The row's own phrases decide which posted units are its building.
    var own = listings.filter(function (l) {
      return phraseList_(p).some(function (ph) { return containsPhrase_(l.address, ph) || containsPhrase_(l.title, ph); });
    });
    match = own.length ? { profile: p, unit: null, building: own, outcome: 'BUILDING' } : { profile: p, unit: null, building: [], outcome: 'NO_VACANCY' };
  }
  var mail = renderEmail_(p, profiles, 'Jordan', match);

  var notes = [];
  notes.push('Status is ' + (p.Status || 'blank') + (p.Status === 'Live' ? ': prospects get this email now.' :
    p.Status === 'Test' ? ': real leads go to the PM, not the prospect.' : ': nothing is sent to prospects until Status = Live.'));
  if (p.Missing) notes.push('Missing: ' + p.Missing + (p.Status === 'Live' ? ' (Live rows with something missing are BLOCKED)' : ' (must be filled before Live)'));
  if (!p.PMEmail) notes.push('PMEmail is blank, so this preview went to ' + PREVIEW_FALLBACK_EMAIL + ' and prospects would have no one to reply to.');
  if (match.outcome === 'NO_VACANCY') notes.push('No posted units match this property right now. A real lead would get a holding reply (outside office hours) and you would get a "no posted unit" alert instead of this email.');
  else notes.push(mail.unitsShown + ' unit(s) shown, ' + mail.bookable + ' with a Book-a-showing button (see the Showing Links tab for why).');
  if (p.WriteupDoc && !readWriteup_(p.WriteupDoc)) notes.push('The WriteupDoc link could not be opened, so the About section is missing. Share the doc with automation@greenpropertymgt.com (Viewer).');
  if (p.Special && specialExpired_(p.SpecialEnds)) notes.push('The Special is past its SpecialEnds date, so it is left out.');
  notes.push('Prospects see "Hi <their first name>"; "Jordan" is a stand-in. Units, rent and Book buttons are live and can change minute to minute.');

  var banner = '<div style="font-family:Arial,sans-serif;font-size:13px;background:#fff2cc;border:1px solid #e6c200;padding:10px 12px;margin:0 0 16px">' +
    '<strong>PREVIEW for ' + escapeHtml_(p.Property) + ' (only you see this box)</strong><ul style="margin:6px 0 0 18px;padding:0">' +
    notes.map(function (n) { return '<li>' + escapeHtml_(n) + '</li>'; }).join('') + '</ul></div>';
  return {
    subject: mail.subject,
    html: banner + mail.html,
    text: 'PREVIEW for ' + p.Property + '\n- ' + notes.join('\n- ') + '\n\n-----\n\n' + mail.text
  };
}

function propertiesSheet_() {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID')).getSheetByName(PROPERTIES_TAB);
}

function headerCols_(sheet) {
  var col = {};
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach(function (h, i) { if (h) col[String(h).trim()] = i + 1; });
  return col;
}
