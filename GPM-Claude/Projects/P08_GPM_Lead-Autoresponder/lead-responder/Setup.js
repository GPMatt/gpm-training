// GPM Lead Responder — "Lead Response Profiles" control sheet
//
// One row per property. Every lead email for a property is built from the
// Template tab, filled with that property's row and the company Defaults tab.
//
// Run setupProfilesSheet() ONCE from the Apps Script editor (Setup.gs →
// function dropdown → setupProfilesSheet → Run). It creates the sheet, shares
// it with SHARE_WITH, and saves its ID in Script Properties. Re-running it does
// nothing while that ID is set — delete the PROFILES_SHEET_ID Script Property
// first if you really want a fresh sheet.

var SHARE_WITH = ['matt@greenpropertymgt.com'];

var PROPERTIES_TAB = 'Properties';
var DEFAULTS_TAB = 'Defaults';
var TEMPLATE_TAB = 'Template';

// Column order of the Properties tab. Render.js reads columns by these names,
// so a column can be moved in the sheet only if it moves here too.
var PROPERTY_COLUMNS = [
  'Property', 'MatchPhrases', 'PM', 'PMEmail', 'ShowingLink', 'ApplyLink',
  'RentRange', 'Pets', 'LeaseLengths', 'VirtualTourLink',
  'CreditMin', 'IncomeMultiple', 'CosignerPolicy', 'Section8Policy',
  'WriteupDoc', 'Status', 'LastReviewed', 'Missing', 'Notes'
];

var PROPERTY_HEADER_NOTES = {
  MatchPhrases: 'Lowercase phrases, separated by ";". A lead email that contains any of them belongs to this property. Use street NUMBER + street (e.g. "1960 burton"), never a bare street name.',
  ShowingLink: 'Optional override — leave blank. Each email links every posted unit to its own AppFolio booking page, and only when the PM\'s showing calendar has open times.',
  ApplyLink: 'Optional override — leave blank. Each email links every posted unit to its own AppFolio application.',
  RentRange: 'Optional. Each email already shows the live rent of every posted unit.',
  VirtualTourLink: 'Optional. Leave blank if there is no video tour.',
  CreditMin: 'Leave blank to use the company default (Defaults tab). Fill in only if this property is different.',
  IncomeMultiple: 'Leave blank to use the company default.',
  CosignerPolicy: 'Leave blank to use the company default.',
  Section8Policy: 'Leave blank to use the company default.',
  WriteupDoc: 'Optional. Link to a Google Doc describing the property (neighborhood, amenities, parking). Do NOT put prices or policies in it — those live in this sheet so they cannot go out of date in two places.',
  Status: 'Draft = no auto-reply (handled by hand). Test = the email goes to the PM instead of the prospect. Live = auto-sends to prospects.',
  LastReviewed: 'Date the PM last checked this row. Turns yellow after 60 days.',
  Missing: 'Formula — what still needs filling before this property can go Live. Do not type here.'
};

// Required before Live. Overrides fall back to Defaults, so they are checked
// against both. Showing/apply links and rent are NOT required: they come live
// from the AppFolio listings for every lead.
var REQUIRED = [
  ['PM', 'PM'], ['PMEmail', 'PM email'], ['Pets', 'Pets'], ['LeaseLengths', 'Lease lengths']
];

var DEFAULTS = [
  ['CreditMin', '', 'e.g. 625'],
  ['IncomeMultiple', '', 'e.g. 3 (income must be 3x the monthly rent)'],
  ['CosignerPolicy', '', 'e.g. "Accepted when income or credit falls short"'],
  ['Section8Policy', '', 'e.g. "Accepted" / "Not accepted"'],
  ['ApplicationFee', '', 'e.g. $50 per adult'],
  ['SignOff', 'Green Property Management Leasing Team', 'Last line of every email']
];

// Top properties by lead volume, Oct 7-14 2026 guest cards in automation@.
// Showing/apply links and PM details are for the PMs to fill.
var STARTER_ROWS = [
  { Property: 'Victory on Leonard', MatchPhrases: 'victory on leonard; 900 leonard',
    ShowingLink: 'https://greenproperty11.appfolio.com/listings/showings/new?listable_uid=8b49a2d3-2184-444f-852e-580551dcc0e6&source=Website',
    Notes: 'Already has its own autoresponder (vol-live). Turn that off before setting this row Live, or prospects get two emails.' },
  { Property: 'Indian Village Apartments', MatchPhrases: 'indian village; 1960 burton; 1966 burton; 1970 burton',
    Notes: 'Most tour-hungry property (13 of 26 comments asked for a tour). Never match a bare "burton" — 2737 Burton St SE is a different owner.' },
  { Property: '28 Gold Ave SW', MatchPhrases: '28 gold', Notes: 'Most comments ask for the application.' },
  { Property: 'Wealthy & Sheldon Apartments', MatchPhrases: 'wealthy and sheldon; wealthy & sheldon; 90 wealthy; 415 sheldon' },
  { Property: '917 Park St SW', MatchPhrases: '917 park' },
  { Property: '2700 Clyde Park Ave SW', MatchPhrases: '2700 clyde park; 28th and clyde park' },
  { Property: '730 Leonard Apartments', MatchPhrases: '730 leonard' },
  { Property: 'Woods Edge Apartments', MatchPhrases: 'woods edge; 2715 mckee' },
  { Property: 'Eaglebrook Apartments',
    MatchPhrases: 'eaglebrook; 5943 8th; 5957 8th; 5969 8th; 5979 8th; 5993 8th; 5999 8th; 6009 8th; 6025 8th; 6029 8th' },
  { Property: '329 Lyon St NE', MatchPhrases: '329 lyon' }
];

var TEMPLATE_SUBJECT = 'Your inquiry about {{Property}}';

// One line per line. Any line holding a {{Placeholder}} that is blank for the
// property is left out of the email entirely, so optional pieces (virtual
// tour, write-up) simply disappear when they are not filled in.
var TEMPLATE_BODY = [
  'Hi {{FirstName}},',
  '',
  'Thanks for your interest in {{Property}}!',
  '',
  '{{Units}}',
  '',
  'WHAT YOU NEED TO QUALIFY',
  '• Credit score of {{CreditMin}} or higher',
  '• Combined household income of {{IncomeMultiple}}x the monthly rent',
  '• Cosigners / guarantors: {{CosignerPolicy}}',
  '• Housing vouchers (Section 8): {{Section8Policy}}',
  '• Application fee: {{ApplicationFee}}',
  '',
  'QUICK FACTS',
  '• Rent: {{RentRange}}',
  '• Pets: {{Pets}}',
  '• Lease lengths: {{LeaseLengths}}',
  '• {{VirtualTourLink}}',
  '',
  '{{About}}',
  '',
  'Have a question that isn\'t answered here? Just reply to this email and {{PM}} will get back to you.',
  '',
  '{{SignOff}}'
].join('\n');

var TEMPLATE_HELP = 'Placeholders in {{double braces}} are filled from the property\'s row (or the Defaults tab). ' +
  'A line whose placeholder is blank is dropped. {{Units}} is the live list of posted units, each with Apply and ' +
  '(when the showing calendar has open times) Book-a-showing buttons. {{About}} is the optional write-up doc. ' +
  '{{FirstName}} comes from the lead. One template for every property — edit it here only.';

function setupProfilesSheet() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('PROFILES_SHEET_ID')) {
    Logger.log('Already set up: ' + SpreadsheetApp.openById(props.getProperty('PROFILES_SHEET_ID')).getUrl());
    return;
  }

  var ss = SpreadsheetApp.create('GPM Lead Response Profiles');
  buildDefaultsTab_(ss);
  buildTemplateTab_(ss);
  buildPropertiesTab_(ss);
  ss.deleteSheet(ss.getSheetByName('Sheet1'));
  ss.setActiveSheet(ss.getSheetByName(PROPERTIES_TAB));
  ss.moveActiveSheet(1);

  SHARE_WITH.forEach(function (email) { ss.addEditor(email); });
  props.setProperty('PROFILES_SHEET_ID', ss.getId());
  Logger.log('Created: ' + ss.getUrl());
}

function buildDefaultsTab_(ss) {
  var sheet = ss.insertSheet(DEFAULTS_TAB);
  var rows = [['Setting', 'Value', 'Example']].concat(DEFAULTS);
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 160); sheet.setColumnWidth(2, 320); sheet.setColumnWidth(3, 360);
  sheet.getRange(2, 3, DEFAULTS.length, 1).setFontColor('#888888');
  sheet.getRange(2, 2, DEFAULTS.length, 1).setBackground('#fff8e1');
}

function buildTemplateTab_(ss) {
  var sheet = ss.insertSheet(TEMPLATE_TAB);
  sheet.getRange(1, 1, 3, 2).setValues([
    ['Subject', TEMPLATE_SUBJECT],
    ['Body', TEMPLATE_BODY],
    ['How it works', TEMPLATE_HELP]
  ]);
  sheet.getRange(1, 1, 3, 1).setFontWeight('bold');
  sheet.setColumnWidth(1, 120); sheet.setColumnWidth(2, 720);
  sheet.getRange(1, 2, 3, 1).setWrap(true).setVerticalAlignment('top');
  sheet.getRange(3, 2).setFontColor('#888888');
}

function buildPropertiesTab_(ss) {
  var sheet = ss.insertSheet(PROPERTIES_TAB);
  var n = PROPERTY_COLUMNS.length;
  var col = {};
  PROPERTY_COLUMNS.forEach(function (name, i) { col[name] = i + 1; });

  var header = sheet.getRange(1, 1, 1, n);
  header.setValues([PROPERTY_COLUMNS]).setFontWeight('bold').setBackground('#d9ead3');
  Object.keys(PROPERTY_HEADER_NOTES).forEach(function (name) {
    sheet.getRange(1, col[name]).setNote(PROPERTY_HEADER_NOTES[name]);
  });
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);

  var rows = STARTER_ROWS.map(function (r) {
    return PROPERTY_COLUMNS.map(function (name) {
      if (name === 'Status') return 'Draft';
      if (name === 'Missing') return '';
      return r[name] || '';
    });
  });
  sheet.getRange(2, 1, rows.length, n).setValues(rows);

  // Formula rows reach well past the starter rows so new properties get the
  // Missing check without anyone copying a formula down.
  var lastRow = 100;
  var formulas = [];
  for (var r = 2; r <= lastRow; r++) formulas.push([missingFormula_(col, r)]);
  sheet.getRange(2, col.Missing, formulas.length, 1).setFormulas(formulas).setFontColor('#cc0000');

  sheet.getRange(2, col.Status, lastRow - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Draft', 'Test', 'Live'], true).build());
  sheet.getRange(2, col.LastReviewed, lastRow - 1, 1).setNumberFormat('m/d/yyyy').setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());

  var letter = function (name) { return columnLetter_(col[name]); };
  var rules = [
    // Live with something missing is the one state that must never be quiet.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + letter('Status') + '2="Live",$' + letter('Missing') + '2<>"")')
      .setBackground('#f4cccc').setRanges([sheet.getRange(2, 1, lastRow - 1, n)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($' + letter('LastReviewed') + '2<>"",TODAY()-$' + letter('LastReviewed') + '2>60)')
      .setBackground('#fff2cc').setRanges([sheet.getRange(2, col.LastReviewed, lastRow - 1, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Live').setBackground('#b6d7a8')
      .setRanges([sheet.getRange(2, col.Status, lastRow - 1, 1)]).build()
  ];
  sheet.setConditionalFormatRules(rules);

  sheet.setColumnWidth(col.Property, 220);
  sheet.setColumnWidth(col.MatchPhrases, 260);
  sheet.setColumnWidth(col.Missing, 260);
  sheet.setColumnWidth(col.Notes, 360);
  sheet.getRange(2, col.Notes, lastRow - 1, 1).setWrap(true);
}

function missingFormula_(col, r) {
  var cell = function (name) { return columnLetter_(col[name]) + r; };
  var parts = REQUIRED.map(function (req) {
    return 'IF(' + cell(req[0]) + '="","' + req[1] + '","")';
  });
  // An override column is satisfied by either the row or the company default.
  [['CreditMin', 'Credit', 2], ['IncomeMultiple', 'Income', 3],
   ['CosignerPolicy', 'Cosigner', 4], ['Section8Policy', 'Section 8', 5]].forEach(function (o) {
    parts.push('IF(AND(' + cell(o[0]) + '="",' + DEFAULTS_TAB + '!$B$' + o[2] + '=""),"' + o[1] + '","")');
  });
  parts.push('IF(' + DEFAULTS_TAB + '!$B$6="","App fee (Defaults)","")');
  return '=IF(' + cell('Property') + '="","",TEXTJOIN(", ",TRUE,' + parts.join(',') + '))';
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
