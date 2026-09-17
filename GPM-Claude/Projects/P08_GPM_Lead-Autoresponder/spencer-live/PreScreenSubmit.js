// Handles a pre-screen form submission end to end: scores it against GPM's
// screening criteria and, if it passes, immediately sends the tour-booking
// email (SHOWING_LINK, defined in Code.js) with no human in the loop.
//
// Deliberately asymmetric: a PASS is fully automated because it's applying
// the same objective bar to everyone, every time — the safe direction to
// automate. A prospect who doesn't clear the bar is NEVER sent an automated
// rejection; they're only logged to the Leads tab as "Needs Review" for a
// human to follow up with. Self-reported credit/income can't be verified
// anyway, so treat a fail as "needs a human look," not "denied."
//
// Screening criteria are PER-PROPERTY, read live from the "Requirements" tab
// (same spreadsheet as Units — see getRequirementsForProperty_ below) rather
// than hardcoded, so a PM can change a property's bar without a code change:
//   - A credit-range answer passes outright if its LOWER bound is >= that
//     property's Credit threshold (e.g. threshold 625 means "625 - 649" and
//     "650 or above" both pass outright, "600 - 624" and "Below 600" don't).
//   - Otherwise it only passes if cosigner = "Yes". Cosigner = "If needed" is
//     treated as undecided, never an auto-pass.
//   - Monthly gross income must be >= that property's Income multiplier (e.g.
//     "3x") times the rent of the unit type they selected (rent is parsed
//     straight from that answer's own label, e.g. "Studio — 410 sqft —
//     $1,225/mo — Immediate", so it always matches what the prospect was
//     actually quoted, not a possibly-since-changed sheet price).

var LEADS_SHEET_NAME = 'Leads';
var REQUIREMENTS_SHEET_NAME = 'Requirements';
var PRESCREEN_ERRORS_SHEET_NAME = 'Errors';

function onPreScreenSubmit_(e) {
  // getScriptLock() is shared across the WHOLE script, including the every-
  // 1-minute autoResponder trigger in Code.js — not scoped to this function.
  // A submission arriving during contention used to vanish with zero trace;
  // now it's at least logged instead of silently dropped.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    logPreScreenError_('Could not acquire script lock within 5s — submission dropped (see LockService note in onPreScreenSubmit_)', e);
    return;
  }

  try {
    onPreScreenSubmit_run_(e);
  } catch (err) {
    // Catch-all so an exception anywhere in the scoring/logging path (a
    // transient Sheets API error, an unexpected null, etc.) leaves a trace
    // instead of failing the trigger invisibly.
    logPreScreenError_('Uncaught exception in onPreScreenSubmit_run_: ' + err + (err && err.stack ? ' | ' + err.stack : ''), e);
  } finally {
    lock.releaseLock();
  }
}

function onPreScreenSubmit_run_(e) {
  var answers = parsePreScreenResponse_(e);
  if (!answers) return; // malformed submission — already logged to Errors tab

  if (alreadyPassed_(answers.email)) {
    // Deliberate no-op, not a failure — but it looks exactly like a silent
    // drop from the outside (no Leads row, no Errors row) unless it's
    // logged. This is the actual explanation behind several "submission
    // didn't go through" reports during testing: repeat submissions from the
    // same email after an earlier one already passed.
    logPreScreenError_('Skipped — ' + answers.email + ' already has a Passed row (repeat submission, not resent)', e);
    return;
  }

  var result = computeScreeningResult_(answers);
  logLead_(answers, result);

  if (result.passed) {
    sendTourEmail_(answers);
  }
}

// Reads every answer off the FormResponse by question title (not by column
// index/position) so a reordered question in buildPreScreenForm() can't
// silently misalign fields. Returns null — after logging what went wrong —
// if a field this scoring logic actually depends on is missing or unparsable,
// so one bad submission can't throw and take down every submission after it.
function parsePreScreenResponse_(e) {
  if (!e || !e.response) {
    logPreScreenError_('onFormSubmit fired with no e.response', e);
    return null;
  }

  var map = {};
  var itemResponses = e.response.getItemResponses();
  for (var i = 0; i < itemResponses.length; i++) {
    map[itemResponses[i].getItem().getTitle()] = itemResponses[i].getResponse();
  }

  var fullName = map['Full Name'];
  var email = map['Email Address'];
  var unitAnswer = map['Which unit type interests you?'];
  var creditRange = map['Credit Score Range'];
  var cosigner = map['Do you have a cosigner?'];
  var incomeRaw = map['Monthly Gross Income (before taxes)'];

  if (!fullName || !email || !unitAnswer || !creditRange || !cosigner || !incomeRaw) {
    logPreScreenError_('Missing a required field this scoring logic depends on', e);
    return null;
  }

  var rentMatch = String(unitAnswer).match(/\$([\d,]+)\/mo/);
  var monthlyRent = rentMatch ? parseFloat(rentMatch[1].replace(/,/g, '')) : null;
  var monthlyIncome = parseFloat(String(incomeRaw).replace(/[^0-9.]/g, ''));

  if (!monthlyRent || isNaN(monthlyIncome)) {
    logPreScreenError_('Could not parse rent from unit answer or income as a number', e);
    return null;
  }

  return {
    fullName: fullName,
    email: email,
    property: map['Property'] || '',
    unitAnswer: unitAnswer,
    monthlyRent: monthlyRent,
    moveInDate: map['Anticipated Move-In Date'] || '',
    pets: map['Do you have any pets?'] || '',
    petDetails: map['Pet type/breed and approximate weight'] || '', // absent when Pets = No, that page is skipped entirely
    creditRange: creditRange,
    monthlyIncome: monthlyIncome,
    cosigner: cosigner,
    referralSource: map['How did you hear about us?'] || '',
    notes: map['Anything else we should know?'] || ''
  };
}

function computeScreeningResult_(a) {
  var req = getRequirementsForProperty_(a.property);
  var creditLowerBound = parseCreditRangeLowerBound_(a.creditRange);
  var creditOkOutright = creditLowerBound >= req.creditThreshold;
  var incomeOk = a.monthlyIncome >= req.incomeMultiplier * a.monthlyRent;
  var incomeShortfallNote = 'income below ' + req.incomeMultiplier + 'x rent';

  var creditOk;
  var reason;
  if (creditOkOutright) {
    creditOk = true;
    reason = incomeOk ? 'meets credit + income criteria' : ('credit OK, ' + incomeShortfallNote);
  } else if (a.cosigner === 'Yes') {
    creditOk = true;
    reason = incomeOk ? 'cosigner covers credit range, income OK' : ('cosigner covers credit range, ' + incomeShortfallNote);
  } else if (a.cosigner === 'If needed') {
    creditOk = false;
    reason = 'credit below ' + req.creditThreshold + ' threshold, cosigner undecided ("if needed")';
  } else {
    creditOk = false;
    reason = 'credit below ' + req.creditThreshold + ' threshold, no cosigner';
  }

  return { passed: creditOk && incomeOk, reason: reason };
}

// "700 or above" -> 700, "625 - 649" -> 625 (the band's own lower edge is
// what has to clear the property's threshold), "Below 600" -> 0 (never
// passes outright — the band's whole point is being under every threshold).
function parseCreditRangeLowerBound_(rangeText) {
  var text = String(rangeText);
  if (/below/i.test(text)) return 0;
  var match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// Reads the per-property screening bar from the "Requirements" tab (same
// spreadsheet as Units). Falls back to a conservative default if a property
// is somehow missing a row there, rather than letting scoring throw.
function getRequirementsForProperty_(propertyDisplayName) {
  var key = getPropertyKeyByDisplayName_(propertyDisplayName);
  var sheet = getOrCreateRequirementsSheet_();
  var rows = sheet.getDataRange().getValues();
  var header = rows[0];
  var col = {};
  for (var c = 0; c < header.length; c++) col[header[c]] = c;

  for (var r = 1; r < rows.length; r++) {
    if (rows[r][col['PropertyKey']] === key) {
      var incomeMatch = String(rows[r][col['Income']]).match(/([\d.]+)/);
      return {
        creditThreshold: Number(rows[r][col['Credit']]),
        incomeMultiplier: incomeMatch ? parseFloat(incomeMatch[1]) : 3
      };
    }
  }
  logPreScreenError_('No Requirements row for property "' + propertyDisplayName + '" (key "' + key + '") — using default 625/3x', null);
  return { creditThreshold: 625, incomeMultiplier: 3 };
}

function getPropertyKeyByDisplayName_(displayName) {
  for (var i = 0; i < PROPERTIES.length; i++) {
    if (PROPERTIES[i].displayName === displayName) return PROPERTIES[i].key;
  }
  return null;
}

function getOrCreateRequirementsSheet_() {
  var ss = SpreadsheetApp.openById(getPropertyUnitsSpreadsheetId_());
  var sheet = ss.getSheetByName(REQUIREMENTS_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(REQUIREMENTS_SHEET_NAME);
  sheet.appendRow(['PropertyKey', 'Credit', 'Income']);
  for (var i = 0; i < PROPERTIES.length; i++) {
    sheet.appendRow([PROPERTIES[i].key, 625, '3x']);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

// Guards against sending a second tour email if the same prospect fills out
// the form twice after already passing once (e.g. clicking the emailed link
// again). A repeat submission that DIDN'T pass the first time is allowed to
// re-score — their answers may have genuinely changed.
function alreadyPassed_(email) {
  var sheet = getOrCreateLeadsSheet_();
  var rows = sheet.getDataRange().getValues();
  var header = rows[0];
  var emailCol = header.indexOf('Email');
  var statusCol = header.indexOf('Status');
  for (var r = 1; r < rows.length; r++) {
    if (rows[r][emailCol] === email && String(rows[r][statusCol]).indexOf('Passed') === 0) {
      return true;
    }
  }
  return false;
}

function logLead_(a, result) {
  var sheet = getOrCreateLeadsSheet_();
  sheet.appendRow([
    new Date(),
    a.fullName,
    a.email,
    a.property,
    a.unitAnswer,
    a.monthlyRent,
    a.moveInDate,
    a.pets,
    a.petDetails,
    a.creditRange,
    a.monthlyIncome,
    a.cosigner,
    a.referralSource,
    a.notes,
    result.passed,
    result.passed ? 'Passed — Tour Email Sent' : 'Needs Review',
    result.reason
  ]);
}

function getOrCreateLeadsSheet_() {
  var ss = SpreadsheetApp.openById(getPreScreenResponsesSpreadsheetId_());
  var sheet = ss.getSheetByName(LEADS_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(LEADS_SHEET_NAME);
  sheet.appendRow([
    'Timestamp', 'FullName', 'Email', 'Property', 'UnitAnswer', 'MonthlyRent',
    'MoveInDate', 'Pets', 'PetDetails', 'CreditRange', 'MonthlyIncome',
    'Cosigner', 'ReferralSource', 'Notes',
    'Passed', 'Status', 'Reason'
  ]);
  sheet.setFrozenRows(1);
  return sheet;
}

function logPreScreenError_(message, e) {
  try {
    var ss = SpreadsheetApp.openById(getPreScreenResponsesSpreadsheetId_());
    var sheet = ss.getSheetByName(PRESCREEN_ERRORS_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(PRESCREEN_ERRORS_SHEET_NAME);
      sheet.appendRow(['Timestamp', 'Message', 'RawEvent']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), message, JSON.stringify(e && e.namedValues ? e.namedValues : (e ? String(e) : ''))]);
  } catch (loggingFailure) {
    // Last resort — don't let a logging failure mask the original problem.
    Logger.log('logPreScreenError_ failed: ' + loggingFailure + ' | original: ' + message);
  }
}

function sendTourEmail_(a) {
  var firstName = a.fullName.split(' ')[0] || 'there';
  var subject = a.property + ' - Schedule Your Showing';
  var htmlBody = `
    Hello ${firstName},<br><br>
    Thanks for filling that out! You're all set to book a tour of ${a.property}.<br><br>
    <strong><a href="${SHOWING_LINK}">SCHEDULE YOUR SHOWING</a></strong><br><br>
    When you book, please note "${a.property}" in the event details so I know which property to prepare for.<br><br>
    Looking forward to meeting you,<br>
    ${SENDER_SIGNATURE}<br>
    Green Property Management
  `;

  GmailApp.sendEmail(a.email, subject, "", {
    htmlBody: htmlBody,
    name: SENDER_NAME,
    replyTo: REPLY_TO_EMAIL
  });
}

// Run this ONCE from the Apps Script editor after buildPreScreenForm() has
// created the form — same safe-to-re-run pattern as createAutoResponderTrigger
// in Code.js, so re-running never stacks duplicate triggers.
function createPreScreenSubmitTrigger() {
  deletePreScreenSubmitTriggers_();
  var form = getOrCreatePreScreenForm_();
  ScriptApp.newTrigger('onPreScreenSubmit_')
    .forForm(form)
    .onFormSubmit()
    .create();
}

function deletePreScreenSubmitTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onPreScreenSubmit_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
