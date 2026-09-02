/**
 * GPM 5-Star Review Tracker
 *
 * One-time setup for a brand-new tracker: run setupReviewTracker() from the Apps
 * Script editor (Run button). It builds the submission Form and the tracking Sheet
 * together, links them, and installs an onFormSubmit trigger that completes each
 * new response row (checkbox + formulas) the instant it arrives.
 *
 * NOTE: Google Forms inserts each new response as a fresh row right after the
 * header and pushes everything else down — it does NOT append below existing
 * content. Pre-filling formulas down a fixed number of rows does not survive that;
 * they end up orphaned below the real data. That's why row completion happens live,
 * per submission, via the trigger below, instead of being pre-filled at setup time.
 *
 * DESIGN:
 * - Reviews is a pure append-only confirmation log — it only ever tracks what's
 *   been EARNED, never what's been PAID.
 * - Summary is the lifetime, never-reset totals per employee.
 * - Payouts is the payout control center: what's still owed, plus a "Paid Out?"
 *   checkbox per employee that settles everything owed in one click instead of
 *   checking a box per review.
 *
 * migrateToPayoutLedger() is the one-time migration for the tracker that's already
 * live — see LIVE_SPREADSHEET_ID below. It also works around a real Apps Script
 * gotcha: deleting/shifting columns on one sheet and then, in the same execution,
 * writing a formula on another sheet that references the shifted column can
 * evaluate against a stale pre-shift snapshot. SpreadsheetApp.flush() forces the
 * structural change to commit before any formula depending on it is created.
 *
 * After setup, use the "Review Tracker" menu in the Sheet for:
 * - "Refresh Dropdowns from Config" — push Config-tab employee/property edits into
 *   the live Form's dropdowns.
 * - "Backfill / Repair Rows Now" — re-run row completion across all existing Reviews
 *   rows; safe to run any time, never overwrites an already-checked checkbox.
 */

// The tracker that's already live and collecting real tech submissions.
// Only used by the one-time migration functions to repair it in place — never recreated.
var LIVE_SPREADSHEET_ID = '1NJl0ltJjLzHxlCfzh-TL4Z_pGNNd5PLaczm-VLyJ1vs';

var CASH_BONUS_PER_REVIEW = 25;

// Lifetime PTO milestone schedule: [reviewCountThreshold, hoursAwardedAtThisMilestone].
// Caps permanently once the last threshold is hit — no more PTO from this program after that.
var PTO_MILESTONES = [
  [10, 2],
  [20, 2],
  [30, 4],
  [45, 4],
  [60, 4]
];
var PTO_MAX_HOURS = 16;

// How many employee rows to provision on the Payouts tab.
var PAYOUTS_ROW_HEADROOM = 50;

// Recipients for the monthly review-count report (sendMonthlyReviewReport).
var MONTHLY_REPORT_RECIPIENTS = [
  'matt@greenpropertymgt.com',
  'jason@greenpropertymgt.com',
  'laura@greenpropertymgt.com'
];

// Bounded range ceiling used in Summary/Payouts formulas instead of whole-column
// references, so header rows and any future column shifts can't create ambiguity.
var REVIEWS_ROW_CEILING = 5000;

var DEFAULT_EMPLOYEES = [
  'Isaac', 'Wesley', 'John', 'Bill', 'Riley', 'Joe', 'Laura C', 'Spencer',
  'Blake', 'Mike', 'Jill', 'Jason', 'Jody', 'Marty', 'Laura', 'Matthieu'
];

var DEFAULT_PROPERTIES = [
  'GPM (Green)', 'Victory on Leonard', 'Pinery Woods', 'Oakwood', 'Oak Valley'
];

function setupReviewTracker() {
  // 1. Build the Form first.
  var form = FormApp.create('GPM 5-Star Review Submission');
  form.setDescription(
    'Got a 5-star review? Log it here. Every confirmed review earns $' + CASH_BONUS_PER_REVIEW +
    ' cash, plus PTO hours on a lifetime milestone schedule (up to ' + PTO_MAX_HOURS + ' hours max).'
  );
  form.setCollectEmail(false);

  var employeeItem = form.addListItem();
  employeeItem.setTitle('Employee').setChoiceValues(DEFAULT_EMPLOYEES).setRequired(true);

  var dateItem = form.addDateItem();
  // No year sub-field — three spinner boxes for one date is friction techs hit on
  // every submission. Reviews are logged close to when they happen, so the sheet's
  // own Timestamp column covers the rare case of a late-December review logged in
  // January.
  dateItem.setTitle('Review Date').setIncludesYear(false).setRequired(true);

  var reviewerItem = form.addTextItem();
  reviewerItem.setTitle('Reviewer').setHelpText("The reviewer's name, as shown on the review.").setRequired(true);

  var propertyItem = form.addListItem();
  propertyItem.setTitle('Property (GBP)')
    .setHelpText('Which Google Business Profile / property was the review left on?')
    .setChoiceValues(DEFAULT_PROPERTIES)
    .setRequired(true);

  // 2. Build the Sheet and link the Form to it.
  var ss = SpreadsheetApp.create('GPM 5-Star Review Tracker');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // setDestination's response sheet can take a moment to materialize.
  var responseSheet = null;
  for (var attempt = 0; attempt < 10 && !responseSheet; attempt++) {
    if (attempt > 0) Utilities.sleep(1000);
    responseSheet = ss.getSheetByName('Form Responses 1');
  }
  if (!responseSheet) throw new Error('Form response sheet did not appear in time — rerun setupReviewTracker().');

  responseSheet.setName('Reviews');
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);

  buildReviewsSheet_(responseSheet);
  buildConfigSheet_(ss);
  SpreadsheetApp.flush();

  buildSummarySheet_(ss);
  buildPayoutsSheet_(ss);

  ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();
  ensureFormSubmitTrigger_(ss);
  ensurePayoutsEditTrigger_(ss);
  ensureMonthlyReportTrigger_();

  Logger.log('Form (share this with techs): ' + form.getPublishedUrl());
  Logger.log('Form editor: ' + form.getEditUrl());
  Logger.log('Sheet: ' + ss.getUrl());
}

/**
 * One-time migration for the tracker that's already live (LIVE_SPREADSHEET_ID):
 * strips the old per-row paid-tracking columns from Reviews, splits payout tracking
 * into a Summary tab (lifetime totals) and a Payouts tab (still-owed + Paid Out?
 * checkboxes), and re-completes every existing Reviews row. Run once from the
 * editor. Safe to re-run.
 */
function migrateToPayoutLedger() {
  var ss = SpreadsheetApp.openById(LIVE_SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Reviews');
  if (!sheet) throw new Error('No "Reviews" tab found on the live spreadsheet.');

  stripPaidColumnsFromReviews_(sheet);

  var lastRow = getLastReviewRow_(sheet);
  for (var r = 2; r <= lastRow; r++) {
    completeReviewRow_(sheet, r);
  }
  cleanupOrphanedPrefill_(sheet, lastRow);

  // Commit the Reviews column structure before any other sheet writes a formula
  // that references it — otherwise that formula can evaluate against a stale
  // pre-shift snapshot of the shifted columns (this is what caused Cash Bonus
  // Earned to sum to 0 while Total Reviews, unaffected by the shift, worked fine).
  SpreadsheetApp.flush();

  buildSummarySheet_(ss);
  SpreadsheetApp.flush();

  buildPayoutsSheet_(ss);

  ensureFormSubmitTrigger_(ss);
  ensurePayoutsEditTrigger_(ss);
  ensureMonthlyReportTrigger_();

  Logger.log('Migration complete. Reviews rebuilt through row ' + lastRow + '. Summary and Payouts rebuilt.');
}

/** Removes the old per-row paid-tracking columns from Reviews by header name, right-to-left. */
function stripPaidColumnsFromReviews_(sheet) {
  var toRemove = ['PTO Paid?', 'PTO Pay Date', 'Cash Paid?', 'Cash Pay Date'];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var indices = [];
  headers.forEach(function(h, idx) {
    if (toRemove.indexOf(h) !== -1) indices.push(idx + 1);
  });
  indices.sort(function(a, b) { return b - a; }); // rightmost first so earlier indices stay valid
  indices.forEach(function(colIndex) { sheet.deleteColumn(colIndex); });
}

function buildReviewsSheet_(sheet) {
  // Columns A-D (Timestamp, Employee, Review Date, Reviewer) and E (Property (GBP))
  // already exist with headers set by the Form. Add the log/formula columns.
  var extraHeaders = ['Confirmed', 'Running Review Count', 'PTO Hours Earned', 'Cash Bonus Earned', 'Notes'];
  sheet.getRange(1, 6, 1, extraHeaders.length).setValues([extraHeaders]);
  sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 10);
}

/**
 * Completes one Reviews row: the Confirmed checkbox (only if one isn't already
 * present, so an existing TRUE is never clobbered) plus the three earned-amount
 * formulas. Called by onFormSubmit for new rows, and by the backfill/migration
 * functions for existing ones. Reviews only ever tracks what's earned — payout
 * state lives on Payouts.
 */
function completeReviewRow_(sheet, row) {
  ensureCheckbox_(sheet.getRange(row, 6)); // F Confirmed

  // G: Running Review Count — lifetime confirmed reviews for this employee, through this row.
  sheet.getRange(row, 7).setFormula(
    '=IF($F' + row + '=TRUE, COUNTIFS($B$2:$B' + row + ',$B' + row + ',$F$2:$F' + row + ',TRUE), "")'
  );

  // H: PTO Hours Earned — this row's bonus if the running count lands exactly on a
  // milestone threshold (10/20/30/45/60), else 0. Milestones don't repeat past 60.
  var ptoTerms = PTO_MILESTONES.map(function(m) {
    return '$G' + row + '=' + m[0] + ',' + m[1];
  }).join(',');
  sheet.getRange(row, 8).setFormula('=IFS(' + ptoTerms + ',TRUE,0)');

  // I: Cash Bonus Earned — flat amount on every confirmed review, no milestone.
  sheet.getRange(row, 9).setFormula('=IF($F' + row + '=TRUE, ' + CASH_BONUS_PER_REVIEW + ', 0)');
}

function ensureCheckbox_(cell) {
  if (!cell.getDataValidation()) cell.insertCheckboxes();
}

/**
 * Clears any stray formulas/checkbox validation left in rows below the real data —
 * leftovers from the old pre-fill approach that Forms' row-insert behavior orphaned.
 */
function cleanupOrphanedPrefill_(sheet, lastDataRow) {
  var maxRow = sheet.getMaxRows();
  var lastCol = sheet.getLastColumn();
  if (maxRow > lastDataRow && lastCol >= 6) {
    var range = sheet.getRange(lastDataRow + 1, 6, maxRow - lastDataRow, lastCol - 5); // F:end
    range.clearContent();
    range.clearDataValidations();
  }
}

function getLastReviewRow_(sheet) {
  var maxRow = sheet.getMaxRows();
  if (maxRow < 2) return 1;
  var colA = sheet.getRange(2, 1, maxRow - 1, 1).getValues();
  var last = 1;
  for (var i = 0; i < colA.length; i++) {
    if (colA[i][0] !== '') last = i + 2;
  }
  return last;
}

/**
 * Fires on every Form submission. Completes whatever row Forms actually wrote the
 * response into — never assumes it's the "next" row, since Forms inserts above
 * existing content rather than appending below it.
 */
function onFormSubmit(e) {
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  completeReviewRow_(sheet, row);
}

function ensureFormSubmitTrigger_(ss) {
  var already = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'onFormSubmit';
  });
  if (!already) {
    ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  }
}

/** Menu action: re-run row completion across every existing Reviews row. Safe to re-run. */
function backfillMissingFormulas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Reviews');
  if (!sheet) throw new Error('No "Reviews" tab found.');

  var lastRow = getLastReviewRow_(sheet);
  for (var r = 2; r <= lastRow; r++) {
    completeReviewRow_(sheet, r);
  }
  cleanupOrphanedPrefill_(sheet, lastRow);
  ensureFormSubmitTrigger_(ss);
  ensurePayoutsEditTrigger_(ss);
  ensureMonthlyReportTrigger_();

  SpreadsheetApp.getUi().alert('Backfilled Reviews rows 2-' + lastRow + ' and confirmed all triggers are installed.');
}

/**
 * Returns a completely blank sheet with the given name: an existing one is
 * unmerged and cleared in place (content, formats, data validations), a missing
 * one is created fresh. Rebuilding by clearing-in-place, rather than deleting the
 * sheet and immediately inserting a new one with the same name, avoids a real
 * Apps Script/Sheets timing gap — the delete-then-recreate-with-the-same-name
 * pattern is what caused Cash Bonus Earned's array formula to spill only into its
 * anchor cell and leave stale literal 0s in every row below it.
 */
function getOrCreateCleanSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return ss.insertSheet(name);

  var range = sheet.getDataRange();
  if (range.getNumRows() > 0 && range.getNumColumns() > 0) {
    range.breakApart();
  }
  sheet.clear();
  sheet.clearNotes();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  return sheet;
}

function buildConfigSheet_(ss) {
  var config = ss.insertSheet('Config');
  config.getRange(1, 1, 1, 2).setValues([['Employees', 'Properties (active GBPs)']]).setFontWeight('bold');
  var rows = Math.max(DEFAULT_EMPLOYEES.length, DEFAULT_PROPERTIES.length);
  for (var i = 0; i < rows; i++) {
    config.getRange(i + 2, 1).setValue(DEFAULT_EMPLOYEES[i] || '');
    config.getRange(i + 2, 2).setValue(DEFAULT_PROPERTIES[i] || '');
  }
  config.autoResizeColumns(1, 2);
  config.setFrozenRows(1);
}

/**
 * Lifetime, never-reset totals per employee. Pure formulas, nothing manual, nothing
 * that ever resets. Pulls the employee list live from Config via ARRAYFORMULA, so
 * adding a name to Config automatically adds a row here too.
 */
function buildSummarySheet_(ss) {
  var summary = getOrCreateCleanSheet_(ss, 'Summary');

  summary.getRange('A1:D1').merge().setValue('All-Time Totals (lifetime, never resets)')
    .setFontWeight('bold').setBackground('#d9ead3');

  var headers = ['Employee', 'Total Reviews', 'Cash Bonus Earned', 'PTO Hours Earned'];
  summary.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  summary.setFrozenRows(2);

  var lastRow = REVIEWS_ROW_CEILING;
  summary.getRange('A3').setFormula('=ARRAYFORMULA(IF(Config!A2:A="","",Config!A2:A))');
  summary.getRange('B3').setFormula(
    '=ARRAYFORMULA(IF(A3:A="","",COUNTIFS(Reviews!$B$2:$B$' + lastRow + ',A3:A,Reviews!$F$2:$F$' + lastRow + ',TRUE)))'
  );
  // SUMIFS does not broadcast an array criteria argument under ARRAYFORMULA — it
  // evaluates once (against the anchor row) and every other spilled row gets a
  // literal 0, which is exactly the bug this replaced. These have only one
  // condition each, so plain SUMIF is both correct and (unlike SUMIFS) broadcasts
  // properly here.
  summary.getRange('C3').setFormula(
    '=ARRAYFORMULA(IF(A3:A="","",SUMIF(Reviews!$B$2:$B$' + lastRow + ',A3:A,Reviews!$I$2:$I$' + lastRow + ')))'
  );
  summary.getRange('D3').setFormula(
    '=ARRAYFORMULA(IF(A3:A="","",SUMIF(Reviews!$B$2:$B$' + lastRow + ',A3:A,Reviews!$H$2:$H$' + lastRow + ')))'
  );

  summary.autoResizeColumns(1, headers.length);
}

/**
 * The payout control center, on its own tab. Owed = lifetime earned (pulled from
 * Summary) minus the paid-to-date ledger. Checking a "Paid Out?" box records
 * everything currently owed as paid, timestamps it, zeroes Owed, and auto-unchecks
 * itself — one click settles an employee's whole balance, not one click per review.
 *
 *   A-G  Unpaid / Still Owed — Employee, Cash Owed, Cash Paid Out?, Last Cash Payout
 *        Date, PTO Owed, PTO Paid Out?, Last PTO Payout Date.
 *   H-I  Ledger (auto-managed) — running paid-to-date totals; only onPayoutsEdit
 *        writes here, never edit by hand.
 */
function buildPayoutsSheet_(ss) {
  var payouts = getOrCreateCleanSheet_(ss, 'Payouts');

  payouts.getRange('A1:G1').merge().setValue('Unpaid / Still Owed — check "Paid Out?" to record a payout and reset')
    .setFontWeight('bold').setBackground('#fce5cd');
  payouts.getRange('H1:I1').merge().setValue('Ledger — auto-managed, do not edit directly')
    .setFontWeight('bold').setBackground('#efefef').setFontColor('#666666');

  var headers = [
    'Employee', 'Cash Bonus Owed', 'Cash Paid Out?', 'Last Cash Payout Date',
    'PTO Hours Owed', 'PTO Paid Out?', 'Last PTO Payout Date'
  ];
  var ledgerHeaders = ['Cash Paid To Date', 'PTO Paid To Date'];
  payouts.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  payouts.getRange(2, 8, 1, ledgerHeaders.length).setValues([ledgerHeaders]).setFontWeight('bold').setFontColor('#666666');
  payouts.setFrozenRows(2);

  payouts.getRange('A3').setFormula('=ARRAYFORMULA(IF(Config!A2:A="","",Config!A2:A))');
  payouts.getRange('B3').setFormula('=ARRAYFORMULA(IF(A3:A="","",Summary!C3:C-H3:H))');
  payouts.getRange('E3').setFormula('=ARRAYFORMULA(IF(A3:A="","",Summary!D3:D-I3:I))');
  // Last-payout-date columns (D, G) are written only by onPayoutsEdit — left blank at build time.

  // Paid Out? checkboxes (C, F) and the ledger (H, I) are plain manual/system cells,
  // not array formulas — provision a fixed block of rows for them.
  payouts.getRange(3, 3, PAYOUTS_ROW_HEADROOM, 1).insertCheckboxes(); // C Cash Paid Out?
  payouts.getRange(3, 6, PAYOUTS_ROW_HEADROOM, 1).insertCheckboxes(); // F PTO Paid Out?

  payouts.getRange(3, 8, PAYOUTS_ROW_HEADROOM, 2).setValue(0); // H:I ledger starts at 0

  payouts.autoResizeColumns(1, 9);
}

/**
 * Installable onEdit trigger for the Payouts sheet. Checking a Paid Out? box pulls
 * that employee's lifetime-earned total from Summary, writes it into the
 * paid-to-date ledger (which zeroes Owed via the B/E formulas), stamps today's
 * date, then unchecks the box so it's ready for the next payout cycle.
 */
function onPayoutsEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== 'Payouts') return;
  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row < 3) return;

  var summarySheet = sheet.getParent().getSheetByName('Summary');

  if (col === 3 && sheet.getRange(row, 3).getValue() === true) { // C: Cash Paid Out?
    var earnedCash = summarySheet.getRange(row, 3).getValue(); // Summary C: Cash Bonus Earned
    sheet.getRange(row, 8).setValue(earnedCash); // H: Cash Paid To Date
    sheet.getRange(row, 4).setValue(new Date()); // D: Last Cash Payout Date
    sheet.getRange(row, 3).setValue(false);       // reset checkbox
  }

  if (col === 6 && sheet.getRange(row, 6).getValue() === true) { // F: PTO Paid Out?
    var earnedPto = summarySheet.getRange(row, 4).getValue(); // Summary D: PTO Hours Earned
    sheet.getRange(row, 9).setValue(earnedPto);  // I: PTO Paid To Date
    sheet.getRange(row, 7).setValue(new Date()); // G: Last PTO Payout Date
    sheet.getRange(row, 6).setValue(false);       // reset checkbox
  }
}

function ensurePayoutsEditTrigger_(ss) {
  var already = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'onPayoutsEdit';
  });
  if (!already) {
    ScriptApp.newTrigger('onPayoutsEdit').forSpreadsheet(ss).onEdit().create();
  }
}

/**
 * Emails MONTHLY_REPORT_RECIPIENTS a per-employee count of confirmed 5-star
 * reviews for the month that just ended, plus each employee's lifetime total
 * for context (pulled straight from Summary, already computed there). Meant to
 * run on a time-based trigger firing the 1st of every month — see
 * ensureMonthlyReportTrigger_. Opens the live spreadsheet directly by ID
 * rather than via getActiveSpreadsheet(), since a time-based trigger has no
 * bound-sheet context.
 *
 * Counts by Timestamp (column A), not Review Date (column C) — Review Date has
 * no year field (see setupReviewTracker's dateItem), so it can't be reliably
 * bucketed into a calendar month on its own.
 */
function sendMonthlyReviewReport() {
  var ss = SpreadsheetApp.openById(LIVE_SPREADSHEET_ID);
  var reviewsSheet = ss.getSheetByName('Reviews');
  var configSheet = ss.getSheetByName('Config');
  var summarySheet = ss.getSheetByName('Summary');
  if (!reviewsSheet || !configSheet || !summarySheet) {
    throw new Error('Reviews, Config, and Summary tabs are all required to send the monthly report.');
  }

  var now = new Date();
  var periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var periodEnd = new Date(now.getFullYear(), now.getMonth(), 1); // exclusive

  var employees = getConfigEmployees_(configSheet);
  var monthlyCounts = {};
  employees.forEach(function(name) { monthlyCounts[name] = 0; });

  var lastRow = getLastReviewRow_(reviewsSheet);
  if (lastRow >= 2) {
    var data = reviewsSheet.getRange(2, 1, lastRow - 1, 6).getValues(); // A:F
    data.forEach(function(row) {
      var timestamp = row[0], employee = row[1], confirmed = row[5];
      if (confirmed === true && timestamp instanceof Date && timestamp >= periodStart && timestamp < periodEnd) {
        monthlyCounts[employee] = (monthlyCounts[employee] || 0) + 1;
      }
    });
  }

  var lifetimeTotals = {};
  var summaryLastRow = summarySheet.getLastRow();
  if (summaryLastRow >= 3) {
    summarySheet.getRange(3, 1, summaryLastRow - 2, 2).getValues().forEach(function(row) {
      if (row[0]) lifetimeTotals[row[0]] = row[1];
    });
  }

  var rows = employees.map(function(name) {
    return { name: name, monthly: monthlyCounts[name] || 0, lifetime: lifetimeTotals[name] || 0 };
  }).sort(function(a, b) { return b.monthly - a.monthly || a.name.localeCompare(b.name); });

  var monthLabel = Utilities.formatDate(periodStart, Session.getScriptTimeZone(), 'MMMM yyyy');
  var totalMonthly = rows.reduce(function(sum, r) { return sum + r.monthly; }, 0);

  MailApp.sendEmail({
    to: MONTHLY_REPORT_RECIPIENTS.join(','),
    subject: 'GPM 5-Star Review Report — ' + monthLabel,
    htmlBody: buildMonthlyReportHtml_(monthLabel, rows, totalMonthly, ss.getUrl())
  });
}

function getConfigEmployees_(configSheet) {
  var lastRow = configSheet.getLastRow();
  if (lastRow < 2) return [];
  return configSheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(function(row) { return row[0]; })
    .filter(String);
}

function buildMonthlyReportHtml_(monthLabel, rows, totalMonthly, sheetUrl) {
  var rowsHtml = rows.map(function(r) {
    return '<tr>' +
      '<td style="padding:4px 12px;border-bottom:1px solid #eee;">' + r.name + '</td>' +
      '<td style="padding:4px 12px;border-bottom:1px solid #eee;text-align:center;">' + r.monthly + '</td>' +
      '<td style="padding:4px 12px;border-bottom:1px solid #eee;text-align:center;color:#666;">' + r.lifetime + '</td>' +
      '</tr>';
  }).join('');

  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;">' +
    '<h2 style="margin-bottom:4px;">GPM 5-Star Review Report — ' + monthLabel + '</h2>' +
    '<p style="margin-top:0;color:#555;">' + totalMonthly + ' confirmed 5-star review' +
    (totalMonthly === 1 ? '' : 's') + ' logged in ' + monthLabel + '.</p>' +
    '<table style="border-collapse:collapse;">' +
    '<tr>' +
    '<th style="text-align:left;padding:4px 12px;border-bottom:2px solid #333;">Employee</th>' +
    '<th style="padding:4px 12px;border-bottom:2px solid #333;">' + monthLabel + '</th>' +
    '<th style="padding:4px 12px;border-bottom:2px solid #333;color:#666;">Lifetime</th>' +
    '</tr>' +
    rowsHtml +
    '</table>' +
    '<p style="margin-top:16px;"><a href="' + sheetUrl + '">Open tracker</a></p>' +
    '</div>';
}

function ensureMonthlyReportTrigger_() {
  var already = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'sendMonthlyReviewReport';
  });
  if (!already) {
    ScriptApp.newTrigger('sendMonthlyReviewReport').timeBased().onMonthDay(1).atHour(7).create();
  }
}

/**
 * Reads the Config tab and pushes the current Employee/Property lists into the
 * live Form's dropdowns. Run this (via the Sheet menu) any time Config changes.
 */
function refreshDropdowns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = ss.getSheetByName('Config');
  if (!config) throw new Error('No Config tab found.');

  var lastRow = config.getLastRow();
  var values = lastRow > 1 ? config.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  var employees = values.map(function(row) { return row[0]; }).filter(String);
  var properties = values.map(function(row) { return row[1]; }).filter(String);

  var form = FormApp.openById(getFormId_());
  form.getItems(FormApp.ItemType.LIST).forEach(function(item) {
    var listItem = item.asListItem();
    if (listItem.getTitle() === 'Employee') listItem.setChoiceValues(employees);
    if (listItem.getTitle() === 'Property (GBP)') listItem.setChoiceValues(properties);
  });

  SpreadsheetApp.getUi().alert('Dropdowns updated: ' + employees.length + ' employees, ' + properties.length + ' properties.');
}

function getFormId_() {
  var url = SpreadsheetApp.getActiveSpreadsheet().getFormUrl();
  if (!url) throw new Error('This Sheet is not linked to a Form.');
  var form = FormApp.openByUrl(url);
  return form.getId();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Review Tracker')
    .addItem('Refresh Dropdowns from Config', 'refreshDropdowns')
    .addItem('Backfill / Repair Rows Now', 'backfillMissingFormulas')
    .addItem('Send Monthly Report Now (test)', 'sendMonthlyReviewReport')
    .addToUi();
}
