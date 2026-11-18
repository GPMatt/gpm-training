// GPM Lead Responder — property scan: fills the Properties tab from Supabase
// and the guest cards in this mailbox.
//
// runPropertyScan() (PropertyScan.gs) — run it ONCE from the editor. It:
//   1. Reads every guest-card email from the last SCAN_DAYS days, oldest day
//      first. A run stops at ~4.5 min and schedules itself to carry on a
//      minute later, so the whole scan finishes on its own (watch the
//      ScanCards tab grow). Gmail is only read: nothing is sent or labeled.
//   2. Reads the active properties from Supabase (dim_property) and keeps the
//      residential ones (Single-Family, Multi-Family, Mixed-Use), minus
//      Jefferson, Green Miscellaneous and anything Matt removed on purpose.
//   3. Edits the Properties tab:
//        - an existing row for a property gets any MatchPhrases it lacks
//          (phrases are only ever added, never removed or reworded)
//        - a property with no row gets a new row with Status Off, PM and
//          PM email from Supabase
//      A phrase that would also match another row is NOT written (it would
//      make that row's leads AMBIGUOUS, and AMBIGUOUS leads get no reply).
//   4. Saves a copy of the Properties tab first ("Properties backup <date>"),
//      writes a PropertyScan tab listing every change and every lead or posted
//      unit still not covered, and emails Matt the summary.
//
// Needs Script Properties SUPABASE_URL and SUPABASE_KEY (the same values as
// the warehouse pipeline's .env). resetPropertyScan() starts over.

var SCAN_DAYS = 60;
var SCAN_CARDS_TAB = 'ScanCards';
var SCAN_REPORT_TAB = 'PropertyScan';
var SCAN_CARDS_HEADER = ['Received', 'Account', 'Headline', 'InterestedIn', 'Subject', 'MsgId'];
var SCAN_TIME_BUDGET_MS = 4.5 * 60 * 1000;
var SCAN_RESIDENTIAL_TYPES = ['Single-Family', 'Multi-Family', 'Mixed-Use'];
var SCAN_SKIP_ACCOUNTS = ['Jeff'];                 // Jefferson is out of this project (Matt)
var SCAN_SKIP_NAME_PREFIXES = ['green miscellaneous'];
var SCAN_SKIP_PHRASES = ['28 gold'];               // 28 Gold removed on purpose (Updates.gs REMOVE_PROPERTIES)
var SCAN_SHEET_ROWS = 300;                         // Missing formula, dropdowns and colors reach this row

// Known PM inboxes. A PM not listed here gets a blank PMEmail, which the
// Missing column flags, so nobody's leads go to a guessed address.
var PM_EMAILS = {
  'Mike Green': 'mike@greenpropertymgt.com',
  'Jody Betsch': 'jody@greenpropertymgt.com',
  'Blake Roush': 'blake@greenpropertymgt.com',
  'Jason Holmes': 'jason@greenpropertymgt.com',
  'Laura Porter': 'laura@greenpropertymgt.com',
  'Spencer Green': 'spencer@greenpropertymgt.com'
};
// Supabase has no PM for the non-11 accounts; these are Matt's assignments.
var PM_BY_ACCOUNT = { IVA: 'Jody Betsch', OAK: 'Mike Green' };

var STREET_SUFFIXES = /^(st|street|ave|avenue|dr|drive|ln|lane|rd|road|ct|court|pl|place|blvd|way|cir|circle|pkwy|ter|trl|hwy)\.?$/;
var DIRECTIONS = /^(n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?$/;

function runPropertyScan() {
  var props = PropertiesService.getScriptProperties();
  // User lock, not the script lock: the 5-minute responder takes the script
  // lock, and the scan must never hold up live replies.
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return;
  try {
    deleteScanTriggers_();
    var ss = SpreadsheetApp.openById(props.getProperty('PROFILES_SHEET_ID'));
    if (!props.getProperty('SUPABASE_URL') || !props.getProperty('SUPABASE_KEY')) {
      throw new Error('Set Script Properties SUPABASE_URL and SUPABASE_KEY first.');
    }
    var done = scanGuestCards_(ss);
    if (!done) {
      ScriptApp.newTrigger('runPropertyScan').timeBased().after(60 * 1000).create();
      Logger.log('Scan paused at ' + props.getProperty('SCAN_NEXT_DAY') + '; it carries on by itself in a minute.');
      return;
    }
    applyPropertyScan_(ss);
  } finally {
    lock.releaseLock();
  }
}

function resetPropertyScan() {
  deleteScanTriggers_();
  PropertiesService.getScriptProperties().deleteProperty('SCAN_NEXT_DAY');
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var t = ss.getSheetByName(SCAN_CARDS_TAB);
  if (t) ss.deleteSheet(t);
  Logger.log('Property scan reset. Run runPropertyScan() to start over.');
}

function deleteScanTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runPropertyScan') ScriptApp.deleteTrigger(t);
  });
}

// ---- 1. Guest cards --------------------------------------------------------

// Returns true once every day in the window is in the ScanCards tab.
function scanGuestCards_(ss) {
  var props = PropertiesService.getScriptProperties();
  var started = Date.now();
  var sheet = ss.getSheetByName(SCAN_CARDS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SCAN_CARDS_TAB);
    sheet.getRange(1, 1, 1, SCAN_CARDS_HEADER.length).setValues([SCAN_CARDS_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  var seen = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 6, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) { seen[r[0]] = true; });
  }

  var tz = 'America/Detroit';
  var today = new Date(Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd'));
  var first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - SCAN_DAYS);
  var day = props.getProperty('SCAN_NEXT_DAY') ? new Date(props.getProperty('SCAN_NEXT_DAY')) : first;

  while (day <= today) {
    if (Date.now() - started > SCAN_TIME_BUDGET_MS) return false;
    var next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1); // calendar day, safe across DST
    var q = 'in:anywhere from:guestcards@appfolio.com after:' + Utilities.formatDate(day, tz, 'yyyy/MM/dd') +
      ' before:' + Utilities.formatDate(next, tz, 'yyyy/MM/dd');
    var rows = [];
    for (var start = 0; ; start += 100) {
      var threads = GmailApp.search(q, start, 100);
      if (!threads.length) break;
      GmailApp.getMessagesForThreads(threads).forEach(function (msgs) {
        msgs.forEach(function (m) {
          var id = m.getId();
          if (seen[id] || m.getFrom().indexOf('guestcards@appfolio.com') < 0) return;
          if (m.getDate().getTime() < first.getTime()) return;
          seen[id] = true;
          var c = parseGuestCard_(m.getSubject(), m.getBody());
          rows.push([m.getDate(), c.account, c.headline, c.interestedIn, m.getSubject(), id]);
        });
      });
      if (threads.length < 100) break;
    }
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SCAN_CARDS_HEADER.length).setValues(rows);
    day = next;
    props.setProperty('SCAN_NEXT_DAY', Utilities.formatDate(day, tz, 'yyyy/MM/dd'));
  }
  return true;
}

function readScanCards_(ss) {
  var sheet = ss.getSheetByName(SCAN_CARDS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, SCAN_CARDS_HEADER.length).getValues().map(function (r) {
    return { received: r[0], account: String(r[1]), headline: String(r[2]), interestedIn: String(r[3]), subject: String(r[4]) };
  });
}

// ---- 2. Supabase -----------------------------------------------------------

function fetchSupabaseProperties_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL').replace(/\/+$/, '') +
    '/rest/v1/dim_property?select=af_account,af_property_name,canonical_address,property_type,pm_name&active=eq.true';
  var key = props.getProperty('SUPABASE_KEY');
  var res = UrlFetchApp.fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Supabase returned ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

// → {keep: [...], skipped: [{name, why}]}
function filterScanProperties_(rows) {
  var keep = [], skipped = [];
  rows.forEach(function (p) {
    var name = String(p.af_property_name || '');
    var lower = name.toLowerCase();
    var why = '';
    if (SCAN_SKIP_ACCOUNTS.indexOf(p.af_account) >= 0) why = 'Account ' + p.af_account + ' is out of this project';
    else if (SCAN_RESIDENTIAL_TYPES.indexOf(p.property_type) < 0) why = p.property_type + ', not residential';
    else if (SCAN_SKIP_NAME_PREFIXES.some(function (s) { return lower.indexOf(s) === 0; })) why = 'Not a rental';
    else if (SCAN_SKIP_PHRASES.some(function (ph) { return containsPhrase_(lower, ph); })) why = 'Removed from the sheet on purpose';
    if (why) skipped.push({ name: name, why: why }); else keep.push(p);
  });
  return { keep: keep, skipped: skipped };
}

// ---- Phrase building (pure, no Apps Script calls) --------------------------

// "16-18 Packard Ave SE" → ['16 packard', '18 packard']
// "31 E Ash St,"         → ['31 e ash']
// "O-680 Lake Michigan"  → ['680 lake michigan']
// Returns [] when the text doesn't start with a street number.
function addressPhrases_(s) {
  s = String(s || '').toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[a-z]-(?=\d)/, '');
  var m = s.match(/^(\d+)(?:\s*(?:-|&|and)\s*(\d+))?\s+(.+)$/);
  if (!m) return [];
  var words = m[3].split(' ');
  var street = [];
  if (DIRECTIONS.test(words[0]) && words.length > 1 && !STREET_SUFFIXES.test(words[1])) street.push(words.shift());
  if (!words.length || STREET_SUFFIXES.test(words[0]) || DIRECTIONS.test(words[0])) return [];
  // The whole street name, up to its suffix/direction/unit: "2935 oak valley",
  // "680 lake michigan". Never a bare number.
  for (var i = 0; i < words.length && street.length < 4; i++) {
    if (i > 0 && (STREET_SUFFIXES.test(words[i]) || DIRECTIONS.test(words[i]) || /^(unit|apt|ste|suite|#)/.test(words[i]))) break;
    street.push(words[i]);
  }
  var name = street.join(' ');

  var nums = [m[1]];
  if (m[2]) {
    var a = Number(m[1]), b = Number(m[2]);
    if (b > a && b - a <= 20) {
      for (var n = a + 2; n <= b; n += 2) nums.push(String(n)); // same side of the street
      if ((b - a) % 2) nums.push(m[2]);
    } else if (b !== a) nums.push(m[2]);
  }
  return nums.filter(function (v, i) { return nums.indexOf(v) === i; }).map(function (n) { return n + ' ' + name; });
}

// The AppFolio nickname ("Cardinal Point - 445 Knapp St NE ...") as a phrase,
// unless it is just the street name ("Christie", "Fase St"), which would match
// other owners' buildings on that street.
function namePhrase_(p) {
  var full = String(p.af_property_name || '').split(' - ')[0].replace(/\(.*?\)/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!full || /^[a-z]?-?\d/.test(full)) return '';
  var short = full.replace(/\s+(apartments|apts)$/, '');
  // "Eaglebrook Apartments" → "eaglebrook"; but "Oak Valley Apartments" stays
  // whole, because "oak valley" alone is just the street.
  if (!isStreetOnly_(short, p.canonical_address)) return short;
  return isStreetOnly_(full, p.canonical_address) ? '' : full;
}

// "Christie", "Oak Valley", "Fase St": nothing but the property's own street.
function isStreetOnly_(nick, address) {
  var streetWords = String(address || '').toLowerCase().replace(/[,.]/g, ' ').split(/\s+/)
    .filter(function (w) { return w && !/^\d/.test(w) && !STREET_SUFFIXES.test(w) && !DIRECTIONS.test(w); });
  var nickWords = String(nick).replace(/[,.]/g, ' ').split(/\s+/).filter(function (w) {
    return w && !STREET_SUFFIXES.test(w) && !DIRECTIONS.test(w);
  });
  return nickWords.every(function (w) { return streetWords.indexOf(w) >= 0; });
}

function phrasesForProperty_(p) {
  var nick = String(p.af_property_name || '').split(' - ')[0];
  var out = addressPhrases_(p.canonical_address).concat(addressPhrases_(nick));
  var name = namePhrase_(p);
  if (name) out.push(name);
  return out.filter(function (v, i) { return v && out.indexOf(v) === i; });
}

// What prospects see. A real name ("Cardinal Point") beats an address;
// otherwise the fuller of the nickname and the canonical address.
function displayName_(p) {
  var nick = String(p.af_property_name || '').split(' - ')[0].replace(/\s+/g, ' ').trim();
  if (namePhrase_(p)) return nick;
  var addr = String(p.canonical_address || '').replace(/[,\s]+$/, '').replace(/\s+/g, ' ');
  // No " - " means the AppFolio name is the full mailing address (city, zip).
  if (String(p.af_property_name || '').indexOf(' - ') < 0) return addr || nick;
  return nick.length > addr.length ? nick : addr;
}

// Does `phrase` overlap any phrase in `list` (either one would match text
// the other matches)?
function phraseOverlaps_(phrase, list) {
  return list.some(function (q) { return containsPhrase_(phrase, q) || containsPhrase_(q, phrase); });
}

// ---- 3. Apply --------------------------------------------------------------

function applyPropertyScan_(ss) {
  var stamp = Utilities.formatDate(new Date(), 'America/Detroit', 'yyyy-MM-dd');
  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var backup = sheet.copyTo(ss).setName('Properties backup ' + stamp + ' ' + Utilities.formatDate(new Date(), 'America/Detroit', 'HHmm'));
  backup.hideSheet();

  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  header.forEach(function (h, i) { col[h] = i + 1; });
  var data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues() : [];
  var rows = data.filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    var o = {}; header.forEach(function (h, i) { o[h] = r[i]; }); return o;
  });
  var rowsBefore = rows.length;

  var supa = filterScanProperties_(fetchSupabaseProperties_());
  var cards = readScanCards_(ss);
  var plan = planPropertyScan_(rows, supa.keep, cards, stamp);
  var report = plan.report, changes = plan.changes;
  supa.skipped.forEach(function (s) { report.push(['Skipped property', s.name, s.why, '']); });

  // Check the result against every scanned lead and every posted unit.
  var listings = fetchAllListings_();
  var tally = {}, unmatched = {}, perRow = {};
  cards.forEach(function (c) {
    var r = matchCard_(c, listings, rows);
    tally[r.outcome] = (tally[r.outcome] || 0) + 1;
    if (r.outcome === 'NO_PROFILE' || r.outcome === 'AMBIGUOUS') {
      var k = r.outcome + '|' + (c.headline || c.subject);
      unmatched[k] = unmatched[k] || { n: 0, reason: r.reason };
      unmatched[k].n++;
    } else {
      perRow[r.profile.Property] = (perRow[r.profile.Property] || 0) + 1;
    }
  });
  Object.keys(unmatched).sort(function (a, b) { return unmatched[b].n - unmatched[a].n; }).forEach(function (k) {
    var parts = k.split('|');
    report.push([parts[0] === 'AMBIGUOUS' ? 'Lead AMBIGUOUS' : 'Lead not covered', parts.slice(1).join('|'), unmatched[k].reason, unmatched[k].n]);
  });
  listings.forEach(function (l) {
    if (l.account === 'hilltoprealtymanagement') return;
    var covered = rows.some(function (r) {
      return phrasesOf(r).some(function (ph) { return /^\d/.test(ph) && containsPhrase_(l.address, ph); });
    });
    if (!covered) report.push(['Posted unit not covered', l.address, l.title + ' (' + l.account + ')', '']);
  });
  rows.forEach(function (r) { report.push(['Leads per row (' + SCAN_DAYS + 'd)', r.Property, r.Status || '', perRow[r.Property] || 0]); });

  // Write: only Property, MatchPhrases, PM, PMEmail, Status, Notes. The
  // Missing formula and every other cell are left as they are.
  extendPropertiesSheet_(sheet, col, Math.max(SCAN_SHEET_ROWS, rows.length + 51));
  ['Property', 'MatchPhrases', 'PM', 'PMEmail', 'Status', 'Notes'].forEach(function (name) {
    if (!col[name]) return;
    var values = rows.map(function (r) { return [r[name] === undefined || r[name] === null ? '' : r[name]]; });
    sheet.getRange(2, col[name], values.length, 1).setValues(values);
  });

  var rep = ss.getSheetByName(SCAN_REPORT_TAB) || ss.insertSheet(SCAN_REPORT_TAB);
  rep.clear();
  var head = [['Section', 'Property / lead', 'Detail', 'Count']];
  var out = head.concat(report);
  rep.getRange(1, 1, out.length, 4).setValues(out);
  rep.getRange(1, 1, 1, 4).setFontWeight('bold');
  rep.setFrozenRows(1);
  rep.setColumnWidth(1, 200); rep.setColumnWidth(2, 300); rep.setColumnWidth(3, 520);

  var summary = 'Property scan ' + stamp + ': ' + cards.length + ' guest cards over ' + SCAN_DAYS + ' days, ' +
    supa.keep.length + ' residential properties in Supabase.\n' +
    'Rows: ' + rowsBefore + ' → ' + rows.length + ' (' + changes.added + ' new, Status Off). ' +
    changes.appended + ' existing rows got new phrases. ' + changes.dropped + ' phrases held back (would clash).\n' +
    'Leads after the update: ' + JSON.stringify(tally) + '\n' +
    'Details: PropertyScan tab. Backup: "' + backup.getName() + '" (hidden tab).\n' + ss.getUrl();
  GmailApp.sendEmail(ALERT_EMAIL, 'Lead responder: property scan done', summary);
  Logger.log(summary);
  PropertiesService.getScriptProperties().deleteProperty('SCAN_NEXT_DAY');
}

// The whole decision, with no Apps Script calls, so it can be dry-run
// outside Apps Script. `rows` is changed in place (phrases appended, new
// rows pushed).
function planPropertyScan_(rows, keep, cards, stamp) {
  var report = [];   // [Section, Property, Detail, Count]
  var changes = { added: 0, appended: 0, dropped: 0 };

  // Match each Supabase property to an existing row.
  var plans = keep.map(function (p) {
    var phrases = phrasesForProperty_(p);
    var name = String(p.af_property_name).toLowerCase();
    var hits = rows.filter(function (r) {
      var own = phraseList_(r);
      return own.some(function (ph) { return phrases.indexOf(ph) >= 0 || containsPhrase_(name, ph); });
    });
    return { p: p, phrases: phrases, hits: hits };
  });

  // Names prospects actually use: "Interested in: X - unit" on cards whose
  // headline address is this property. Two or more cards, one property only.
  var nameVotes = {};
  cards.forEach(function (c) {
    var nick = c.interestedIn.split(/\s+-\s+/)[0].toLowerCase().replace(/\s+/g, ' ').trim();
    if (!nick || /^\d/.test(nick) || nick.length < 5) return;
    plans.forEach(function (pl, i) {
      if (isStreetOnly_(nick, pl.p.canonical_address)) return;
      if (pl.phrases.some(function (ph) { return /^\d/.test(ph) && containsPhrase_(c.headline, ph); })) {
        nameVotes[nick] = nameVotes[nick] || {};
        nameVotes[nick][i] = (nameVotes[nick][i] || 0) + 1;
      }
    });
  });
  Object.keys(nameVotes).forEach(function (nick) {
    var ids = Object.keys(nameVotes[nick]);
    if (ids.length !== 1 || nameVotes[nick][ids[0]] < 2) return;
    var pl = plans[Number(ids[0])];
    if (!phraseOverlaps_(nick, pl.phrases)) {
      pl.phrases.push(nick);
      report.push(['Learned from leads', displayName_(pl.p), '"' + nick + '"', nameVotes[nick][ids[0]]]);
    }
  });

  // Every phrase in use by a row, for the overlap check.
  var phrasesOf = function (r) { return phraseList_(r); };

  plans.forEach(function (pl) {
    if (pl.hits.length > 1) {
      report.push(['Not changed: matches 2+ rows', displayName_(pl.p),
        pl.hits.map(function (r) { return r.Property; }).join(' | '), '']);
      return;
    }
    var target = pl.hits[0];
    var isNew = !target;
    if (isNew) {
      var pm = pl.p.pm_name || PM_BY_ACCOUNT[pl.p.af_account] || '';
      target = { Property: displayName_(pl.p), MatchPhrases: '', PM: pm, PMEmail: PM_EMAILS[pm] || '', Status: 'Off',
        Notes: 'Added by property scan ' + stamp + ' from Supabase. AppFolio (' + pl.p.af_account + '): ' + pl.p.af_property_name + '.' };
    }
    var own = phrasesOf(target);
    var others = rows.filter(function (r) { return r !== target; });
    var add = [];
    pl.phrases.forEach(function (ph) {
      if (phraseOverlaps_(ph, own) || add.indexOf(ph) >= 0) return;
      var clash = others.filter(function (r) { return phraseOverlaps_(ph, phrasesOf(r)); });
      if (clash.length) {
        report.push(['Phrase NOT added (clash)', target.Property, '"' + ph + '" also matches ' + clash.map(function (r) { return r.Property; }).join(', '), '']);
        changes.dropped++;
        return;
      }
      add.push(ph);
    });
    if (isNew) {
      if (!add.length) {
        report.push(['Not added: no usable phrase', target.Property, pl.p.af_property_name, '']);
        return;
      }
      target.MatchPhrases = add.join('; ');
      rows.push(target);
      changes.added++;
      report.push(['New row (Off)', target.Property, target.MatchPhrases + (target.PMEmail ? '' : '  · PM email blank: ' + (target.PM || 'no PM')), '']);
    } else if (add.length) {
      target.MatchPhrases = own.concat(add).join('; ');
      changes.appended++;
      report.push(['Phrases added', target.Property + ' (' + (target.Status || 'blank') + ')', add.join('; '), '']);
    }
  });

  return { report: report, changes: changes };
}

// Missing formula, dropdowns and colors were set up for rows 2-100; carry
// them down to `lastRow` so new rows behave like the old ones.
function extendPropertiesSheet_(sheet, col, lastRow) {
  if (sheet.getMaxRows() < lastRow) sheet.insertRowsAfter(sheet.getMaxRows(), lastRow - sheet.getMaxRows());
  var n = lastRow - 1;
  if (col.Missing) {
    var f = [];
    for (var r = 2; r <= lastRow; r++) f.push([missingFormula_(col, r)]);
    sheet.getRange(2, col.Missing, n, 1).setFormulas(f).setFontColor('#cc0000');
  }
  var statuses = STATUS_VALUES.slice();
  sheet.getRange(2, col.Status, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(statuses, true).build());
  ['SpecialEnds', 'LastReviewed'].forEach(function (name) {
    if (!col[name]) return;
    sheet.getRange(2, col[name], n, 1).setNumberFormat('m/d/yyyy').setDataValidation(
      SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  });
  if (col.Notes) sheet.getRange(2, col.Notes, n, 1).setWrap(true);
  var rules = sheet.getConditionalFormatRules().map(function (rule) {
    var ranges = rule.getRanges().map(function (g) {
      return g.getRow() >= 2 ? sheet.getRange(g.getRow(), g.getColumn(), lastRow - g.getRow() + 1, g.getNumColumns()) : g;
    });
    return rule.copy().setRanges(ranges).build();
  });
  sheet.setConditionalFormatRules(rules);
}
