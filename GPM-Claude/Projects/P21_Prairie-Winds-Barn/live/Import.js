/**
 * One-time load of clubhouse reservations already on the AppFolio Association
 * Calendar (as of 2026-10-14), so the booking page blocks those slots.
 * Events with no time are treated as all day. An event that crosses 3:30 PM
 * blocks both halves (Full day). No emails are sent. Safe to re-run: skips any
 * date + name already in the Sheet.
 */
var APPFOLIO_EXISTING = [
  // [date, name, slot, actual start, actual end, note]
  ['2026-10-21', 'Taylor Boone - Prairie Winds Red Bud Association', 'PM', '5:30 PM', '8:00 PM', 'Sub association meeting'],
  ['2026-10-23', 'Lynch Family', 'PM', '4:00 PM', '9:30 PM', ''],
  ['2026-10-24', 'Marc White Family', 'FULL', '2:00 PM', '6:00 PM', 'AppFolio says Paid'],
  ['2026-12-05', 'David Bos Family', 'FULL', 'All day', 'All day', 'No time in AppFolio, treated as all day'],
  ['2026-12-12', 'Bergmans', 'FULL', '12:00 PM', '7:00 PM', ''],
  ['2026-12-20', 'VerWys', 'FULL', '3:00 PM', '10:00 PM', ''],
  ['2026-12-23', 'Rodriguez Family', 'PM', '5:00 PM', '11:00 PM', ''],
  ['2026-12-25', 'Vredeveld', 'FULL', '12:00 PM', '6:00 PM', '']
];

function importAppFolioReservations() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  var holidays = holidayMap_();
  var existing = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getDisplayValues().forEach(function (r) {
      existing[r[COL['Event Date'] - 1] + '|' + r[COL['Resident Name'] - 1]] = true;
    });
  }
  var added = 0, skipped = 0;
  APPFOLIO_EXISTING.forEach(function (e, i) {
    if (existing[e[0] + '|' + e[1]]) { skipped++; return; }
    var row = {};
    row['Booking ID'] = 'AF-' + e[0].replace(/-/g, '').slice(2) + '-' + (i + 1);
    row['Submitted'] = 'Imported from AppFolio';
    row['Status'] = 'Confirmed';
    row['Event Date'] = e[0];
    row['Slot'] = SLOTS[e[2]].label;
    row['Start'] = e[3];
    row['End'] = e[4];
    row['Holiday?'] = holidays[e[0]] || '';
    row['Resident Name'] = e[1];
    row['Staff Notes'] = 'Booked before the web app (AppFolio calendar), actual time ' + e[3] +
      (e[3] === 'All day' ? '' : '-' + e[4]) + '. ' + e[5];
    var values = HEADERS.map(function (h) { return row[h] === undefined ? '' : row[h]; });
    var r = sh.getLastRow() + 1;
    sh.getRange(r, COL['Event Date']).setNumberFormat('@');
    sh.getRange(r, 1, 1, HEADERS.length).setValues([values]);
    sh.getRange(r, COL['AppFolio Charges Posted?']).insertCheckboxes();
    added++;
  });
  sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).sort({ column: COL['Event Date'], ascending: true });
  Logger.log('Added ' + added + ', skipped ' + skipped + ' already present.');
  Logger.log('Taken now: ' + JSON.stringify(takenSlots_()));
}
