// Builds/refreshes the shared pre-screening Google Form used across all three
// Spencer properties. Run buildPreScreenForm() manually from the Apps Script
// editor (select it in the function dropdown, click Run) whenever PROPERTIES
// (Code.js) or the questions below change — safe to re-run. Full Name / Email / Property
// are reused, never recreated, so their entry IDs (and every already-sent
// prefilled email link) stay valid forever; everything after them is cleared
// and rebuilt from scratch each time.
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

  // Full Name / Email / Property are NEVER deleted+recreated on a rebuild —
  // only reused. Every prior rebuild gave them fresh item IDs even though
  // their content never changed, which silently broke every already-sent
  // prefilled email link (Forms drops unmatched entry.* params instead of
  // erroring, so it just LOOKS unprefilled). Keeping these three permanently
  // stable means old links keep working no matter how many times the rest
  // of the form gets rebuilt.
  var identity = getOrCreateIdentityItems_(form);
  clearNonIdentityItems_(form, identity);
  var propertyItem = identity.propertyItem;

  // --- Screening questions (single page, no branching) --------------------
  // Redesigned 2026-09-23 for the booking-first flow: the prospect already
  // picked a specific unit when they booked, so the per-property unit-type
  // pages are gone, and pets are no longer asked. Bedrooms drives the rent
  // used in the income check (Requirements tab, read live at scoring time).
  // Titles are the contract with PreScreenSubmit.js — see the Q_* constants.
  propertyItem.setChoiceValues(PROPERTIES.map(function (p) { return p.displayName; }));

  form.addPageBreakItem().setTitle('A Few Quick Questions');
  form.addMultipleChoiceItem().setTitle(Q_BEDROOMS).setRequired(true)
    .setHelpText('This just tells us what you\u2019re looking for \u2014 it doesn\u2019t mean a unit of that size is currently available.')
    .setChoiceValues(BEDROOM_CHOICES.map(function (b) { return b.label; }));
  form.addDateItem().setTitle(Q_MOVE_IN).setRequired(true);
  // Bands split exactly at 625 so no band straddles the current threshold.
  // "NO CREDIT" is its own option — a cosigner only ever rescues THIS answer,
  // never an actual-but-insufficient score (see computeScreeningResult_).
  form.addMultipleChoiceItem().setTitle(Q_CREDIT).setRequired(true)
    .setChoiceValues(['650 or above', '625 - 649', '600 - 624', 'Below 600', 'NO CREDIT - ALLOWS COSIGNER']);
  form.addTextItem().setTitle(Q_INCOME).setRequired(true)
    .setHelpText('Add together the monthly income of everyone who will sign the lease.')
    .setValidation(FormApp.createTextValidation().requireNumber().build());
  form.addMultipleChoiceItem().setTitle(Q_COSIGNER).setRequired(true)
    .setChoiceValues(['Yes', 'No', 'If needed']);
  form.addListItem().setTitle(Q_REFERRAL).setRequired(false)
    .setChoiceValues([
      'Google Search',
      'LiveGreenLocal.com',
      'Apartments.com / Zillow / other listing site',
      'Social Media',
      'Drove by',
      'Referral'
    ]);
  form.addParagraphTextItem().setTitle(Q_NOTES).setRequired(false);

  var props = PropertiesService.getScriptProperties();
  // Cached so showingWatcher (Code.js) never has to open the Form itself
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

// Returns the Full Name / Email / Property items, creating them only if they
// don't already exist. These three are permanently stable across every
// rebuild — see the comment in buildPreScreenForm() for why that matters.
function getOrCreateIdentityItems_(form) {
  var items = form.getItems();
  if (items.length >= 3 &&
      items[0].getTitle() === 'Full Name' &&
      items[1].getTitle() === 'Email Address' &&
      items[2].getTitle() === 'Property') {
    return {
      nameItem: items[0],
      emailItem: items[1],
      propertyItem: items[2].asMultipleChoiceItem()
    };
  }

  // First-ever build (or someone deleted/renamed these in the Forms UI) —
  // create fresh. Property MUST be the last item added here — Forms silently
  // ignores per-choice branching on any item that isn't the last one on its
  // page, so Full Name / Email have to come first.
  var nameItem = form.addTextItem().setTitle('Full Name').setRequired(true);
  var emailItem = form.addTextItem().setTitle('Email Address').setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  var propertyItem = form.addMultipleChoiceItem().setTitle('Property').setRequired(true);
  return { nameItem: nameItem, emailItem: emailItem, propertyItem: propertyItem };
}

// Deletes every item EXCEPT the identity block (Full Name / Email /
// Property), so their item IDs — and therefore every already-sent prefilled
// email link — survive a rebuild.
function clearNonIdentityItems_(form, identity) {
  var items = form.getItems();
  var keepIds = [identity.nameItem.getId(), identity.emailItem.getId(), identity.propertyItem.getId()];

  // Strip cross-item references FIRST, on EVERY item including the ones
  // we're keeping — Property's old choices target page breaks that are
  // about to be deleted, and Forms refuses to delete an item that's still
  // targeted by a choice's branching or a page break's setGoToPage. Reverse-
  // order deletion alone doesn't avoid that, because several items (e.g.
  // Property) target page breaks created AFTER them, so the reference points
  // forward, not back.
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.getType() === FormApp.ItemType.MULTIPLE_CHOICE) {
      var mc = item.asMultipleChoiceItem();
      var plainValues = mc.getChoices().map(function (c) { return c.getValue(); });
      if (plainValues.length > 0) mc.setChoiceValues(plainValues);
    } else if (item.getType() === FormApp.ItemType.PAGE_BREAK) {
      item.asPageBreakItem().setGoToPage(FormApp.PageNavigationType.SUBMIT);
    }
  }

  items = form.getItems();
  for (var j = items.length - 1; j >= 0; j--) {
    if (keepIds.indexOf(items[j].getId()) === -1) {
      form.deleteItem(items[j]);
    }
  }
}

// Opens the "GPM Spencer — Property & Unit Details" spreadsheet (creating it
// on a first-ever run). Only its Requirements tab is used now — the Units tab
// fed the old unit-type question and is no longer read.
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

// Requirements (PreScreenSubmit.js) lives as a second tab in the same
// spreadsheet as Units, so it reuses this same spreadsheet ID rather than
// creating a separate file.
function getPropertyUnitsSpreadsheetId_() {
  getOrCreateUnitsSheet_(); // ensures the spreadsheet + Units tab + property already exist
  return PropertiesService.getScriptProperties().getProperty(UNITS_SHEET_ID_PROP);
}
