// GPM Lead Responder — one-off edits to the Lead Response Profiles sheet
//
// applyProfileUpdates() (Updates.gs) is safe to run more than once: rows are
// found by their Property name, new rows are only added if missing, and
// only the cells listed here are written.

// Prospect-facing names: {{Property}} goes into the email subject and body,
// so "Prospect Ave - Prospect" (the AppFolio name) is kept in Notes instead.
var COSIGNER_POLICY_STANDARD =
  'Accepted if you have no credit history or your income is under 3x the rent. ' +
  'A cosigner does not make up for a credit score below the minimum.';

var MIKE = { PM: 'Mike Green', PMEmail: 'mike@greenpropertymgt.com',
  CreditMin: 625, IncomeMultiple: 3, CosignerPolicy: COSIGNER_POLICY_STANDARD };

var NEW_ROWS = [
  { Property: 'The Oakwood', MatchPhrases: 'the oakwood; 547 cherry',
    Notes: 'AppFolio: The Oakwood (547 Cherry St SE).' },
  { Property: 'Cardinal Point', MatchPhrases: 'cardinal point; 445 knapp',
    Notes: 'AppFolio: Cardinal Point (445 Knapp St NE). 2869 Knapp is a different property.' },
  { Property: '33 Lafayette Ave SE', MatchPhrases: '33 lafayette',
    Notes: 'AppFolio: Lafayette Ave - Lafayette. "33 lafayette" must match as a whole number: 1033 Lafayette Ave SE is a different owner.' },
  { Property: '323 Prospect Ave NE', MatchPhrases: '323 prospect',
    Notes: 'AppFolio: Prospect Ave - Prospect.' }
];

// From the Property Manager & Tech Assignments sheet ("Truth" tab), 2026-10-15.
var PM_BY_PROPERTY = {
  'Victory on Leonard': ['Jody Betsch', 'jody@greenpropertymgt.com'],
  'Indian Village Apartments': ['Jody Betsch', 'jody@greenpropertymgt.com'],
  'Wealthy & Sheldon Apartments': ['Blake Roush', 'blake@greenpropertymgt.com'],
  '917 Park St SW': ['Jody Betsch', 'jody@greenpropertymgt.com'],
  '2700 Clyde Park Ave SW': ['Blake Roush', 'blake@greenpropertymgt.com'],
  '730 Leonard Apartments': ['Blake Roush', 'blake@greenpropertymgt.com'],
  'Woods Edge Apartments': ['Blake Roush', 'blake@greenpropertymgt.com'],
  'Eaglebrook Apartments': ['Blake Roush', 'blake@greenpropertymgt.com'],
  '329 Lyon St NE': ['Jody Betsch', 'jody@greenpropertymgt.com']
};

var REMOVE_PROPERTIES = ['28 Gold Ave SW'];

function applyProfileUpdates() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  header.forEach(function (h, i) { col[h] = i + 1; });

  var rowOf = function (name) {
    var names = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < names.length; i++) if (String(names[i][0]).trim() === name) return i + 2;
    return 0;
  };
  // Writes into the existing row so the Missing formula and dropdowns stay.
  var setCells = function (r, values) {
    Object.keys(values).forEach(function (k) { sheet.getRange(r, col[k]).setValue(values[k]); });
  };
  var log = [];

  REMOVE_PROPERTIES.forEach(function (name) {
    var r = rowOf(name);
    if (r) { sheet.deleteRow(r); log.push('Removed ' + name); }
  });

  Object.keys(PM_BY_PROPERTY).forEach(function (name) {
    var r = rowOf(name);
    if (!r) { log.push('NOT FOUND, skipped PM: ' + name); return; }
    setCells(r, { PM: PM_BY_PROPERTY[name][0], PMEmail: PM_BY_PROPERTY[name][1] });
    log.push('PM ' + PM_BY_PROPERTY[name][0] + ' → ' + name);
  });

  NEW_ROWS.forEach(function (row) {
    var r = rowOf(row.Property);
    if (!r) {
      r = 2;
      while (sheet.getRange(r, 1).getValue() !== '') r++;
      setCells(r, { Property: row.Property, Status: 'Draft' });
      log.push('Added ' + row.Property);
    }
    var values = { MatchPhrases: row.MatchPhrases, Notes: row.Notes };
    Object.keys(MIKE).forEach(function (k) { values[k] = MIKE[k]; });
    setCells(r, values);
  });

  // Woods Edge Apartments IS 2700 Clyde Park Ave SW (same property in the
  // Truth sheet); both rows are kept for now, flagged so only one goes Live.
  ['Woods Edge Apartments', '2700 Clyde Park Ave SW'].forEach(function (name) {
    var r = rowOf(name);
    if (r) setCells(r, { Notes: 'Same property as ' +
      (name === 'Woods Edge Apartments' ? '2700 Clyde Park Ave SW' : 'Woods Edge Apartments') +
      ' — merge before either row goes Live, or prospects get two emails.' });
  });

  Logger.log(log.join('\n') + '\n' + ss.getUrl());
}

// applyResponderUpgrade() (Updates.gs) — run once before turning the responder
// on. Safe to re-run.
//   1. Merges the duplicate "2700 Clyde Park Ave SW" row into Woods Edge
//      (same property; two rows made every Clyde Park lead ambiguous).
//   2. Writes the new template ({{Units}} = live posted units) to the Template tab.
//   3. Rewrites the Missing formulas and header notes: showing/apply links
//      and rent now come live from AppFolio, so they are no longer required.
function applyResponderUpgrade() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  header.forEach(function (h, i) { col[h] = i + 1; });
  var log = [];

  var names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var clyde = names.indexOf('2700 Clyde Park Ave SW');
  if (clyde >= 0) { sheet.deleteRow(clyde + 2); log.push('Removed duplicate row 2700 Clyde Park Ave SW'); }
  names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var woods = names.indexOf('Woods Edge Apartments');
  if (woods >= 0) {
    sheet.getRange(woods + 2, col.MatchPhrases).setValue('woods edge; 2715 mckee; 2700 clyde park; 28th and clyde park');
    sheet.getRange(woods + 2, col.Notes).setValue('Leads arrive as "Woods Edge Apartments", "2715 McKee" or "2700 Clyde Park Ave SW" — all one property.');
    log.push('Woods Edge now matches all three names');
  }

  var tpl = ss.getSheetByName(TEMPLATE_TAB);
  tpl.getRange(1, 2, 3, 1).setValues([[TEMPLATE_SUBJECT], [TEMPLATE_BODY], [TEMPLATE_HELP]]);
  log.push('Template updated');

  var formulas = [];
  for (var r = 2; r <= 100; r++) formulas.push([missingFormula_(col, r)]);
  sheet.getRange(2, col.Missing, formulas.length, 1).setFormulas(formulas);
  Object.keys(PROPERTY_HEADER_NOTES).forEach(function (name) {
    if (col[name]) sheet.getRange(1, col[name]).setNote(PROPERTY_HEADER_NOTES[name]);
  });
  log.push('Missing formulas + header notes updated');

  Logger.log(log.join('\n') + '\n' + ss.getUrl());
}

// updateTemplate() (Updates.gs) — writes the current TEMPLATE_SUBJECT/BODY/HELP
// from Setup.gs to the Template tab. Safe to re-run.
function updateTemplate() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  ss.getSheetByName(TEMPLATE_TAB).getRange(1, 2, 3, 1).setValues([[TEMPLATE_SUBJECT], [TEMPLATE_BODY], [TEMPLATE_HELP]]);
  Logger.log('Template updated\n' + ss.getUrl());
}

// applyMikeAnswers() (Updates.gs) — Mike's 2026-10-19 email answers for his 4
// properties: pets, lease lengths, Section 8. Only those cells are written;
// Status is left alone. Safe to re-run.
var MIKE_LEASE = '12 months or longer. After a 12-month lease you can request a short-term lease (fees apply).';
var MIKE_ANSWERS = {
  'The Oakwood': '$300 one-time pet fee (non-refundable), plus $55/mo per dog and $30/mo per cat',
  'Cardinal Point': '$300 one-time pet fee (non-refundable), plus $50/mo per dog and $25/mo per cat',
  '33 Lafayette Ave SE': '$300 one-time pet fee (non-refundable), plus $55/mo per dog and $30/mo per cat',
  '323 Prospect Ave NE': '$300 one-time pet fee (non-refundable), plus $50/mo per dog and $25/mo per cat'
};

function applyMikeAnswers() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  header.forEach(function (h, i) { col[h] = i + 1; });
  var names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  var log = [];

  Object.keys(MIKE_ANSWERS).forEach(function (name) {
    var i = names.indexOf(name);
    if (i < 0) { log.push('NOT FOUND, skipped: ' + name); return; }
    var r = i + 2;
    sheet.getRange(r, col.Pets).setValue(MIKE_ANSWERS[name]);
    sheet.getRange(r, col.LeaseLengths).setValue(MIKE_LEASE);
    sheet.getRange(r, col.Section8Policy).setValue('Accepted');
    SpreadsheetApp.flush();
    log.push(name + ' (Status ' + sheet.getRange(r, col.Status).getValue() + ') → Missing: "' +
      sheet.getRange(r, col.Missing).getDisplayValue() + '"');
  });

  Logger.log(log.join('\n') + '\n' + ss.getUrl());
}

// applySpecialsUpgrade() (Updates.gs) — adds the Special + SpecialEnds columns
// after LeaseLengths and writes the template with its CURRENT SPECIAL section.
// Inserting columns keeps the Missing formulas, dropdowns and colors (Sheets
// shifts them). Safe to re-run: does nothing to the sheet once Special exists.
function applySpecialsUpgrade() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('PROFILES_SHEET_ID'));
  var sheet = ss.getSheetByName(PROPERTIES_TAB);
  var headerOf = function () {
    var col = {};
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach(function (h, i) { col[h] = i + 1; });
    return col;
  };
  var col = headerOf();
  var log = [];

  if (!col.Special) {
    sheet.insertColumnsAfter(col.LeaseLengths, 2);
    sheet.getRange(1, col.LeaseLengths + 1, 1, 2).setValues([['Special', 'SpecialEnds']])
      .setFontWeight('bold').setBackground('#d9ead3');
    col = headerOf();
    var lastRow = 100;
    sheet.getRange(2, col.Special, lastRow - 1, 2).clearDataValidations().clearFormat();
    sheet.getRange(2, col.Special, lastRow - 1, 1).setWrap(true);
    sheet.getRange(2, col.SpecialEnds, lastRow - 1, 1).setNumberFormat('m/d/yyyy').setDataValidation(
      SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
    sheet.setColumnWidth(col.Special, 320);
    var rules = sheet.getConditionalFormatRules();
    rules.push(specialExpiredRule_(sheet, col, lastRow));
    sheet.setConditionalFormatRules(rules);
    log.push('Added Special + SpecialEnds columns');
  } else {
    log.push('Special column already there');
  }
  ['Special', 'SpecialEnds'].forEach(function (name) {
    sheet.getRange(1, col[name]).setNote(PROPERTY_HEADER_NOTES[name]);
  });

  ss.getSheetByName(TEMPLATE_TAB).getRange(1, 2, 3, 1).setValues([[TEMPLATE_SUBJECT], [TEMPLATE_BODY], [TEMPLATE_HELP]]);
  log.push('Template updated (CURRENT SPECIAL section)');
  Logger.log(log.join('\n') + '\n' + ss.getUrl());
}
