// GPM Lead Responder — build one lead's email from the profiles sheet + live listings
//
// sendTestPreviews() (Render.gs) emails a sample for every row set to
// Status = Test, to that row's PM (or PREVIEW_FALLBACK_EMAIL when PMEmail is
// blank), using the units posted right now. Nothing goes to prospects from
// this file — Responder.js does the real sending.

var PREVIEW_FALLBACK_EMAIL = 'matt@greenpropertymgt.com';
var SENDER_NAME = 'Green Property Management Leasing';

var LINK_LABELS = {
  ShowingLink: 'BOOK A SHOWING',
  ApplyLink: 'START YOUR APPLICATION',
  VirtualTourLink: 'Watch the virtual tour'
};

// sendTestPreviewsToMe() (Render.gs) sends the same previews to
// PREVIEW_FALLBACK_EMAIL (Matt) instead of the PMs.
function sendTestPreviewsToMe() {
  sendTestPreviews(PREVIEW_FALLBACK_EMAIL);
}

function sendTestPreviews(toOverride) {
  if (typeof toOverride !== 'string') toOverride = ''; // the editor's Run passes an event object
  var profiles = loadProfiles_();
  var listings = fetchAllListings_();
  var sent = 0;
  profiles.properties.forEach(function (p) {
    if (p.Status !== 'Test') return;
    // A building-level card for this property, the most common kind.
    var match = matchCard_({ headline: p.Property, interestedIn: '', account: '', subject: '' }, listings, profiles.properties);
    if (match.outcome === 'NO_PROFILE' || match.outcome === 'AMBIGUOUS') match = { profile: p, unit: null, building: [], outcome: 'NO_VACANCY' };
    var mail = renderEmail_(p, profiles, 'Jordan', match);
    var to = toOverride || p.PMEmail || PREVIEW_FALLBACK_EMAIL;
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

  // Code defaults (Setup.gs DEFAULTS, e.g. the $50 application fee) apply
  // when the Defaults tab cell is blank; a value typed in the sheet wins.
  var defaults = {};
  DEFAULTS.forEach(function (d) { if (d[1]) defaults[d[0]] = d[1]; });
  ss.getSheetByName(DEFAULTS_TAB).getDataRange().getValues().slice(1).forEach(function (row) {
    if (row[0] && String(row[1]).trim()) defaults[row[0]] = String(row[1]).trim();
  });

  var t = ss.getSheetByName(TEMPLATE_TAB).getRange(1, 2, 2, 1).getValues();
  return { properties: properties, defaults: defaults, subject: String(t[0][0]), body: String(t[1][0]) };
}

// Row value first, then the company default, then blank. `match` is the
// matchCard_ result: it decides which units the {{Units}} block shows.
function renderEmail_(property, profiles, firstName, match) {
  var values = {};
  Object.keys(profiles.defaults).forEach(function (k) { values[k] = profiles.defaults[k]; });
  Object.keys(property).forEach(function (k) {
    if (property[k] !== '' && property[k] !== null) values[k] = String(property[k]);
  });
  values.FirstName = firstName || 'there';
  if (specialExpired_(property.SpecialEnds)) values.Special = '';
  values.About = readWriteup_(property.WriteupDoc);
  var units = unitsBlock_(property, match || { building: [] }, values.PM || 'our leasing team');
  // Older Template tabs have no {{Tour}} line: keep the tour note under the units.
  if (profiles.body.indexOf('{{Tour}}') < 0 && units.tour) {
    units.text += '\n\n' + units.tour;
    units.html += '<p style="margin:0 0 8px">' + escapeHtml_(units.tour) + '</p>';
  }
  values.Units = units.text;
  values.Tour = units.tour;

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
      if (k === 'Units') return units.html;
      if (k === 'Tour') return escapeHtml_(values.Tour);
      if (k === 'About') {
        return '<strong>ABOUT ' + escapeHtml_(values.Property).toUpperCase() + '</strong><br>' +
          escapeHtml_(values.About).replace(/\n/g, '<br>');
      }
      if (k === 'Special') return escapeHtml_(values.Special).replace(/\n/g, '<br>');
      return escapeHtml_(values[k]);
    }));
  });

  // A section heading ("QUICK FACTS") whose bullets were all dropped goes too.
  for (var i = textLines.length - 1; i >= 0; i--) {
    if (!/^[A-Z][A-Z0-9 &'/-]+$/.test(textLines[i])) continue;
    var next = textLines.slice(i + 1).filter(function (l) { return l.trim(); })[0] || '';
    if (next.indexOf('•') !== 0) { textLines.splice(i, 1); htmlLines.splice(i, 1); }
  }

  // Headings ("WHAT YOU NEED TO QUALIFY") in bold.
  textLines.forEach(function (l, i) {
    if (/^[A-Z][A-Z0-9 &'/-]+$/.test(l)) htmlLines[i] = '<strong>' + htmlLines[i] + '</strong>';
  });

  // Collapse the blank lines left behind by dropped sections.
  var html = htmlLines.join('<br>').replace(/(<br>){3,}/g, '<br><br>');
  var text = textLines.join('\n').replace(/\n{3,}/g, '\n\n');
  var subject = profiles.subject.replace(/\{\{(\w+)\}\}/g, function (_, k) { return values[k] || ''; });
  return { subject: subject, html: '<div style="font-family:Arial,sans-serif;font-size:14px">' + html + '</div>', text: text,
    unitsShown: units.shown, bookable: units.bookable };
}

// The available units, each with its own Apply button and — only when the
// PM's AppFolio calendar has open times — a Book-a-showing button. A unit
// whose calendar is empty never gets a showing link (it would dead-end).
function unitsBlock_(property, match, pm) {
  // One unit per bedroom type (Studio, 1 bd, 2 bd...): the prospect sees the
  // range of what's open without a wall of near-identical cards. Within a
  // type: the unit they asked about, then a real unit over a wait list, then
  // one they can book a showing for, then the soonest available.
  var list = (match.building || []).slice();
  var slots = list.length ? showingSlots_(list) : {};
  var rank = function (l) {
    return [match.unit && l.uid === match.unit.uid ? 0 : 1, isWaitList_(l), (slots[l.uid] > 0 || property.ShowingLink) ? 0 : 1,
      availableSortKey_(l)];
  };
  var better = function (a, b) {
    var ra = rank(a), rb = rank(b);
    for (var i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  };
  var byBeds = {};
  list.forEach(function (l) {
    var k = bedKey_(l);
    if (!byBeds[k] || better(l, byBeds[k]) < 0) byBeds[k] = l;
  });
  var shown = Object.keys(byBeds).map(function (k) { return byBeds[k]; });
  shown.sort(function (a, b) {
    if (match.unit && a.uid === match.unit.uid) return -1;
    if (match.unit && b.uid === match.unit.uid) return 1;
    return bedSortValue_(a) - bedSortValue_(b);
  });
  var bookable = shown.filter(function (l) { return slots[l.uid] > 0 || property.ShowingLink; }).length;

  if (!shown.length) {
    // Only sent after hours (Responder.js); the PM is alerted to follow up.
    var none = pm + ' will follow up with you about current availability at ' + property.Property +
      ' on the next business day. You can also reply to this email.';
    return { text: none, html: escapeHtml_(none), shown: 0, bookable: 0, tour: '' };
  }

  var intro = match.unit
    ? 'Good news: the apartment you asked about is still available.' + (shown.length > 1 ? ' Other floor plans open right now:' : '')
    : 'Here is what is open right now, one of each floor plan:';
  var text = [intro, ''], html = ['<p style="margin:0 0 8px">' + escapeHtml_(intro) + '</p>'];

  shown.forEach(function (l) {
    var showUrl = property.ShowingLink || (slots[l.uid] > 0 ? l.showingUrl : '');
    var applyUrl = property.ApplyLink || l.applyUrl;
    var wait = isWaitList_(l);
    var facts = [l.bedBath, l.rent ? l.rent + '/mo' : '',
      wait ? 'Wait list' : l.available ? 'Available ' + (/now/i.test(l.available) ? 'now' : l.available) : '']
      .filter(String).join(' · ');
    var applyLabel = wait ? 'Join the wait list' : 'Apply now';
    var label = unitLabel_(l);

    text.push('• ' + label + (facts ? ' — ' + facts : ''));
    if (showUrl) text.push('  Book a showing: ' + showUrl);
    text.push('  ' + applyLabel + ': ' + applyUrl);

    html.push('<div style="border:1px solid #d9d9d9;border-radius:6px;padding:10px 12px;margin:0 0 8px">' +
      '<strong>' + escapeHtml_(label) + '</strong>' + (facts ? '<br><span style="color:#555">' + escapeHtml_(facts) + '</span>' : '') +
      '<br>' + (showUrl ? button_(showUrl, 'Book a showing', '#2e7d32') + ' ' : '') + button_(applyUrl, applyLabel, '#1565c0') + '</div>');
  });

  if (list.length > shown.length) {
    var allUrl = propertyListingsUrl_(property.Property, shown[0].account);
    text.push('', 'See all ' + list.length + ' available units: ' + allUrl);
    html.push('<p style="margin:0 0 8px"><a href="' + escapeHtml_(allUrl) + '">See all ' + list.length + ' available units</a></p>');
  }
  // Placed by the template's {{Tour}} line, after the qualifying criteria.
  var tour = bookable ? '' : 'Want to see it first? Reply to this email and ' + pm + ' will set up a time.';
  return { text: text.join('\n'), html: html.join(''), shown: shown.length, bookable: bookable, tour: tour };
}

// "33 Lafayette Ave SE, Apt 07, Grand Rapids, MI 49503" → "33 Lafayette Ave SE, Apt 07".
// Wait-list postings share the building address, so their title says more.
function unitLabel_(l) {
  if (isWaitList_(l)) return l.title;
  return l.address.replace(/,\s*[A-Za-z .]+,?\s*(?:MI\s*)?\d{5}(?:-\d{4})?\s*$/, '')
    .replace(/\s+-\s+[^,]+(?=,\s*(?:apt|unit)\b)/i, '')  // "1960 Burton St SE - 1960 IVA01, Apt 01"
    .replace(/,\s*-\s*/g, ', ')                           // "90 Wealthy Street SE, - 201"
    .replace(/\s*,\s*(,\s*)+/g, ', ').replace(/\s+,/g, ',').replace(/,\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

// "2 bd / 1.5 ba" → "2 bd"; "Studio / 1 ba" → "studio".
function bedKey_(l) {
  return String(l.bedBath || '').split('/')[0].trim().toLowerCase() || '?';
}

function bedSortValue_(l) {
  var k = bedKey_(l);
  return /studio/.test(k) ? 0 : (parseFloat(k) || 99);
}

function isWaitList_(l) {
  return /wait ?list/i.test(l.title) ? 1 : 0;
}

// The account's listings page filtered to this property when AppFolio has a
// property group by that name (e.g. "Victory on Leonard"); otherwise the
// whole account page. Checked live, remembered for a day.
function propertyListingsUrl_(propertyName, account) {
  var base = listingsBase_(account);
  var filtered = base + '?filters%5Bproperty_list%5D=' + encodeURIComponent(propertyName);
  var cache = CacheService.getScriptCache(), key = 'plist_' + Utilities.base64Encode(filtered).slice(0, 200);
  var hit = cache.get(key);
  if (hit) return hit;
  var url = base;
  try {
    var res = UrlFetchApp.fetch(filtered, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200 && /js-listing-address/.test(res.getContentText())) url = filtered;
  } catch (err) { /* fall back to the whole account page */ }
  cache.put(key, url, 24 * 60 * 60);
  return url;
}

function availableSortKey_(l) {
  if (!l.available || /now/i.test(l.available)) return 0;
  var t = new Date(l.available).getTime();
  return isNaN(t) ? 0 : t;
}

function button_(url, label, color) {
  return '<a href="' + escapeHtml_(url) + '" style="display:inline-block;margin-top:6px;padding:7px 14px;border-radius:4px;' +
    'background:' + color + ';color:#ffffff;text-decoration:none;font-weight:bold">' + label + '</a>';
}

// The special runs through the whole SpecialEnds day (Detroit time); blank = no end.
function specialExpired_(ends) {
  if (!ends) return false;
  var end = ends instanceof Date ? ends : new Date(ends);
  if (isNaN(end.getTime())) return false;
  var tz = 'America/Detroit';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') > Utilities.formatDate(end, tz, 'yyyy-MM-dd');
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
