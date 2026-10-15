// GPM Lead Responder — build one property's email from the profiles sheet
//
// sendTestPreviews() (Render.gs) emails the rendered message for every row set
// to Status = Test, to that row's PM (or PREVIEW_FALLBACK_EMAIL when PMEmail is
// blank). Nothing goes to prospects from this file — the lead watcher that
// does that is not built yet.

var PREVIEW_FALLBACK_EMAIL = 'matt@greenpropertymgt.com';
var SENDER_NAME = 'Green Property Management Leasing';

var LINK_LABELS = {
  ShowingLink: 'BOOK A SHOWING',
  ApplyLink: 'START YOUR APPLICATION',
  VirtualTourLink: 'Watch the virtual tour'
};

function sendTestPreviews() {
  var profiles = loadProfiles_();
  var sent = 0;
  profiles.properties.forEach(function (p) {
    if (p.Status !== 'Test') return;
    var mail = renderEmail_(p, profiles, 'Jordan');
    var to = p.PMEmail || PREVIEW_FALLBACK_EMAIL;
    GmailApp.sendEmail(to, '[TEST] ' + mail.subject, mail.text, { htmlBody: mail.html, name: SENDER_NAME });
    sent++;
  });
  Logger.log(sent ? 'Sent ' + sent + ' test preview(s).' : 'No rows have Status = Test.');
}

function loadProfiles_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));

  var data = ss.getSheetByName(PROPERTIES_TAB).getDataRange().getValues();
  var header = data[0];
  var properties = data.slice(1).filter(function (row) { return row[0]; }).map(function (row) {
    var obj = {};
    header.forEach(function (h, i) { obj[h] = typeof row[i] === 'string' ? row[i].trim() : row[i]; });
    return obj;
  });

  var defaults = {};
  ss.getSheetByName(DEFAULTS_TAB).getDataRange().getValues().slice(1).forEach(function (row) {
    if (row[0]) defaults[row[0]] = String(row[1]).trim();
  });

  var t = ss.getSheetByName(TEMPLATE_TAB).getRange(1, 2, 2, 1).getValues();
  return { properties: properties, defaults: defaults, subject: String(t[0][0]), body: String(t[1][0]) };
}

// Row value first, then the company default, then blank.
function renderEmail_(property, profiles, firstName) {
  var values = {};
  Object.keys(profiles.defaults).forEach(function (k) { values[k] = profiles.defaults[k]; });
  Object.keys(property).forEach(function (k) {
    if (property[k] !== '' && property[k] !== null) values[k] = String(property[k]);
  });
  values.FirstName = firstName || 'there';
  values.About = readWriteup_(property.WriteupDoc);

  var htmlLines = [], textLines = [];
  profiles.body.split('\n').forEach(function (line) {
    var keys = (line.match(/\{\{(\w+)\}\}/g) || []).map(function (m) { return m.slice(2, -2); });
    if (keys.some(function (k) { return !values[k]; })) return; // blank placeholder → drop the line

    textLines.push(line.replace(/\{\{(\w+)\}\}/g, function (_, k) {
      return LINK_LABELS[k] ? LINK_LABELS[k] + ': ' + values[k] : values[k];
    }));
    htmlLines.push(escapeHtml_(line).replace(/\{\{(\w+)\}\}/g, function (_, k) {
      if (LINK_LABELS[k]) {
        return '<a href="' + escapeHtml_(values[k]) + '"><strong>' + LINK_LABELS[k] + '</strong></a>';
      }
      if (k === 'About') {
        return '<strong>ABOUT ' + escapeHtml_(values.Property).toUpperCase() + '</strong><br>' +
          escapeHtml_(values.About).replace(/\n/g, '<br>');
      }
      return escapeHtml_(values[k]);
    }));
  });

  // Collapse the blank lines left behind by dropped sections.
  var html = htmlLines.join('<br>').replace(/(<br>){3,}/g, '<br><br>');
  var text = textLines.join('\n').replace(/\n{3,}/g, '\n\n');
  var subject = profiles.subject.replace(/\{\{(\w+)\}\}/g, function (_, k) { return values[k] || ''; });
  return { subject: subject, html: '<div style="font-family:Arial,sans-serif;font-size:14px">' + html + '</div>', text: text };
}

// Optional write-up. An unreadable or empty doc never blocks the email — the
// About section is just left out.
function readWriteup_(url) {
  if (!url) return '';
  try {
    return DocumentApp.openByUrl(String(url)).getBody().getText().trim();
  } catch (err) {
    Logger.log('Write-up doc unreadable (' + url + '): ' + err);
    return '';
  }
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
