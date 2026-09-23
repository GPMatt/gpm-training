// Handles a pre-screen form submission end to end (booking-first flow,
// redesigned 2026-09-23 — see the overview at the top of Code.js):
//
//   1. Score the answers against the Requirements tab, read LIVE on every
//      submission (the numbers in that sheet change — never cache them).
//   2. Tie the submission back to the prospect's open showing (Showings tab,
//      matched by email, same property preferred).
//   3. Email Spencer a summary every time: answers, each rule and its result,
//      and what the prospect was sent.
//   4. Email the prospect — PASS: confirmation + calendar invite (automation@
//      calendar, prospect + Spencer as guests). FAIL: cancellation (the
//      showing itself still has to be cancelled in AppFolio by Spencer; we
//      only have read access there). Submitted after the showing time:
//      Spencer only, nothing to the prospect.
//
// Rules (same for all three properties today, but read per property + bedroom
// count from the Requirements tab, so each can diverge without a code change):
//   - Credit: the chosen range's LOWER bound must be >= that row's Credit
//     value ("625 - 649" and "650 or above" pass at 625). "NO CREDIT" passes
//     only with cosigner Yes / If needed ("If needed" adds a cosigner note to
//     the confirmation). A cosigner never rescues an actual score below the
//     threshold.
//   - Income: combined monthly gross income >= Income multiplier ("3x") x the
//     "Min Rent by Bedroom" for the bedroom count they asked for.
//   - Move-in: no more than 90 days after the submission date.
// If the Requirements tab has no row for that property + bedroom count, the
// submission is NOT auto-failed — Spencer gets it as NEEDS REVIEW and the
// prospect gets nothing yet.

// Question titles — the contract with buildPreScreenForm() (PreScreenForm.js).
var Q_BEDROOMS = 'How many bedrooms are you looking for?';
var Q_MOVE_IN = 'Anticipated Move-In Date';
var Q_CREDIT = 'Credit Score Range';
var Q_INCOME = 'Combined Monthly Gross Income (before taxes)';
var Q_COSIGNER = 'Do you have a cosigner?';
var Q_REFERRAL = 'How did you hear about us?';
var Q_NOTES = 'Anything else we should know?';

var BEDROOM_CHOICES = [
  { label: 'Studio', beds: 0 },
  { label: '1 Bedroom', beds: 1 },
  { label: '2 Bedrooms', beds: 2 },
  { label: '3 Bedrooms', beds: 3 }
];

var MAX_MOVE_IN_DAYS = 90;

var SCREENINGS_SHEET_NAME = 'Screenings';
var REQUIREMENTS_SHEET_NAME = 'Requirements';
var PRESCREEN_ERRORS_SHEET_NAME = 'Errors';

function onPreScreenSubmit_(e) {
  // Shared script lock with the every-minute showingWatcher (Code.js). Wait
  // longer than the watcher does — a submission must never be dropped just
  // because a watcher run happened to be mid-flight.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    logPreScreenError_('Could not acquire script lock within 60s — submission dropped', e);
    return;
  }

  try {
    onPreScreenSubmit_run_(e);
  } catch (err) {
    logPreScreenError_('Uncaught exception in onPreScreenSubmit_run_: ' + err + (err && err.stack ? ' | ' + err.stack : ''), e);
  } finally {
    lock.releaseLock();
  }
}

function onPreScreenSubmit_run_(e) {
  var a = parsePreScreenResponse_(e);
  if (!a) return; // malformed submission — already logged to Errors tab

  var result = computeScreeningResult_(a);
  var open = findOpenShowingForEmail_(a.email, a.property);
  var now = new Date();

  if (!open) {
    logScreening_(a, result, 'NO_OPEN_SHOWING');
    notifySpencer_('[' + result.verdict + ', NO SHOWING ON FILE] ' + a.fullName + ' — ' + a.property,
      'This pre-screen came in, but there is no open showing for ' + a.email + ' (already decided, or booked outside ' +
      'the automation). Nothing was sent to the prospect.',
      { ProspectName: a.fullName, Email: a.email, Property: a.property },
      screeningDetailsHtml_(a, result));
    return;
  }

  var showing = open.record;
  var start = showing.ShowingStart instanceof Date ? showing.ShowingStart : null;
  var late = start && now >= start;
  var action, status, updates = { Result: result.verdict, Reason: result.reason };

  if (late) {
    status = 'LATE_' + result.verdict;
    action = 'Submitted AFTER the showing time — nothing was sent to the prospect.';
  } else if (result.verdict === 'REVIEW') {
    status = 'NEEDS_REVIEW';
    action = 'Could not score automatically (' + result.reason + '). Nothing was sent to the prospect — your call.';
  } else if (result.verdict === 'PASS') {
    var eventId = createShowingEvent_(showing, a);
    sendConfirmationEmail_(showing, a, result);
    status = 'PASSED';
    updates.CalendarEventId = eventId;
    action = 'Prospect was sent a confirmation email + calendar invite (you\'re on the invite too).';
  } else {
    sendCancellationEmail_(showing, a);
    status = 'FAILED';
    action = 'Prospect was sent a cancellation email. ACTION NEEDED: please cancel this showing in AppFolio.';
  }

  updates.Status = status;
  updateShowingRow_(open.rowNumber, updates);
  logScreening_(a, result, status);

  notifySpencer_('[' + (late ? 'LATE ' : '') + result.verdict + '] ' + a.fullName + ' — ' +
      showing.Property + (start ? ' ' + formatShowingTime_(start) : ''),
    action, showing, screeningDetailsHtml_(a, result));
}

// Reads every answer by question title (not position) so reordering questions
// in buildPreScreenForm() can't misalign fields. Returns null (after logging)
// if a field the scoring depends on is missing or unparsable.
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
  var bedroomsAnswer = map[Q_BEDROOMS];
  var moveInRaw = map[Q_MOVE_IN];
  var creditRange = map[Q_CREDIT];
  var incomeRaw = map[Q_INCOME];
  var cosigner = map[Q_COSIGNER];

  if (!fullName || !email || !bedroomsAnswer || !moveInRaw || !creditRange || !incomeRaw || !cosigner) {
    logPreScreenError_('Missing a required field this scoring logic depends on', e);
    return null;
  }

  var bedroomChoice = BEDROOM_CHOICES.filter(function (b) { return b.label === bedroomsAnswer; })[0];
  var monthlyIncome = parseFloat(String(incomeRaw).replace(/[^0-9.]/g, ''));
  var moveIn = parseFormDate_(moveInRaw);

  if (!bedroomChoice || isNaN(monthlyIncome) || !moveIn) {
    logPreScreenError_('Could not parse bedrooms / income / move-in date', e);
    return null;
  }

  return {
    fullName: fullName,
    email: String(email).trim(),
    property: map['Property'] || '',
    bedroomsLabel: bedroomsAnswer,
    beds: bedroomChoice.beds,
    moveInRaw: moveInRaw,
    moveIn: moveIn,
    creditRange: creditRange,
    monthlyIncome: monthlyIncome,
    cosigner: cosigner,
    referralSource: map[Q_REFERRAL] || '',
    notes: map[Q_NOTES] || ''
  };
}

// Date items come back as "YYYY-MM-DD".
function parseFormDate_(raw) {
  var m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) : null;
}

// Returns { verdict: 'PASS' | 'FAIL' | 'REVIEW', reason, checks: [{label, ok, detail}], needsCosignerFollowup }.
function computeScreeningResult_(a) {
  var req = getRequirements_(getPropertyKeyByDisplayName_(a.property), a.beds);
  var checks = [];

  // Move-in never depends on the Requirements tab, so it's scored even when
  // the tab is missing a row.
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var daysOut = Math.round((a.moveIn - today) / 86400000);
  checks.push({
    label: 'Move-in within ' + MAX_MOVE_IN_DAYS + ' days',
    ok: daysOut <= MAX_MOVE_IN_DAYS,
    detail: a.moveInRaw + ' (' + daysOut + ' days out)'
  });

  if (!req) {
    return {
      verdict: 'REVIEW',
      reason: 'no Requirements row for ' + a.property + ' / ' + a.bedroomsLabel,
      checks: checks,
      needsCosignerFollowup: false
    };
  }

  // Credit — cosigner only ever substitutes for a genuine NO CREDIT answer.
  var isNoCredit = /no credit/i.test(String(a.creditRange));
  var lowerBound = parseCreditRangeLowerBound_(a.creditRange);
  var needsCosignerFollowup = false;
  var creditOk, creditDetail;
  if (isNoCredit) {
    creditOk = a.cosigner === 'Yes' || a.cosigner === 'If needed';
    needsCosignerFollowup = a.cosigner === 'If needed';
    creditDetail = 'No credit, cosigner: ' + a.cosigner + (creditOk ? '' : ' (no credit requires a cosigner)');
  } else {
    creditOk = lowerBound >= req.creditThreshold;
    creditDetail = a.creditRange + ' vs ' + req.creditThreshold + ' needed' +
      (!creditOk && a.cosigner !== 'No' ? ' (a cosigner only applies to NO CREDIT applicants)' : '');
  }
  checks.push({ label: 'Credit ' + req.creditThreshold + '+', ok: creditOk, detail: creditDetail });

  var incomeNeeded = req.incomeMultiplier * req.minRent;
  checks.push({
    label: 'Income ' + req.incomeMultiplier + 'x rent',
    ok: a.monthlyIncome >= incomeNeeded,
    detail: formatMoney_(a.monthlyIncome) + ' vs ' + formatMoney_(incomeNeeded) + ' needed (' +
      req.incomeMultiplier + ' x ' + formatMoney_(req.minRent) + ' min rent, ' + a.bedroomsLabel + ')'
  });

  var failed = checks.filter(function (c) { return !c.ok; });
  return {
    verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    reason: failed.length === 0
      ? 'meets all criteria' + (needsCosignerFollowup ? ' (cosigner required — applicant said "if needed")' : '')
      : failed.map(function (c) { return c.label + ': ' + c.detail; }).join('; '),
    checks: checks,
    needsCosignerFollowup: needsCosignerFollowup
  };
}

// "650 or above" -> 650, "625 - 649" -> 625, "Below 600" -> 0 (never passes
// outright). "NO CREDIT..." is gated separately, not by this bound.
function parseCreditRangeLowerBound_(rangeText) {
  var text = String(rangeText);
  if (/below/i.test(text)) return 0;
  var match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// Reads the Requirements tab LIVE (no caching) and returns the row for this
// property + bedroom count: { creditThreshold, incomeMultiplier, minRent }, or
// null if there's no such row. Columns are found by header name; the rent
// column is whichever header mentions "rent" (currently "Min Rent by Bedroom").
function getRequirements_(propertyKey, beds) {
  if (!propertyKey) return null;
  var ss = SpreadsheetApp.openById(getPropertyUnitsSpreadsheetId_());
  var sheet = ss.getSheetByName(REQUIREMENTS_SHEET_NAME);
  if (!sheet) {
    logPreScreenError_('Requirements tab is missing from the Property & Unit Details spreadsheet', null);
    return null;
  }

  var rows = sheet.getDataRange().getValues();
  var header = rows[0].map(function (h) { return String(h).trim(); });
  var cKey = header.indexOf('PropertyKey');
  var cCredit = header.indexOf('Credit');
  var cIncome = header.indexOf('Income');
  var cBeds = header.indexOf('Beds');
  var cRent = -1;
  for (var h = 0; h < header.length; h++) if (/rent/i.test(header[h])) { cRent = h; break; }

  if (cKey < 0 || cCredit < 0 || cIncome < 0 || cBeds < 0 || cRent < 0) {
    logPreScreenError_('Requirements tab header changed — need PropertyKey, Credit, Income, Beds and a Rent column; got: ' + header.join(', '), null);
    return null;
  }

  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (String(row[cKey]).trim() !== propertyKey) continue;
    if (Number(row[cBeds]) !== beds || row[cBeds] === '') continue;

    var incomeMatch = String(row[cIncome]).match(/([\d.]+)/);
    var minRent = Number(String(row[cRent]).replace(/[^0-9.]/g, ''));
    var credit = Number(row[cCredit]);
    if (!incomeMatch || !minRent || !credit) {
      logPreScreenError_('Requirements row ' + (r + 1) + ' has a blank/unreadable Credit, Income or Rent', null);
      return null;
    }
    return { creditThreshold: credit, incomeMultiplier: parseFloat(incomeMatch[1]), minRent: minRent };
  }
  return null;
}

function getPropertyKeyByDisplayName_(displayName) {
  for (var i = 0; i < PROPERTIES.length; i++) {
    if (PROPERTIES[i].displayName === displayName) return PROPERTIES[i].key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prospect emails + calendar
// ---------------------------------------------------------------------------

function createShowingEvent_(showing, a) {
  try {
    var start = showing.ShowingStart;
    var end = new Date(start.getTime() + SHOWING_DURATION_MIN * 60000);
    var event = CalendarApp.getDefaultCalendar().createEvent(
      'Showing: ' + a.fullName + ' — ' + showing.Property,
      start, end, {
        location: showing.Unit,
        description: 'Apartment showing at ' + showing.Property + ' (' + showing.Unit + ').\n' +
          'Questions or need to reschedule? Reply to the confirmation email or contact ' + REPLY_TO_EMAIL + '.',
        guests: a.email + ',' + getNotifyEmail_(),
        sendInvites: true
      });
    return event.getId();
  } catch (err) {
    // The confirmation email still goes out — a calendar hiccup shouldn't cost
    // a qualified prospect their confirmation.
    logPreScreenError_('Calendar invite failed for ' + a.email + ': ' + err, null);
    return 'FAILED: ' + err;
  }
}

function sendConfirmationEmail_(showing, a, result) {
  var firstName = firstNameOf_(a.fullName);
  var when = formatShowingTime_(showing.ShowingStart);
  var cosignerNote = result.needsCosignerFollowup
    ? 'One note: since you don\'t have credit history on file yet, a cosigner will be required to move forward ' +
      'with an application — it helps to have them ready by the time you apply.<br><br>'
    : '';

  GmailApp.sendEmail(a.email, 'You\'re confirmed: ' + showing.Property + ' showing — ' + when, '', {
    htmlBody: `
      Hi ${firstName},<br><br>
      Great news — you're all set! We're excited to show you around ${showing.Property}.<br><br>
      <b>Date:</b> ${when}<br>
      <b>Location:</b> ${escapeHtml_(showing.Unit)}<br><br>
      A calendar invite is on its way so it's on your schedule. ${cosignerNote}If anything changes, just reply to this email.<br><br>
      See you soon,<br>
      ${SENDER_SIGNATURE}<br>
      Green Property Management
    `,
    name: SENDER_NAME, replyTo: REPLY_TO_EMAIL
  });
}

function sendCancellationEmail_(showing, a) {
  var firstName = firstNameOf_(a.fullName);
  var when = formatShowingTime_(showing.ShowingStart);

  GmailApp.sendEmail(a.email, 'Update on your ' + showing.Property + ' showing', '', {
    htmlBody: `
      Hi ${firstName},<br><br>
      Thank you for your interest in ${showing.Property} and for taking the time to fill out our pre-screening.
      Based on your answers, we aren't able to move forward with your showing on ${when}, so it has been cancelled.<br><br>
      If anything changes, or if you think we got something wrong, just reply to this email and we'll take another look.<br><br>
      Best,<br>
      ${SENDER_SIGNATURE}<br>
      Green Property Management
    `,
    name: SENDER_NAME, replyTo: REPLY_TO_EMAIL
  });
}

// ---------------------------------------------------------------------------
// Spencer emails (also used by Code.js for flags)
// ---------------------------------------------------------------------------

// rec: a Showings-row-shaped object (ProspectName, Email, Property, Unit, ShowingStart).
function notifySpencer_(subject, message, rec, detailsHtml) {
  var start = rec && rec.ShowingStart instanceof Date ? formatShowingTime_(rec.ShowingStart) : '';
  var line = function (label, value) { return value ? '<b>' + label + ':</b> ' + escapeHtml_(value) + '<br>' : ''; };

  var htmlBody =
    '<p>' + escapeHtml_(message) + '</p>' +
    '<p>' +
      line('Prospect', rec && rec.ProspectName) +
      line('Email', rec && rec.Email) +
      line('Property', rec && rec.Property) +
      line('Unit', rec && rec.Unit) +
      line('Showing', start) +
    '</p>' +
    (detailsHtml || '') +
    '<p style="color:#888;font-size:12px">Sent by the Spencer showing pre-screen automation (automation@).</p>';

  GmailApp.sendEmail(getNotifyEmail_(), subject, '', { htmlBody: htmlBody, name: 'Showing Pre-Screen' });
}

function screeningDetailsHtml_(a, result) {
  var rows = result.checks.map(function (c) {
    return '<tr><td>' + (c.ok ? '<b style="color:#2e7d32">PASS</b>' : '<b style="color:#c62828">FAIL</b>') + '</td><td><b>' + escapeHtml_(c.label) + '</b></td><td>' +
      escapeHtml_(c.detail) + '</td></tr>';
  }).join('');

  var answers = [
    ['Bedrooms', a.bedroomsLabel],
    ['Move-in date', a.moveInRaw],
    ['Credit range', a.creditRange],
    ['Combined monthly income', formatMoney_(a.monthlyIncome)],
    ['Cosigner', a.cosigner],
    ['Heard about us', a.referralSource],
    ['Notes', a.notes]
  ].map(function (p) {
    return '<tr><td><b>' + p[0] + '</b></td><td>' + escapeHtml_(p[1] || '—') + '</td></tr>';
  }).join('');

  return '<h3 style="margin-bottom:4px">Result: ' + result.verdict + '</h3>' +
    '<table cellpadding="4">' + rows + '</table>' +
    '<h3 style="margin-bottom:4px">Form answers</h3>' +
    '<table cellpadding="4">' + answers + '</table>';
}

function formatMoney_(n) {
  return '$' + Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------------------------------------------------------------------------
// Logging (GPM Pre-Screening Responses spreadsheet)
// ---------------------------------------------------------------------------

// New tab for the redesigned form — the old "Leads" tab (unit type, pets) is
// left untouched as history.
function logScreening_(a, result, status) {
  var ss = SpreadsheetApp.openById(getPreScreenResponsesSpreadsheetId_());
  var sheet = ss.getSheetByName(SCREENINGS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SCREENINGS_SHEET_NAME);
    sheet.appendRow(['Timestamp', 'FullName', 'Email', 'Property', 'Bedrooms', 'MoveInDate', 'CreditRange',
      'CombinedMonthlyIncome', 'Cosigner', 'ReferralSource', 'Notes', 'Verdict', 'Status', 'Reason']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), a.fullName, a.email, a.property, a.bedroomsLabel, a.moveInRaw, a.creditRange,
    a.monthlyIncome, a.cosigner, a.referralSource, a.notes, result.verdict, status, result.reason]);
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
    Logger.log('logPreScreenError_ failed: ' + loggingFailure + ' | original: ' + message);
  }
}

// Called by installShowingWorkflow() (Code.js). Safe to re-run — clears any
// existing form-submit trigger first so they never stack.
function createPreScreenSubmitTrigger() {
  deleteTriggersFor_('onPreScreenSubmit_');
  var form = getOrCreatePreScreenForm_();
  ScriptApp.newTrigger('onPreScreenSubmit_')
    .forForm(form)
    .onFormSubmit()
    .create();
}
