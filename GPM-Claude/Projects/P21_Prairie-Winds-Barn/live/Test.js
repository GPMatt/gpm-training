/**
 * End-to-end check against the live Sheet. Run testBookingFlow() from the editor.
 * Books real rows (emails go to Matt), checks every rule, cancels one, then deletes
 * all test rows so the calendar is left clean. Results print in the Execution log.
 */
function testBookingFlow() {
  var TEST_EMAIL = 'matt@greenpropertymgt.com';
  var day = '2027-03-10';      // ordinary Wednesday
  var holiday = '2026-12-25';  // Christmas Day
  var results = [];
  var ids = [];

  function base(date, slot, extra) {
    var p = { date: date, slot: slot, name: 'TEST Resident', address: '1 Test Lane', cell: '616-555-0100',
              email: TEST_EMAIL, alcohol: 'No', agree: true, agreeSignature: 'TEST Resident' };
    for (var k in extra) p[k] = extra[k];
    return p;
  }
  function expectOk(name, p, check) {
    try {
      var r = submitBooking(p);
      ids.push(r.id);
      var msg = check ? check(r) : '';
      results.push((msg ? 'FAIL ' : 'PASS ') + name + (msg ? ': ' + msg : ' (' + r.id + ', $' + r.fee + ')'));
    } catch (e) { results.push('FAIL ' + name + ': threw "' + e.message + '"'); }
    Utilities.sleep(1100); // booking IDs are per-second
  }
  function expectErr(name, p, re) {
    try { var r = submitBooking(p); ids.push(r.id); results.push('FAIL ' + name + ': was accepted'); }
    catch (e) { results.push((re.test(e.message) ? 'PASS ' : 'FAIL ') + name + ' -> "' + e.message + '"'); }
  }

  expectOk('Morning half books', base(day, 'AM'), function (r) { return r.fee === 25 ? '' : 'fee ' + r.fee; });
  expectOk('Evening half same day books', base(day, 'PM'), function (r) { return r.fee === 25 ? '' : 'fee ' + r.fee; });
  expectErr('Second morning blocked', base(day, 'AM'), /just booked/);
  expectErr('Full day blocked when halves taken', base(day, 'FULL'), /just booked/);
  expectErr('Holiday half day refused', base(holiday, 'AM'), /full-day rentals only/);
  expectOk('Holiday full day books at $150', base(holiday, 'FULL', { alcohol: 'Yes', alcoholAgree: true, alcoholSignature: 'TEST Resident' }),
    function (r) { return r.fee === 150 ? '' : 'fee ' + r.fee; });
  expectErr('Alcohol Yes without addendum refused', base('2027-03-11', 'FULL', { alcohol: 'Yes' }), /Alcohol Addendum/);
  expectErr('Past date refused', base('2020-01-01', 'FULL'), /already passed/);
  expectErr('Unsigned agreement refused', base('2027-03-11', 'FULL', { agree: false }), /agree/);

  var avail = getAvailability();
  var t = (avail.taken[day] || []).sort().join(',');
  results.push((t === 'AM,PM' ? 'PASS ' : 'FAIL ') + 'getAvailability shows ' + day + ' as [' + t + ']');
  results.push((avail.holidays[holiday] === 'Christmas Day' ? 'PASS ' : 'FAIL ') + 'Holidays tab has Christmas');

  // Cancel the morning booking through the same path Blake's edit takes.
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  var rowNum = findRow_(sh, ids[0]);
  if (rowNum) {
    var cell = sh.getRange(rowNum, COL['Status']);
    cell.setValue('Cancelled');
    onBookingEdit({ range: cell, value: 'Cancelled' });
    var out = sh.getRange(rowNum, COL['Cancellation Outcome']).getDisplayValue();
    results.push((/refunded/.test(out) && /deposit returned/.test(out) ? 'PASS ' : 'FAIL ') + 'Cancel outcome: ' + out);
    var after = (getAvailability().taken[day] || []).join(',');
    results.push((after === 'PM' ? 'PASS ' : 'FAIL ') + 'Cancelled morning slot freed (taken now [' + after + '])');
  } else {
    results.push('FAIL could not find row for ' + ids[0]);
  }

  // Clean up every test row, bottom-up.
  var rows = ids.map(function (id) { return findRow_(sh, id); }).filter(Boolean).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { sh.deleteRow(r); });
  results.push('Cleaned up ' + rows.length + ' test row(s).');

  Logger.log('\n' + results.join('\n'));
  return results;
}

function findRow_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

/** Deletes every booking row whose resident name starts with "TEST" or "UI TEST". */
function deleteTestRows() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  if (sh.getLastRow() < 2) return 0;
  var names = sh.getRange(2, COL['Resident Name'], sh.getLastRow() - 1, 1).getDisplayValues();
  var n = 0;
  for (var i = names.length - 1; i >= 0; i--) {
    if (/^(UI )?TEST\b/.test(names[i][0])) { sh.deleteRow(i + 2); n++; }
  }
  Logger.log('Deleted ' + n + ' test row(s).');
  return n;
}
