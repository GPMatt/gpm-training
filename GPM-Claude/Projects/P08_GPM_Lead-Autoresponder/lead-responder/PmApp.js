// GPM Lead Responder — PM app (web app, GPM domain only)
//
// A PM picks their name and a property, sees the live posted units and which
// links the email will carry, edits their part of the row, previews the
// whole email exactly as a prospect would get it, and saves. Saves go
// straight to the Properties tab (the responder reads it on the next lead),
// are logged to the "PM Edits" tab and emailed to Matt.
//
// PMs and their emails live in the "PMs" tab, not in code: reassigning a
// property or adding a PM never needs a project change.
//
// installPmApp() (PmApp.gs) — run once: adds the About column (copies any
// WriteupDoc text into it), the PMs and PM Edits tabs, and removes the old
// Preview-checkbox trigger.

var PMS_TAB = 'PMs';
var PM_EDITS_TAB = 'PM Edits';
var ABOUT_COL = 'About';
var VOTE_COL = 'TurnOffAppFolioReply';
var OLD_INCOME_LINE = '• Combined household income of {{IncomeMultiple}}x the monthly rent';
var NEW_INCOME_LINE = '• Gross household income of {{IncomeMultiple}}x the monthly rent';

// What a PM may change from the app. Cosigner / Section 8 stay sheet-only.
var APP_FIELDS = ['PM', 'PMEmail', 'Status', 'ShowingLink', 'Special', 'SpecialEnds', 'About', 'Pets',
  'LeaseLengths', 'RentRange', 'VirtualTourLink', 'CreditMin', 'IncomeMultiple', VOTE_COL];

function doGet() {
  return HtmlService.createTemplateFromFile('PmAppPage').evaluate()
    .setTitle('GPM Lead Responder')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- install ----------

function installPmApp() {
  var ss = profilesSs_();
  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var col = headerCols_(sheet);

  if (!col[ABOUT_COL]) {
    var c = sheet.getLastColumn() + 1;
    sheet.getRange(1, c).setValue(ABOUT_COL).setFontWeight('bold').setBackground('#d9ead3')
      .setNote('The PM\'s blurb about the property (neighborhood, amenities, parking). Edited in the PM app; shown under "ABOUT <PROPERTY>". No prices or policies.');
    col = headerCols_(sheet);
    if (col.WriteupDoc && sheet.getLastRow() > 1) {
      var docs = sheet.getRange(2, col.WriteupDoc, sheet.getLastRow() - 1, 1).getValues();
      var copied = 0;
      docs.forEach(function (r, i) {
        var text = readWriteup_(r[0]);
        if (text) { sheet.getRange(i + 2, c).setValue(text); copied++; }
      });
      Logger.log('About column added; copied ' + copied + ' write-up doc(s) into it.');
    }
    sheet.getRange(2, c, Math.max(sheet.getLastRow() - 1, 1), 1).setWrap(true);
  }

  if (!ss.getSheetByName(PMS_TAB)) {
    var pms = ss.insertSheet(PMS_TAB);
    var seen = {}, rows = [];
    var add = function (n, e) { n = String(n || '').trim(); if (n && !seen[n]) { seen[n] = true; rows.push([n, String(e || '').trim()]); } };
    Object.keys(PM_EMAILS).forEach(function (n) { add(n, PM_EMAILS[n]); });
    loadProfiles_().properties.forEach(function (p) { add(p.PM, p.PMEmail); });
    pms.getRange(1, 1, 1, 2).setValues([['Name', 'Email']]).setFontWeight('bold');
    pms.getRange(2, 1, rows.length, 2).setValues(rows);
    pms.setFrozenRows(1);
    pms.getRange('A1').setNote('Everyone who can be picked as a PM in the app. Add a row (or use "Add a new PM" in the app); no code change needed.');
  }

  if (!ss.getSheetByName(PM_EDITS_TAB)) {
    var log = ss.insertSheet(PM_EDITS_TAB);
    log.getRange(1, 1, 1, 6).setValues([['When', 'Who', 'Property', 'Field', 'Before', 'After']]).setFontWeight('bold');
    log.setFrozenRows(1);
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendRequestedPreviews') ScriptApp.deleteTrigger(t);
  });
  Logger.log('PM app ready. Deploy it as a web app (Execute as: me, Who has access: anyone in greenpropertymgt.com).');
}

// One-time, 2026-11-23: Jason off the PM list, company standards 625 / 3x gross,
// the "turn off AppFolio's auto-reply" vote column, and the income line in the
// Template tab reworded to "Gross household income". Safe to run twice.
function applyPmAppUpgrade20261123() {
  var ss = profilesSs_();
  var log = [];

  var pms = ss.getSheetByName(PMS_TAB);
  var props = loadProfiles_().properties;
  var stillJason = props.filter(function (p) { return /jason/i.test(p.PM); }).map(function (p) { return p.Property; });
  if (stillJason.length) {
    log.push('Jason NOT removed: still the PM on ' + stillJason.join(', ') + '. Reassign those first.');
  } else if (pms) {
    for (var r = pms.getLastRow(); r >= 2; r--) {
      if (/^jason\b/i.test(String(pms.getRange(r, 1).getValue()).trim())) { pms.deleteRow(r); log.push('Removed Jason from the PMs tab.'); }
    }
  }

  var defs = ss.getSheetByName(DEFAULTS_TAB);
  var rows = defs.getRange(2, 1, defs.getLastRow() - 1, 3).getValues();
  [['CreditMin', 625, 'Company standard credit score'], ['IncomeMultiple', 3, 'Company standard: gross household income of 3x the monthly rent']].forEach(function (d) {
    rows.forEach(function (row, i) {
      if (row[0] !== d[0]) return;
      if (String(row[1]).trim() === '') { defs.getRange(i + 2, 2).setValue(d[1]); log.push('Defaults ' + d[0] + ' = ' + d[1]); }
      else log.push('Defaults ' + d[0] + ' already ' + row[1] + ' (left as is)');
      defs.getRange(i + 2, 3).setValue(d[2]);
    });
  });

  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var col = headerCols_(sheet);
  if (!col[VOTE_COL]) {
    var c = sheet.getLastColumn() + 1;
    sheet.getRange(1, c).setValue(VOTE_COL).setFontWeight('bold').setBackground('#d9ead3')
      .setNote('Ticked by the PM in the app: they want AppFolio\'s own generic guest-card auto-reply turned off for this property, so prospects get only our email. Turning it off is done in AppFolio.');
    var n = 1;
    sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues().forEach(function (x, i) { if (String(x[0]).trim()) n = i + 1; });
    sheet.getRange(2, c, n, 1).insertCheckboxes();
    log.push('Added the ' + VOTE_COL + ' checkbox column.');
  }

  var tpl = ss.getSheetByName(TEMPLATE_TAB);
  var body = String(tpl.getRange(2, 2).getValue());
  if (body.indexOf(OLD_INCOME_LINE) >= 0) { tpl.getRange(2, 2).setValue(body.replace(OLD_INCOME_LINE, NEW_INCOME_LINE)); log.push('Template: income line now says "Gross household income".'); }
  Logger.log(log.join('\n'));
}

// ---------- API for PmApp.html ----------

function pmAppInit() {
  var profiles = loadProfiles_();
  return {
    user: currentUser_(),
    pms: readPms_(),
    properties: profiles.properties.map(function (p) { return { name: p.Property, pm: p.PM || '', status: p.Status || '' }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); }),
    defaults: { CreditMin: profiles.defaults.CreditMin || '', IncomeMultiple: profiles.defaults.IncomeMultiple || '' }
  };
}

// Current saved row + live units + preview.
function pmAppLoad(name) {
  var profiles = loadProfiles_();
  var p = findProfile_(profiles, name);
  return buildView_(p, profiles);
}

// Preview with unsaved edits applied (nothing is written).
function pmAppPreview(name, edits) {
  var profiles = loadProfiles_();
  var p = findProfile_(profiles, name);
  var clean = cleanEdits_(edits, readPms_(), profiles.defaults);
  var q = {};
  Object.keys(p).forEach(function (k) { q[k] = p[k]; });
  Object.keys(clean.values).forEach(function (k) { q[k] = clean.values[k]; });
  var view = buildView_(q, profiles);
  view.errors = clean.errors;
  return view;
}

function pmAppSave(name, edits) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var profiles = loadProfiles_();
    var p = findProfile_(profiles, name);
    var clean = cleanEdits_(edits, readPms_(), profiles.defaults);
    if (clean.errors.length) return { ok: false, errors: clean.errors };

    var next = {};
    Object.keys(p).forEach(function (k) { next[k] = p[k]; });
    Object.keys(clean.values).forEach(function (k) { next[k] = clean.values[k]; });
    var missing = missingFor_(next, profiles.defaults);
    if (next.Status === 'Live' && missing.length) {
      return { ok: false, errors: ['Can\'t turn this property Live yet. Fill in: ' + missing.join(', ') + '.'] };
    }

    var sheet = profilesSs_().getSheetByName(PROPERTIES_TAB);
    var col = headerCols_(sheet);
    var r = rowOf_(sheet, name);
    var who = currentUser_() || 'unknown';
    var when = new Date();
    var changes = [];
    APP_FIELDS.forEach(function (f) {
      if (!(f in clean.values) || !col[f]) return;
      var before = sheet.getRange(r, col[f]).getValue();
      var after = clean.values[f];
      if (f === VOTE_COL ? (before === true || String(before).toUpperCase() === 'TRUE') === after : sameValue_(before, after)) return;
      sheet.getRange(r, col[f]).setValue(after);
      changes.push([when, who, name, f, displayValue_(before), displayValue_(after)]);
    });
    if (!changes.length) return { ok: true, changed: 0, view: buildView_(p, profiles) };
    if (col.LastReviewed) sheet.getRange(r, col.LastReviewed).setValue(when);

    var log = profilesSs_().getSheetByName(PM_EDITS_TAB);
    if (log) log.getRange(log.getLastRow() + 1, 1, changes.length, 6).setValues(changes);
    try {
      GmailApp.sendEmail(ALERT_EMAIL, '[Lead Responder] ' + who + ' edited ' + name,
        changes.map(function (c) {
          if (c[3] === VOTE_COL) return c[5] === 'true' ? '>>> VOTE: turn OFF AppFolio\'s generic auto-reply for ' + name + ' (do this in AppFolio).' : 'Vote to turn off AppFolio\'s auto-reply withdrawn.';
          return c[3] + ': "' + c[4] + '" → "' + c[5] + '"';
        }).join('\n') +
        '\n\nFull history: PM Edits tab of GPM Lead Response Profiles.');
    } catch (e) { Logger.log('Edit email failed: ' + e); }

    SpreadsheetApp.flush();
    var fresh = loadProfiles_();
    return { ok: true, changed: changes.length, view: buildView_(findProfile_(fresh, name), fresh) };
  } finally {
    lock.releaseLock();
  }
}

function pmAppAddPm(pmName, email) {
  pmName = String(pmName || '').trim();
  email = String(email || '').trim().toLowerCase();
  if (!pmName) throw new Error('Type the PM\'s name.');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) throw new Error('That email doesn\'t look right.');
  var pms = readPms_();
  if (pms.some(function (x) { return x.name.toLowerCase() === pmName.toLowerCase(); })) throw new Error(pmName + ' is already on the list.');
  var sheet = profilesSs_().getSheetByName(PMS_TAB);
  sheet.appendRow([pmName, email]);
  try {
    GmailApp.sendEmail(ALERT_EMAIL, '[Lead Responder] New PM added: ' + pmName, pmName + ' <' + email + '> was added by ' + (currentUser_() || 'unknown') + '.');
  } catch (e) { Logger.log(e); }
  return readPms_();
}

// ---------- helpers ----------

function buildView_(p, profiles) {
  var listings = fetchAllListings_();
  var match = buildingMatch_(p, listings, profiles.properties);
  var mail = renderEmail_(p, profiles, 'Jordan', match);
  var checks = match.building.length ? showingCheck_(match.building, false) : {};
  var link = String(p.ShowingLink || '').trim();
  var mode = /^(off|none|no)$/i.test(link) ? 'off' : link ? 'custom' : 'auto';
  var shown = {};
  (mail.shownUids || []).forEach(function (u) { shown[u] = true; });

  var units = match.building.map(function (l) {
    var c = checks[l.uid] || { v: -1, why: '' };
    var book = '';
    if (shown[l.uid]) book = mode === 'off' ? '' : mode === 'custom' ? link : (c.v === 1 ? l.showingUrl : '');
    return {
      label: unitLabel_(l), bedBath: l.bedBath, rent: l.rent, available: l.available,
      appFolioButton: c.v === 1 ? 'Yes' : c.v === 0 ? 'No' : 'Check failed', why: c.why,
      inEmail: !!shown[l.uid], applyUrl: p.ApplyLink || l.applyUrl, bookUrl: book, detailUrl: l.detailUrl
    };
  }).sort(function (a, b) { return (b.inEmail - a.inEmail) || a.label.localeCompare(b.label); });

  var row = {};
  APP_FIELDS.forEach(function (f) {
    var v = p[f];
    if (f === 'SpecialEnds') v = v instanceof Date ? Utilities.formatDate(v, 'America/Detroit', 'yyyy-MM-dd') : String(v || '');
    row[f] = v === null || v === undefined ? '' : String(v);
  });
  row.ShowingMode = mode;
  row[VOTE_COL] = p[VOTE_COL] === true || String(p[VOTE_COL]).toUpperCase() === 'TRUE';

  var missing = missingFor_(p, profiles.defaults);
  var notes = [];
  if (match.outcome === 'NO_VACANCY') notes.push('No posted units match this property right now. A real lead gets a short holding reply and the PM gets an alert instead of this email.');
  if (p.Special && specialExpired_(p.SpecialEnds)) notes.push('The Special is past its end date, so it is left out.');
  if (!String(p.About || '').trim() && p.WriteupDoc) notes.push('The About section comes from the old WriteupDoc link. Type a blurb here to replace it.');
  if (mode === 'custom') notes.push('Every unit in the email uses your own booking link, whatever AppFolio shows.');

  return {
    name: p.Property, row: row, missing: missing, notes: notes, voteColumn: !!(VOTE_COL in p),
    defaults: { CreditMin: String(profiles.defaults.CreditMin || ''), IncomeMultiple: String(profiles.defaults.IncomeMultiple || '') },
    units: units, totalUnits: match.building.length,
    subject: mail.subject, html: mail.html,
    bookable: mail.bookable, shownCount: mail.unitsShown,
    lastReviewed: p.LastReviewed instanceof Date ? Utilities.formatDate(p.LastReviewed, 'America/Detroit', 'M/d/yyyy') : String(p.LastReviewed || '')
  };
}

// The units a building-level lead for this row would be shown (most common card).
function buildingMatch_(p, listings, properties) {
  var match = matchCard_({ headline: p.Property, interestedIn: '', account: '', subject: '' }, listings, properties);
  if (match.outcome === 'AMBIGUOUS' || match.outcome === 'NO_PROFILE' || !match.profile || match.profile.Property !== p.Property) {
    var own = listings.filter(function (l) {
      return phraseList_(p).some(function (ph) { return containsPhrase_(l.address, ph) || containsPhrase_(l.title, ph); });
    });
    match = own.length ? { profile: p, unit: null, building: own, outcome: 'BUILDING' } : { profile: p, unit: null, building: [], outcome: 'NO_VACANCY' };
  }
  match.building = match.building || [];
  return match;
}

// → {values: {field: sheetValue}, errors: [text]}
function cleanEdits_(edits, pms, defaults) {
  edits = edits || {};
  defaults = defaults || {};
  var v = {}, errors = [];
  var text = function (f, max) {
    if (!(f in edits)) return;
    var s = String(edits[f] === null || edits[f] === undefined ? '' : edits[f]).replace(/\r/g, '').trim();
    if (s.length > max) errors.push(f + ' is too long (' + s.length + ' characters, max ' + max + ').');
    v[f] = s;
  };
  ['Pets', 'LeaseLengths', 'RentRange'].forEach(function (f) { text(f, 500); });
  text('Special', 600);
  text('About', 2500);

  if ('PM' in edits) {
    var pm = pms.filter(function (x) { return x.name === String(edits.PM).trim(); })[0];
    if (!pm) errors.push('Pick a PM from the list.');
    else { v.PM = pm.name; v.PMEmail = pm.email; if (!pm.email) errors.push(pm.name + ' has no email in the PMs tab.'); }
  }
  if ('Status' in edits) {
    if (STATUS_VALUES.indexOf(edits.Status) < 0) errors.push('Status must be Off, Draft, Test or Live.');
    else v.Status = edits.Status;
  }
  if ('ShowingMode' in edits) {
    if (edits.ShowingMode === 'off') v.ShowingLink = 'Off';
    else if (edits.ShowingMode === 'auto') v.ShowingLink = '';
    else {
      var url = String(edits.ShowingUrl || '').trim();
      if (!/^https:\/\/\S+$/.test(url)) errors.push('Your own booking link must be a full https:// link.');
      v.ShowingLink = url;
    }
  }
  if ('VirtualTourLink' in edits) {
    var t = String(edits.VirtualTourLink || '').trim();
    if (t && !/^https?:\/\/\S+$/.test(t)) errors.push('Virtual tour must be a full link starting with https://');
    v.VirtualTourLink = t;
  }
  if ('SpecialEnds' in edits) {
    var d = String(edits.SpecialEnds || '').trim();
    if (!d) v.SpecialEnds = '';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push('Special end date is not a date.');
    else { var parts = d.split('-'); v.SpecialEnds = new Date(+parts[0], +parts[1] - 1, +parts[2]); }
  }
  if ('CreditMin' in edits) {
    var c = String(edits.CreditMin || '').trim();
    if (c && !(/^\d{3}$/.test(c) && +c >= 300 && +c <= 850)) errors.push('Credit minimum must be a score from 300 to 850 (or blank for the company default).');
    // Same as the company standard → keep blank so a later change to the standard reaches this property.
    v.CreditMin = !c || String(+c) === String(defaults.CreditMin || '').trim() ? '' : +c;
  }
  if ('IncomeMultiple' in edits) {
    var m = String(edits.IncomeMultiple || '').trim().replace(/x$/i, '');
    if (m && !(/^\d+(\.\d+)?$/.test(m) && +m >= 1 && +m <= 10)) errors.push('Income multiple must be a number like 3 or 2.5 (or blank for the company default).');
    v.IncomeMultiple = !m || String(+m) === String(defaults.IncomeMultiple || '').trim().replace(/x$/i, '') ? '' : +m;
  }
  if (VOTE_COL in edits) v[VOTE_COL] = edits[VOTE_COL] === true;
  return { values: v, errors: errors };
}

// Same rules as the sheet's Missing formula (Setup.gs missingFormula_).
function missingFor_(p, defaults) {
  var out = [];
  REQUIRED.forEach(function (req) { if (!String(p[req[0]] || '').trim()) out.push(req[1]); });
  [['CreditMin', 'Credit'], ['IncomeMultiple', 'Income'], ['CosignerPolicy', 'Cosigner'], ['Section8Policy', 'Section 8']].forEach(function (o) {
    if (!String(p[o[0]] || '').trim() && !String(defaults[o[0]] || '').trim()) out.push(o[1]);
  });
  if (!String(defaults.ApplicationFee || '').trim()) out.push('App fee (Defaults)');
  return out;
}

function readPms_() {
  var sheet = profilesSs_().getSheetByName(PMS_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { name: String(r[0]).trim(), email: String(r[1]).trim() }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function findProfile_(profiles, name) {
  var hits = profiles.properties.filter(function (p) { return p.Property === name; });
  if (!hits.length) throw new Error('No property named "' + name + '" in the sheet.');
  if (hits.length > 1) throw new Error('Two rows are named "' + name + '". Ask Matt to fix the sheet.');
  return hits[0];
}

function rowOf_(sheet, name) {
  var names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < names.length; i++) if (String(names[i][0]).trim() === name) return i + 2;
  throw new Error('No property named "' + name + '" in the sheet.');
}

function sameValue_(a, b) {
  if (a instanceof Date || b instanceof Date) {
    var da = a instanceof Date ? a.getTime() : a, db = b instanceof Date ? b.getTime() : b;
    return da === db;
  }
  return String(a === null || a === undefined ? '' : a).trim() === String(b === null || b === undefined ? '' : b).trim();
}

function displayValue_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Detroit', 'M/d/yyyy');
  return String(v === null || v === undefined ? '' : v);
}

function currentUser_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function profilesSs_() {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
}

function headerCols_(sheet) {
  var col = {};
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach(function (h, i) { if (h) col[String(h).trim()] = i + 1; });
  return col;
}
