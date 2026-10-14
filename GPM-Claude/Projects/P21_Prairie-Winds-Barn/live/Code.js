/**
 * Prairie Winds Clubhouse Reservations (P21)
 *
 * A GAS web app (the link that goes into AppFolio) where a homeowner books the
 * Prairie Winds HOA clubhouse ("the barn"), signs the reservation agreement and,
 * if alcohol is served, the Alcohol Addendum. Bookings land in the bound Sheet,
 * the resident gets a confirmation, Blake gets the details.
 *
 * Rules come from the PWHOA Clubhouse Reservation Agreement (Rev. 8/2021) plus
 * decisions made 2026-10-14:
 * - Slots: Morning half 8:00 AM-3:30 PM ($25), Evening half 3:30 PM-midnight ($25),
 *   Full day 8:00 AM-midnight ($50). Full day takes both halves. Two halves can
 *   share a day, no buffer between them.
 * - Holidays (Holidays tab, editable): full day only, $150.
 * - $200 security deposit on every booking.
 * - Fee + deposit are charged to the homeowner's AppFolio ledger by staff, not paid here.
 * - Instant confirm; same-day booking allowed. No Google Calendar: the Bookings tab
 *   IS the calendar, and the page greys out taken slots from it.
 * - Cancellation (per the agreement): cancelling 7 days or less before the event
 *   forfeits the usage fee, deposit returned. Rentals in May, June, or Thanksgiving
 *   through New Year's Day carry a $30 cancellation fee.
 *
 * Setup: run setup() once from the editor (builds the tabs + the onEdit trigger).
 * Then Deploy > New deployment > Web app, execute as me, access Anyone.
 *
 * Cancelling: Blake sets Status to "Cancelled" on the Bookings tab. The onEdit
 * trigger frees the slot, writes the cancellation outcome, and emails the resident.
 */

var CONFIG = {
  // While true, every staff email goes to Matt instead of Blake.
  TEST_MODE: true,
  STAFF_EMAIL: 'blake@greenpropertymgt.com',
  TEST_STAFF_EMAIL: 'matt@greenpropertymgt.com',
  TZ: 'America/Detroit',
  MAX_MONTHS_AHEAD: 12,
  DEPOSIT: 200,
  PEAK_CANCEL_FEE: 30,
  CANCEL_FORFEIT_DAYS: 7,
  ADDRESS: '6611 Prairie Winds Drive, Zeeland, MI 49464'
};

var SLOTS = {
  AM:   { label: 'Morning half day', start: '8:00 AM', end: '3:30 PM',  fee: 25 },
  PM:   { label: 'Evening half day', start: '3:30 PM', end: '12:00 AM (midnight)', fee: 25 },
  FULL: { label: 'Full day',         start: '8:00 AM', end: '12:00 AM (midnight)', fee: 50 }
};
var HOLIDAY_FULL_FEE = 150;

// Minutes after midnight each slot ends; used to stop same-day booking of a slot that's over.
var SLOT_END_MINUTES = { AM: 15 * 60 + 30, PM: 24 * 60, FULL: 24 * 60 };

var SHEET_BOOKINGS = 'Bookings';
var SHEET_HOLIDAYS = 'Holidays';

var HEADERS = [
  'Booking ID', 'Submitted', 'Status', 'Event Date', 'Slot', 'Start', 'End', 'Holiday?',
  'Usage Fee', 'Deposit', 'Alcohol?', 'Resident Name', 'Resident Address', 'Cell Phone',
  'Email', 'Agreement Signed (typed name)', 'Alcohol Addendum Signed (typed name)',
  'AppFolio Charges Posted?', 'Deposit Status', 'Cancelled On', 'Cancellation Outcome', 'Staff Notes'
];
// 1-based column numbers for the columns the code touches.
var COL = {};
HEADERS.forEach(function (h, i) { COL[h] = i + 1; });

// ---------------------------------------------------------------- Setup

function setup() {
  var ss = SpreadsheetApp.getActive();

  var b = ss.getSheetByName(SHEET_BOOKINGS) || ss.insertSheet(SHEET_BOOKINGS);
  b.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#d9ead3');
  b.setFrozenRows(1);
  // Keep dates as plain text so availability matching never fights Sheets' date parsing.
  b.getRange(2, COL['Event Date'], b.getMaxRows() - 1, 1).setNumberFormat('@');
  b.getRange(2, COL['Status'], b.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Confirmed', 'Cancelled'], true).build());
  b.getRange(2, COL['AppFolio Charges Posted?'], b.getMaxRows() - 1, 1).insertCheckboxes();
  b.getRange(2, COL['Deposit Status'], b.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(
      ['Charged', 'Returned', 'Partially kept', 'Kept'], true).build());

  var h = ss.getSheetByName(SHEET_HOLIDAYS) || ss.insertSheet(SHEET_HOLIDAYS);
  if (h.getLastRow() < 2) {
    var rows = [];
    var y0 = Number(Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy'));
    for (var y = y0; y <= y0 + 2; y++) {
      majorHolidays_(y).forEach(function (r) { rows.push(r); });
    }
    h.getRange(1, 1, 1, 2).setValues([['Date (yyyy-mm-dd)', 'Holiday']]).setFontWeight('bold');
    h.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    h.getRange(2, 1, rows.length, 2).setValues(rows);
    h.setFrozenRows(1);
  }

  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onBookingEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onBookingEdit').forSpreadsheet(ss).onEdit().create();
}

function majorHolidays_(y) {
  function iso(m, d) { return y + '-' + pad_(m) + '-' + pad_(d); }
  function nthWeekday(m, weekday, n) { // n-th weekday (0=Sun) of month m (1-12)
    var d = new Date(y, m - 1, 1);
    var offset = (weekday - d.getDay() + 7) % 7;
    return 1 + offset + (n - 1) * 7;
  }
  function lastWeekday(m, weekday) {
    var last = new Date(y, m, 0);
    return last.getDate() - ((last.getDay() - weekday + 7) % 7);
  }
  return [
    [iso(1, 1), "New Year's Day"],
    [iso(5, lastWeekday(5, 1)), 'Memorial Day'],
    [iso(7, 4), 'Independence Day'],
    [iso(9, nthWeekday(9, 1, 1)), 'Labor Day'],
    [iso(11, nthWeekday(11, 4, 4)), 'Thanksgiving'],
    [iso(12, 24), 'Christmas Eve'],
    [iso(12, 25), 'Christmas Day'],
    [iso(12, 31), "New Year's Eve"]
  ];
}

function pad_(n) { return (n < 10 ? '0' : '') + n; }

// ---------------------------------------------------------------- Web app

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Prairie Winds Clubhouse Reservation')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Everything the page needs to draw the calendar: taken slots, holidays, today, limits. */
function getAvailability() {
  var today = todayIso_();
  return {
    today: today,
    nowMinutes: nowMinutes_(),
    maxDate: addMonthsIso_(today, CONFIG.MAX_MONTHS_AHEAD),
    taken: takenSlots_(),
    holidays: holidayMap_(),
    slots: SLOTS,
    holidayFee: HOLIDAY_FULL_FEE,
    deposit: CONFIG.DEPOSIT
  };
}

/** { 'yyyy-mm-dd': ['AM', 'FULL', ...] } for confirmed bookings. */
function takenSlots_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  var out = {};
  if (sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getDisplayValues();
  vals.forEach(function (r) {
    if (r[COL['Status'] - 1] !== 'Confirmed') return;
    var d = r[COL['Event Date'] - 1];
    var slot = slotKeyFromLabel_(r[COL['Slot'] - 1]);
    if (!d || !slot) return;
    (out[d] = out[d] || []).push(slot);
  });
  return out;
}

function holidayMap_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_HOLIDAYS);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
    if (r[0]) out[r[0].trim()] = r[1];
  });
  return out;
}

function slotKeyFromLabel_(label) {
  for (var k in SLOTS) if (SLOTS[k].label === label) return k;
  return null;
}

function conflicts_(slot, takenOnDate) {
  return (takenOnDate || []).some(function (t) {
    return slot === 'FULL' || t === 'FULL' || t === slot;
  });
}

/** Called by the page. Re-validates everything server-side under a lock. */
function submitBooking(p) {
  p = p || {};
  var req = ['date', 'slot', 'name', 'address', 'cell', 'email', 'agreeSignature'];
  for (var i = 0; i < req.length; i++) {
    if (!String(p[req[i]] || '').trim()) throw new Error('Missing ' + req[i] + '.');
  }
  if (!SLOTS[p.slot]) throw new Error('Unknown time slot.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error('Bad date.');
  if (!p.agree) throw new Error('You must agree to the reservation agreement.');
  var alcohol = p.alcohol === 'Yes';
  if (alcohol && (!p.alcoholAgree || !String(p.alcoholSignature || '').trim())) {
    throw new Error('Alcohol is being served, so the Alcohol Addendum must be signed.');
  }

  var today = todayIso_();
  if (p.date < today) throw new Error('That date has already passed.');
  if (p.date > addMonthsIso_(today, CONFIG.MAX_MONTHS_AHEAD)) {
    throw new Error('Bookings open up to ' + CONFIG.MAX_MONTHS_AHEAD + ' months ahead.');
  }
  if (p.date === today && nowMinutes_() >= SLOT_END_MINUTES[p.slot]) {
    throw new Error('That time slot is already over for today.');
  }

  var holidays = holidayMap_();
  var holiday = holidays[p.date] || '';
  if (holiday && p.slot !== 'FULL') throw new Error(holiday + ' is a holiday: full-day rentals only.');
  var fee = holiday ? HOLIDAY_FULL_FEE : SLOTS[p.slot].fee;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var booking;
  try {
    if (conflicts_(p.slot, takenSlots_()[p.date])) {
      throw new Error('Sorry, that slot was just booked by someone else. Please pick another.');
    }
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
    var id = 'PW-' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyMMdd-HHmmss');
    var s = SLOTS[p.slot];
    var row = {};
    row['Booking ID'] = id;
    row['Submitted'] = Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm');
    row['Status'] = 'Confirmed';
    row['Event Date'] = p.date;
    row['Slot'] = s.label;
    row['Start'] = s.start;
    row['End'] = s.end;
    row['Holiday?'] = holiday;
    row['Usage Fee'] = fee;
    row['Deposit'] = CONFIG.DEPOSIT;
    row['Alcohol?'] = alcohol ? 'Yes' : 'No';
    row['Resident Name'] = clean_(p.name);
    row['Resident Address'] = clean_(p.address);
    row['Cell Phone'] = clean_(p.cell);
    row['Email'] = clean_(p.email);
    row['Agreement Signed (typed name)'] = clean_(p.agreeSignature);
    row['Alcohol Addendum Signed (typed name)'] = alcohol ? clean_(p.alcoholSignature) : '';
    row['AppFolio Charges Posted?'] = false;
    row['Deposit Status'] = '';
    var values = HEADERS.map(function (h) { return row[h] === undefined ? '' : row[h]; });
    var r = sh.getLastRow() + 1;
    sh.getRange(r, COL['Event Date']).setNumberFormat('@');
    sh.getRange(r, 1, 1, HEADERS.length).setValues([values]);
    sh.getRange(r, COL['AppFolio Charges Posted?']).insertCheckboxes();
    SpreadsheetApp.flush();
    booking = row;
  } finally {
    lock.releaseLock();
  }

  sendResidentConfirmation_(booking);
  sendStaffNotice_(booking);
  return { id: booking['Booking ID'], fee: fee, deposit: CONFIG.DEPOSIT, slot: booking['Slot'],
           date: prettyDate_(p.date), start: booking['Start'], end: booking['End'] };
}

function clean_(v) {
  // A leading = + - @ would make Sheets treat a resident's text as a formula.
  var s = String(v || '').trim().slice(0, 300);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ---------------------------------------------------------------- Cancellation

/** Installable onEdit: Status -> "Cancelled" applies the agreement's cancellation rules. */
function onBookingEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEET_BOOKINGS || e.range.getColumn() !== COL['Status'] || e.range.getRow() < 2) return;
  if (e.range.getNumRows() !== 1 || e.value !== 'Cancelled') return;
  var r = e.range.getRow();
  var row = rowObject_(sh, r);
  if (row['Cancelled On']) return; // already processed

  var outcome = cancellationOutcome_(row['Event Date'], todayIso_(), Number(row['Usage Fee']));
  sh.getRange(r, COL['Cancelled On']).setValue(Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'));
  sh.getRange(r, COL['Cancellation Outcome']).setValue(outcome.summary);
  row['Cancellation Outcome'] = outcome.summary;
  sendCancellationEmails_(row, outcome);
}

/**
 * Agreement: "Cancellations 7 days or less from the event date will forfeit the
 * rental fee; the deposit will be returned." and "Rentals during the months of May
 * and June and rentals between, and including, Thanksgiving Day & New Year's Day
 * are subject to a $30 cancellation fee."
 */
function cancellationOutcome_(eventIso, todayIso, usageFee) {
  var days = daysBetween_(todayIso, eventIso);
  var forfeitFee = days <= CONFIG.CANCEL_FORFEIT_DAYS;
  var peak = isPeakDate_(eventIso);
  var parts = [];
  parts.push(forfeitFee
    ? 'Usage fee of $' + usageFee + ' forfeited (cancelled ' + Math.max(days, 0) + ' day(s) before the event).'
    : 'Usage fee of $' + usageFee + ' refunded (cancelled more than ' + CONFIG.CANCEL_FORFEIT_DAYS + ' days ahead).');
  if (peak) parts.push('$' + CONFIG.PEAK_CANCEL_FEE + ' peak-season cancellation fee applies.');
  parts.push('$' + CONFIG.DEPOSIT + ' security deposit returned.');
  return { daysOut: days, forfeitFee: forfeitFee, peak: peak, summary: parts.join(' ') };
}

function isPeakDate_(iso) {
  var y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  if (m === 5 || m === 6) return true;
  if (m === 1 && d === 1) return true;
  if (m === 12) return true;
  if (m === 11) {
    var first = new Date(y, 10, 1).getDay();
    var thanksgiving = 1 + ((4 - first + 7) % 7) + 21;
    return d >= thanksgiving;
  }
  return false;
}

function rowObject_(sh, r) {
  var vals = sh.getRange(r, 1, 1, HEADERS.length).getDisplayValues()[0];
  var o = {};
  HEADERS.forEach(function (h, i) { o[h] = vals[i]; });
  return o;
}

// ---------------------------------------------------------------- Email

function staffTo_() { return CONFIG.TEST_MODE ? CONFIG.TEST_STAFF_EMAIL : CONFIG.STAFF_EMAIL; }

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function detailsTable_(b) {
  var rows = [
    ['Booking ID', b['Booking ID']],
    ['Date', prettyDate_(b['Event Date']) + (b['Holiday?'] ? ' (' + b['Holiday?'] + ')' : '')],
    ['Time', b['Slot'] + ': ' + b['Start'] + ' to ' + b['End']],
    ['Usage fee', '$' + b['Usage Fee']],
    ['Security deposit', '$' + b['Deposit']],
    ['Alcohol served', b['Alcohol?']],
    ['Name', b['Resident Name']],
    ['Address', b['Resident Address']],
    ['Cell phone', b['Cell Phone']],
    ['Email', b['Email']]
  ];
  return '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    rows.map(function (r) {
      return '<tr><td style="border:1px solid #ddd;background:#f6f6f6"><b>' + esc_(r[0]) +
        '</b></td><td style="border:1px solid #ddd">' + esc_(r[1]) + '</td></tr>';
    }).join('') + '</table>';
}

var EXIT_CHECKLIST_HTML =
  '<p><b>Exit checklist</b>: these fees come out of your deposit if an item is left incomplete or a rule is broken:</p><ul>' +
  '<li>Cleaning (complete list available at the clubhouse): $100</li>' +
  '<li>Trash to the dumpster and cans relined (kitchen, men\'s &amp; women\'s restrooms): $50</li>' +
  '<li>Absolutely no use of the patio or pool area: $200</li>' +
  '<li>Absolutely no tape, glitter, tacks, glue, or putty on any walls or woodwork: $100</li>' +
  '<li>Prelock the front door</li>' +
  '<li>Sign the exit checklist: $100</li>' +
  '<li>Vacate the clubhouse at the scheduled time: $50</li></ul>';

function sendResidentConfirmation_(b) {
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:14px">' +
    '<p>Hi ' + esc_(b['Resident Name']) + ',</p>' +
    '<p>Your Prairie Winds clubhouse reservation is confirmed.</p>' + detailsTable_(b) +
    '<p>The $' + esc_(b['Usage Fee']) + ' usage fee and the $' + esc_(b['Deposit']) +
    ' security deposit will be charged to your AppFolio account. The deposit is returned after the event ' +
    'if the exit checklist is complete, nothing is damaged or lost, and no clubhouse rules are broken.</p>' +
    '<p><b>Location:</b> ' + esc_(CONFIG.ADDRESS) + '. The rental covers the clubhouse only, not the ' +
    'Eastbrook office space, pool, patio, grill, or outdoor use of the parking lot or grass. Eastbrook Homes ' +
    'may use their sales office in the clubhouse during your rental. No smoking within 25 feet of the building.</p>' +
    EXIT_CHECKLIST_HTML +
    '<p><b>Cancellations:</b> cancelling 7 days or less before your event forfeits the usage fee (your deposit ' +
    'is returned). Rentals in May, June, or from Thanksgiving through New Year\'s Day carry a $30 cancellation fee. ' +
    'You may reschedule once for inclement weather with no penalty. To cancel or reschedule, reply to this email.</p>' +
    '<p>Thank you,<br>Green Property Management</p></div>';
  MailApp.sendEmail({
    to: b['Email'],
    replyTo: CONFIG.STAFF_EMAIL,
    name: 'Green Property Management',
    subject: 'Clubhouse reservation confirmed: ' + prettyDate_(b['Event Date']),
    htmlBody: html
  });
}

function sendStaffNotice_(b) {
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:14px">' +
    (CONFIG.TEST_MODE ? '<p style="color:#b00"><b>TEST MODE</b>: would have gone to ' + esc_(CONFIG.STAFF_EMAIL) + '.</p>' : '') +
    '<p>New Prairie Winds clubhouse booking (confirmed automatically).</p>' + detailsTable_(b) +
    '<p><b>To do:</b></p><ol>' +
    '<li>Post the $' + esc_(b['Usage Fee']) + ' usage fee and $' + esc_(b['Deposit']) +
    ' deposit to the homeowner\'s AppFolio ledger, then tick "AppFolio Charges Posted?" in the Sheet.</li>' +
    '<li>Forward to the clubhouse committee for the walkthrough.</li></ol>' +
    '<p>Agreement signed as: ' + esc_(b['Agreement Signed (typed name)']) +
    (b['Alcohol?'] === 'Yes' ? '<br>Alcohol Addendum signed as: ' + esc_(b['Alcohol Addendum Signed (typed name)']) : '') +
    '</p><p><a href="' + SpreadsheetApp.getActive().getUrl() + '">Open the bookings Sheet</a></p></div>';
  MailApp.sendEmail({
    to: staffTo_(),
    replyTo: b['Email'],
    subject: 'Barn booking: ' + b['Resident Name'] + ', ' + prettyDate_(b['Event Date']) + ' (' + b['Slot'] + ')',
    htmlBody: html
  });
}

function sendCancellationEmails_(row, outcome) {
  var body =
    '<div style="font-family:Arial,sans-serif;font-size:14px">' +
    '<p>Hi ' + esc_(row['Resident Name']) + ',</p>' +
    '<p>Your Prairie Winds clubhouse reservation for ' + esc_(prettyDate_(row['Event Date'])) + ' (' +
    esc_(row['Slot']) + ') has been cancelled.</p><p>' + esc_(outcome.summary) + '</p>' +
    '<p>Thank you,<br>Green Property Management</p></div>';
  if (row['Email']) {
    MailApp.sendEmail({ to: row['Email'], replyTo: CONFIG.STAFF_EMAIL, name: 'Green Property Management',
      subject: 'Clubhouse reservation cancelled: ' + prettyDate_(row['Event Date']), htmlBody: body });
  }
  MailApp.sendEmail({ to: staffTo_(),
    subject: 'Barn booking CANCELLED: ' + row['Resident Name'] + ', ' + prettyDate_(row['Event Date']),
    htmlBody: '<p><b>Adjust the AppFolio charges to match:</b></p>' + body });
}

// ---------------------------------------------------------------- Dates

function todayIso_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }

function nowMinutes_() {
  var t = Utilities.formatDate(new Date(), CONFIG.TZ, 'HH:mm').split(':');
  return Number(t[0]) * 60 + Number(t[1]);
}

function isoToUtc_(iso) {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function daysBetween_(fromIso, toIso) { return Math.round((isoToUtc_(toIso) - isoToUtc_(fromIso)) / 86400000); }

function addMonthsIso_(iso, n) {
  var d = new Date(isoToUtc_(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function prettyDate_(iso) {
  var d = new Date(isoToUtc_(iso));
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'];
  return days[d.getUTCDay()] + ', ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}
