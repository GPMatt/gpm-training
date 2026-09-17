// Builds/refreshes the shared pre-screening Google Form used across all three
// Spencer properties. Run buildPreScreenForm() manually from the Apps Script
// editor (select it in the function dropdown, click Run) whenever PROPERTIES
// or the Units sheet changes — safe to re-run, it clears and rebuilds the
// question list from scratch each time.
//
// IMPORTANT — run this while logged into the Apps Script editor as
// automation@greenpropertymgt.com, not a personal account. FormApp.create()
// makes the new Form (and the Units/Responses spreadsheets it creates) owned
// by whoever is logged in when this first runs.
//
// Apps Script's FormApp service has NO api for theme (logo, color, header
// font) — that's Forms-UI-only. After the first run, open the form and click
// the palette icon (top right) once to set: the GPM logo (recovered copy in
// scratchpad — the one from assets/GPM-Logo.png before it was removed from
// the repo), brand green #8CC63F, and whichever header font preview looks
// like the serif style you liked. Re-running buildPreScreenForm() afterward
// only touches questions, never the theme.

var PRESCREEN_FORM_ID_PROP = 'PRESCREEN_FORM_ID';
var UNITS_SHEET_ID_PROP = 'UNITS_SHEET_ID';

function buildPreScreenForm() {
  var form = getOrCreatePreScreenForm_();
  clearFormItems_(form);

  // --- Section 0: identity + property -------------------------------------
  // Property MUST be the last item added in this section — Forms silently
  // ignores per-choice branching on any item that isn't the last one on its
  // page, so Full Name / Email have to come first.
  form.addTextItem().setTitle('Full Name').setRequired(true);
  form.addTextItem().setTitle('Email Address').setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  var propertyItem = form.addMultipleChoiceItem().setTitle('Property').setRequired(true);

  // --- One page + unit-type question per property -------------------------
  // Each rejoins at pageCommon afterward via setGoToPage, so the shared
  // questions below are only ever asked once regardless of which property
  // branch the prospect took.
  var pageIndianVillage = form.addPageBreakItem().setTitle('Indian Village Apartments');
  addUnitTypeQuestion_(form, 'INDIAN_VILLAGE');

  var pageEaglebrook = form.addPageBreakItem().setTitle('Eaglebrook Apartments');
  addUnitTypeQuestion_(form, 'EAGLEBROOK');

  var pageGrandCentral = form.addPageBreakItem().setTitle('Grand Central Lofts');
  addUnitTypeQuestion_(form, 'GRAND_CENTRAL_LOFTS');

  // --- Shared section: move-in date + pets (pets branches on pet details) -
  var pageCommon = form.addPageBreakItem().setTitle('A Bit More About You');
  form.addDateItem().setTitle('Anticipated Move-In Date').setRequired(true);
  var petsItem = form.addMultipleChoiceItem().setTitle('Do you have any pets?').setRequired(true);

  var pagePetDetails = form.addPageBreakItem().setTitle('Pet Details');
  form.addTextItem().setTitle('Pet type/breed and approximate weight').setRequired(true);

  // --- Shared final section: financial pre-screen + wrap-up ---------------
  var pageRest = form.addPageBreakItem().setTitle('Almost Done');
  form.addMultipleChoiceItem().setTitle('Credit Score Range').setRequired(true)
    .setChoiceValues(['700 or above', '650 - 699', '600 - 649', 'Below 600']);
  form.addTextItem().setTitle('Monthly Gross Income (before taxes)').setRequired(true)
    .setValidation(FormApp.createTextValidation().requireNumber().build());
  form.addMultipleChoiceItem().setTitle('Do you have a cosigner?').setRequired(true)
    .setChoiceValues(['Yes', 'No', 'If needed']);
  form.addListItem().setTitle('How did you hear about us?').setRequired(false)
    .setChoiceValues([
      'Google Search',
      'Apartments.com / Zillow / other listing site',
      'Facebook / Instagram',
      'Drove by / saw the sign',
      'Referral — friend or family',
      'Referral — current GPM resident',
      'Property website',
      'Craigslist',
      'Employer / school',
      'Other'
    ]);
  form.addParagraphTextItem().setTitle('Anything else we should know?').setRequired(false);

  // --- Wire up branching now that every target page break exists ----------
  propertyItem.setChoices([
    propertyItem.createChoice('Indian Village Apartments', pageIndianVillage),
    propertyItem.createChoice('Eaglebrook Apartments', pageEaglebrook),
    propertyItem.createChoice('Grand Central Lofts', pageGrandCentral)
  ]);
  pageIndianVillage.setGoToPage(pageCommon);
  pageEaglebrook.setGoToPage(pageCommon);
  pageGrandCentral.setGoToPage(pageCommon);

  petsItem.setChoices([
    petsItem.createChoice('Yes', pagePetDetails),
    petsItem.createChoice('No', pageRest)
  ]);
  // pagePetDetails has no explicit setGoToPage — natural document order
  // already continues into pageRest next, which is what "Yes" needs too.

  // Entry IDs are needed by Code.js to build prefilled links (name/email/
  // property filled in from the lead we already have before the prospect
  // ever opens the form). Store once here so autoResponder_run_ never has to
  // re-open the Form just to look them up on every send.
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PRESCREEN_ENTRY_NAME', String(form.getItems()[0].getId()));
  props.setProperty('PRESCREEN_ENTRY_EMAIL', String(form.getItems()[1].getId()));
  props.setProperty('PRESCREEN_ENTRY_PROPERTY', String(form.getItems()[2].getId()));
  // Cached so autoResponder_run_ (Code.js) never has to open the Form itself
  // on every 1-minute trigger tick just to read its URL.
  props.setProperty('PRESCREEN_PUBLISHED_URL', form.getPublishedUrl());

  Logger.log('Pre-screen form ready: ' + form.getEditUrl());
  Logger.log('Published URL: ' + form.getPublishedUrl());
}

function getOrCreatePreScreenForm_() {
  var props = PropertiesService.getScriptProperties();
  var formId = props.getProperty(PRESCREEN_FORM_ID_PROP);
  if (formId) {
    try {
      return FormApp.openById(formId);
    } catch (e) {
      // Stored ID no longer resolves (form deleted/moved) — fall through and
      // create a replacement rather than failing every future run.
    }
  }

  var form = FormApp.create('GPM Apartments — Pre-Screening')
    .setDescription('Tell us a bit more about what you’re looking for and we’ll follow up with next steps.')
    .setCollectEmail(false) // we ask for email explicitly so it matches the lead's reply-to, not the Google account they're signed into
    .setLimitOneResponsePerUser(false);

  var responseSheet = SpreadsheetApp.create('GPM Pre-Screening Responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, responseSheet.getId());

  props.setProperty(PRESCREEN_FORM_ID_PROP, form.getId());
  props.setProperty('PRESCREEN_RESPONSES_SHEET_ID', responseSheet.getId());
  return form;
}

// Resolves the spreadsheet FormApp linked as this form's destination.
// Re-derives from the Form itself if the cached property is missing (e.g. an
// older install) instead of assuming it's always been set.
function getPreScreenResponsesSpreadsheetId_() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('PRESCREEN_RESPONSES_SHEET_ID');
  if (sheetId) return sheetId;

  var form = getOrCreatePreScreenForm_();
  sheetId = form.getDestinationId();
  props.setProperty('PRESCREEN_RESPONSES_SHEET_ID', sheetId);
  return sheetId;
}

function clearFormItems_(form) {
  var items = form.getItems();

  // Strip cross-item references FIRST. Forms refuses to delete an item that's
  // still targeted by a choice's branching or a page break's setGoToPage —
  // and reverse-order deletion alone doesn't avoid that here, because several
  // items (e.g. the Property question) target page breaks created AFTER them,
  // so the reference points forward, not back. Neutralizing every item to a
  // plain, non-branching state before deleting anything sidesteps the
  // ordering problem entirely instead of trying to compute a safe order.
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      var mc = item.asMultipleChoiceItem();
      var plainValues = mc.getChoices().map(function (c) { return c.getValue(); });
      mc.setChoiceValues(plainValues);
    } else if (item.getType() === FormApp.ItemType.PAGE_BREAK) {
      item.asPageBreakItem().setGoToPage(FormApp.PageNavigationType.SUBMIT);
    }
  }

  items = form.getItems();
  for (var j = items.length - 1; j >= 0; j--) {
    form.deleteItem(items[j]);
  }
}

// Builds the "Which unit type interests you?" question for one property,
// with sqft/price/availability baked into each choice label (pulled fresh
// from the Units sheet at build time — see getOrCreateUnitsSheet_ below).
// Rebuild the form (re-run buildPreScreenForm) after editing that sheet so
// stale prices don't sit live on an already-published form.
function addUnitTypeQuestion_(form, propertyKey) {
  var units = getActiveUnitsForProperty_(propertyKey);
  var item = form.addMultipleChoiceItem().setTitle('Which unit type interests you?').setRequired(true);

  if (units.length === 0) {
    item.setChoiceValues(['Not sure yet — show me what’s available']);
    return item;
  }

  item.setChoiceValues(units.map(function (u) {
    return u.unitType + ' — ' + u.sqft + ' sqft — $' + u.price + '/mo — ' + u.availability;
  }));
  return item;
}

function getActiveUnitsForProperty_(propertyKey) {
  var sheet = getOrCreateUnitsSheet_();
  var rows = sheet.getDataRange().getValues();
  var header = rows[0];
  var col = {};
  for (var c = 0; c < header.length; c++) col[header[c]] = c;

  var result = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (row[col['PropertyKey']] !== propertyKey) continue;
    if (row[col['Active']] === false) continue;
    result.push({
      unitType: row[col['UnitType']],
      sqft: row[col['SqFt']],
      price: row[col['Price']],
      availability: row[col['Availability']]
    });
  }
  return result;
}

// Creates the property/unit source-of-truth sheet on first run. This is the
// sheet the PM edits by hand (roughly weekly) to keep availability/pricing
// current — re-run buildPreScreenForm() afterward to push those changes into
// the form's question labels.
function getOrCreateUnitsSheet_() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty(UNITS_SHEET_ID_PROP);
  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId).getSheetByName('Units');
    } catch (e) {
      // fall through and recreate below
    }
  }

  var ss = SpreadsheetApp.create('GPM Spencer — Property & Unit Details');
  var sheet = ss.getActiveSheet().setName('Units');
  sheet.appendRow(['PropertyKey', 'UnitType', 'SqFt', 'Price', 'Availability', 'Active']);
  sheet.appendRow(['INDIAN_VILLAGE', 'Studio', 410, 1225, 'Immediate', true]);
  sheet.appendRow(['EAGLEBROOK', '1 Bed / 1 Bath', 650, 1450, 'Immediate', true]);
  sheet.appendRow(['GRAND_CENTRAL_LOFTS', '1 Bed / 1 Bath', 700, 1650, 'Immediate', true]);
  sheet.setFrozenRows(1);

  props.setProperty(UNITS_SHEET_ID_PROP, ss.getId());
  Logger.log('Units sheet created — edit it here: ' + ss.getUrl());
  return sheet;
}
