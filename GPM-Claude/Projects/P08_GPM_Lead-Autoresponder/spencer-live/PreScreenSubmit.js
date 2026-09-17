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
// Screening criteria (Matt-confirmed 2026-09-16):
//   - Credit Score Range "700 or above" or "650 - 699" passes on credit alone.
//   - "600 - 649" or "Below 600" only passes credit if cosigner = "Yes".
//     Cosigner = "If needed" is treated as undecided, never an auto-pass.
//   - Monthly gross income must be >= 3x the rent of the unit type they
//     selected (rent is parsed straight from that answer's own label, e.g.
//     "Studio — 410 sqft — $1,225/mo — Immediate", so it always matches what
//     the prospect was actually quoted, not a possibly-since-changed sheet
//     price).

var LEADS_SHEET_NAME = 'Leads';
var PRESCREEN_ERRORS_SHEET_NAME = 'Errors';

function onPreScreenSubmit_(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    onPreScreenSubmit_run_(e);
  } finally {
    lock.releaseLock();
  }
}

function onPreScreenSubmit_run_(e) {
  var answers = parsePreScreenResponse_(e);
  if (!answers) return; // malformed submission — already logged to Errors tab

  if (alreadyPassed_(answers.email)) return; // prospect re-submitted after already passing — don't double-send

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
  var creditOkOutright = (a.creditRange === '700 or above' || a.creditRange === '650 - 699');
  var incomeOk = a.monthlyIncome >= 3 * a.monthlyRent;

  var creditOk;
  var reason;
  if (creditOkOutright) {
    creditOk = true;
    reason = incomeOk ? 'meets credit + income criteria' : 'credit OK, income below 3x rent';
  } else if (a.cosigner === 'Yes') {
    creditOk = true;
    reason = incomeOk ? 'cosigner covers credit range, income OK' : 'cosigner covers credit range, income below 3x rent';
  } else if (a.cosigner === 'If needed') {
    creditOk = false;
    reason = 'credit below 650 range, cosigner undecided ("if needed")';
  } else {
    creditOk = false;
    reason = 'credit below 650 range, no cosigner';
  }

  return { passed: creditOk && incomeOk, reason: reason };
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
