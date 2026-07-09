// =============================================================
// AUTO RESPONDER — Generic Template v1.1
// Replace all values marked REPLACE before going live.
// =============================================================
//
// QUICKSTART
// 1. In Google Sheets: Extensions → Apps Script → paste this file
// 2. Save, reload the Sheet — "Auto Responder" menu appears
// 3. Auto Responder → Initialize
// 4. Fill in the Setup tab (yellow cells)
// 5. In Gmail: create one label per trigger, set up a Filter to apply it
// 6. Auto Responder → Activate
// 7. Auto Responder → Send Test Email to confirm output
// =============================================================

var PROPS = PropertiesService.getScriptProperties();

// Row positions in the Setup tab — do not change
var SETUP_ROWS = {
  staffEmail:  5,
  senderName:  6,
  cooldown:    7,
  frequency:   8,
  triggers: [
    { label: 11, subject: 12, variables: 13, body: 14 },
    { label: 17, subject: 18, variables: 19, body: 20 },
    { label: 23, subject: 24, variables: 25, body: 26 },
    { label: 29, subject: 30, variables: 31, body: 32 },
    { label: 35, subject: 36, variables: 37, body: 38 },
  ]
};

// GAS only accepts these values for everyMinutes() — others are snapped to nearest
var VALID_FREQUENCIES = [1, 5, 10, 15, 30];

// =============================================================
// EXAMPLE DATA — MyCo, LLC property management starter template
// Replace all REPLACE values before activating
// =============================================================
var EXAMPLE = {
  staffEmail: 'manager@myco-example.com',      // REPLACE
  senderName: 'MyCo, LLC Leasing',

  trigger1: {
    label:   'new-inquiry',
    subject: 'You\'re One Step Away — Schedule Your Tour Today',
    body:
      'Hello {{FIRST_NAME}},\n\n' +
      'Thank you for your interest in our available units at Main Street Properties. We\'d love to get you in for a look!\n\n' +
      '[SCHEDULE YOUR TOUR](https://your-tour-link.com)\n\n' +      // REPLACE
      'Here\'s what we screen for:\n' +
      '- Gross income: 3x the monthly rent\n' +
      '- Credit score: 625 or higher\n' +
      '- No prior evictions\n' +
      '- Clean rental history and background check\n\n' +
      'Tours are available 7 days a week — units move quickly, so grab your spot.\n\n' +
      'If you\'d prefer a personal showing, our leasing team will reach out shortly.\n\n' +
      'Thank you,\n' +
      'Leasing Team\n' +
      'MyCo, LLC'
  },

  trigger2: {
    label:   'maintenance-request',
    subject: 'Maintenance Request Received — We\'re On It',
    body:
      'Hello {{FIRST_NAME}},\n\n' +
      'We\'ve received your maintenance request and our team will be in touch within 24 hours to schedule service.\n\n' +
      'For emergencies (no heat, flooding, gas leak), please call our emergency line immediately:\n' +
      '[Emergency Line](tel:+10000000000)\n\n' +                    // REPLACE
      'You can also check your request status in the resident portal:\n' +
      '[Resident Portal](https://your-portal-link.com)\n\n' +       // REPLACE
      'Thank you,\n' +
      'Maintenance Team\n' +
      'MyCo, LLC'
  }
};


// ---- MENU ----

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Auto Responder')
    .addItem('Initialize (first-time setup)', 'initialize')
    .addSeparator()
    .addItem('Activate / Update Settings', 'activateResponder')
    .addItem('Send Test Email (Trigger 1)', 'sendTestEmail')
    .addItem('Check Labels', 'checkAllLabels')
    .addSeparator()
    .addItem('Deactivate', 'deactivateResponder')
    .addToUi();
}


// ---- INITIALIZE ----

function initialize() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildSetupTab_(ss);
  ensureLeadSheet_(ss);
  buildInstructionsSheet_(ss);
  SpreadsheetApp.getUi().alert(
    'Ready to Configure',
    'Setup tab created with example data.\n\n' +
    'See the Setup Instructions tab for next steps.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}


// ---- ACTIVATE ----

function activateResponder() {
  var ui    = SpreadsheetApp.getUi();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Setup');

  if (!sheet) {
    if (ui.alert('No Setup Tab', 'Run Auto Responder → Initialize first?', ui.ButtonSet.YES_NO) === ui.Button.YES) {
      initialize();
    }
    return;
  }

  var staffEmail  = sheet.getRange(SETUP_ROWS.staffEmail, 2).getValue().toString().trim();
  var senderName  = sheet.getRange(SETUP_ROWS.senderName, 2).getValue().toString().trim();
  var cooldownMin = parseFloat(sheet.getRange(SETUP_ROWS.cooldown, 2).getValue()) || 15;
  var freqRaw     = parseInt(sheet.getRange(SETUP_ROWS.frequency, 2).getValue()) || 5;
  var frequency   = snapFrequency_(freqRaw);

  var errors = [];
  if (!staffEmail)                              errors.push('• Reply-To & Alert Email is required (row ' + SETUP_ROWS.staffEmail + ')');
  if (staffEmail && !isValidEmail_(staffEmail)) errors.push('• Reply-To & Alert Email address is not valid');
  if (staffEmail && staffEmail.includes('myco-example.com')) errors.push('• Reply-To & Alert Email is still a placeholder — replace it');
  if (!senderName)                              errors.push('• Sender Display Name is required (row ' + SETUP_ROWS.senderName + ')');

  if (errors.length) {
    ui.alert('Fix Before Activating', errors.join('\n'), ui.ButtonSet.OK);
    return;
  }

  PROPS.setProperty('STAFF_EMAIL', staffEmail);
  PROPS.setProperty('SENDER_NAME', senderName);
  PROPS.setProperty('COOLDOWN_SECONDS', String(Math.round(cooldownMin * 60)));
  PROPS.setProperty('RUN_FREQUENCY', String(frequency));

  var triggerCount  = 0;
  var skipped       = [];
  var labelWarnings = [];

  SETUP_ROWS.triggers.forEach(function(rows, idx) {
    var num       = idx + 1;
    var labelName = sheet.getRange(rows.label, 2).getValue().toString().trim();
    if (!labelName) return;

    var subject = sheet.getRange(rows.subject, 2).getValue().toString().trim();
    var bodyRaw = sheet.getRange(rows.body, 2).getValue().toString().trim();

    if (!subject) { skipped.push('• Trigger ' + num + ' ("' + labelName + '"): missing Subject Line.'); return; }
    if (!bodyRaw)  { skipped.push('• Trigger ' + num + ' ("' + labelName + '"): missing Response Body.'); return; }
    if (bodyRaw.includes('your-') || bodyRaw.includes('REPLACE')) {
      skipped.push('• Trigger ' + num + ' ("' + labelName + '"): body still has placeholder links — replace them first.');
      return;
    }

    if (!GmailApp.getUserLabelByName(labelName)) {
      labelWarnings.push('• "' + labelName + '" not found in Gmail.');
    }

    triggerCount++;
    PROPS.setProperty('TRIGGER_' + triggerCount + '_LABEL',   labelName);
    PROPS.setProperty('TRIGGER_' + triggerCount + '_SUBJECT', subject);
    PROPS.setProperty('TRIGGER_' + triggerCount + '_BODY',    convertBodyToHtml_(bodyRaw));
  });

  if (triggerCount === 0) {
    ui.alert('No Triggers Found',
      'Fill in at least one trigger block (Label + Subject + Body) and try again.\n\nReplace any placeholder links first.',
      ui.ButtonSet.OK);
    return;
  }

  PROPS.setProperty('TRIGGER_COUNT', String(triggerCount));

  deleteTriggers_();
  ScriptApp.newTrigger('autoResponder').timeBased().everyMinutes(frequency).create();
  ensureLeadSheet_(ss);

  var msg = triggerCount + ' trigger(s) activated. Running every ' + frequency + ' minutes.';
  if (freqRaw !== frequency) msg += '\n(Your frequency of ' + freqRaw + ' min was adjusted to ' + frequency + ' — valid values: 1, 5, 10, 15, 30.)';
  if (skipped.length)        msg += '\n\nSkipped:\n' + skipped.join('\n');
  if (labelWarnings.length)  msg += '\n\n⚠ Label Warning — these weren\'t found in Gmail (auto-alert will fire when they run):\n' + labelWarnings.join('\n') +
    '\n\nFix: Gmail → Settings → Labels → create label with exact name shown, then set a Filter to apply it.';

  ui.alert('Activated', msg, ui.ButtonSet.OK);
}


// ---- MAIN RUNNER ----

function autoResponder() {
  var triggerCount = parseInt(PROPS.getProperty('TRIGGER_COUNT') || '0');
  if (triggerCount === 0) return;

  // Prevents overlapping executions (e.g. a large backlog after reactivation
  // taking longer than the trigger interval) from double-sending — the
  // per-address cache check below only protects a single execution.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    autoResponder_run_(triggerCount);
  } finally {
    lock.releaseLock();
  }
}

function autoResponder_run_(triggerCount) {
  var staffEmail   = PROPS.getProperty('STAFF_EMAIL');
  var senderName   = PROPS.getProperty('SENDER_NAME');
  var cooldown     = parseInt(PROPS.getProperty('COOLDOWN_SECONDS') || '900');
  var cache        = CacheService.getScriptCache();
  var leadSheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Lead Log');

  for (var t = 1; t <= triggerCount; t++) {
    var labelName    = PROPS.getProperty('TRIGGER_' + t + '_LABEL');
    var subject      = PROPS.getProperty('TRIGGER_' + t + '_SUBJECT');
    var bodyTemplate = PROPS.getProperty('TRIGGER_' + t + '_BODY');

    if (!labelName) continue;

    var gmailLabel = GmailApp.getUserLabelByName(labelName);
    if (!gmailLabel) {
      sendLabelAlert_(labelName, t, staffEmail, cache);
      continue;
    }

    var threads = gmailLabel.getThreads();

    for (var i = 0; i < threads.length; i++) {
      var thread      = threads[i];
      var messages    = thread.getMessages();
      var lastMessage = messages[messages.length - 1];

      if (!lastMessage.isUnread()) {
        thread.moveToArchive();
        continue;
      }

      var fromHeader    = lastMessage.getFrom();
      var replyToRaw    = lastMessage.getReplyTo();
      var prospectEmail = extractEmail_(replyToRaw) || extractEmail_(fromHeader);

      if (!prospectEmail || !isValidEmail_(prospectEmail)) {
        thread.markRead();
        thread.moveToArchive();
        continue;
      }

      var nameRaw   = fromHeader.replace(/<[^>]+>/, '').trim().replace(/"/g, '').trim();
      var firstName = nameRaw.split(' ')[0];
      if (!firstName || firstName.includes('@')) firstName = 'there';

      var cacheKey = 'ar_t' + t + '_' + prospectEmail;

      if (!cache.get(cacheKey)) {
        var body = bodyTemplate.replace(/\{\{FIRST_NAME\}\}/g, firstName);

        GmailApp.sendEmail(prospectEmail, subject, '', {
          htmlBody: body,
          name:     senderName,
          replyTo:  staffEmail
        });

        cache.put(cacheKey, 'sent', cooldown);

        if (leadSheet) {
          leadSheet.appendRow([
            new Date(),
            labelName,
            prospectEmail,
            nameRaw,
            lastMessage.getSubject()
          ]);
        }
      }

      thread.markRead();
      thread.moveToArchive();
    }
  }
}


// ---- CHECK LABELS ----

function checkAllLabels() {
  var ui    = SpreadsheetApp.getUi();
  var count = parseInt(PROPS.getProperty('TRIGGER_COUNT') || '0');

  if (count === 0) {
    ui.alert('Not Activated', 'Activate the responder first.', ui.ButtonSet.OK);
    return;
  }

  var lines = [];
  for (var t = 1; t <= count; t++) {
    var label = PROPS.getProperty('TRIGGER_' + t + '_LABEL');
    var ok    = GmailApp.getUserLabelByName(label) !== null;
    lines.push((ok ? '✓ ' : '✗ ') + '"' + label + '"');
  }

  var allOk = lines.every(function(l) { return l[0] === '✓'; });
  ui.alert(allOk ? 'All Labels OK' : 'Label Issues Found', lines.join('\n'), ui.ButtonSet.OK);
}


// ---- SEND TEST EMAIL ----

function sendTestEmail() {
  var ui    = SpreadsheetApp.getUi();
  var count = parseInt(PROPS.getProperty('TRIGGER_COUNT') || '0');

  if (count === 0) {
    ui.alert('Not Activated', 'Activate first.', ui.ButtonSet.OK);
    return;
  }

  var staffEmail = PROPS.getProperty('STAFF_EMAIL');
  var senderName = PROPS.getProperty('SENDER_NAME');
  var subject    = '[TEST] ' + PROPS.getProperty('TRIGGER_1_SUBJECT');
  var body       = PROPS.getProperty('TRIGGER_1_BODY').replace(/\{\{FIRST_NAME\}\}/g, 'Test User');

  GmailApp.sendEmail(staffEmail, subject, '', {
    htmlBody: body,
    name:     senderName,
    replyTo:  staffEmail
  });

  ui.alert('Test Sent', 'Preview email sent to ' + staffEmail + ' using Trigger 1 settings.', ui.ButtonSet.OK);
}


// ---- DEACTIVATE ----

function deactivateResponder() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Deactivate?', 'Stop the auto responder?', ui.ButtonSet.YES_NO) === ui.Button.YES) {
    deleteTriggers_();
    ui.alert('Stopped', 'Auto Responder has been deactivated.', ui.ButtonSet.OK);
  }
}


// ================================================================
// PRIVATE HELPERS
// ================================================================

// Converts plain-text body to HTML.
// [Button Text](https://url)  → <a href> tag  (no raw URL duplication)
// [Phone Label](tel:+1...)    → tappable phone link
// bare https:// URLs          → wrapped in <a> tag automatically
// \n                          → <br>
function convertBodyToHtml_(text) {
  var links = [];

  var html = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g, function(_, linkText, url) {
    var idx = links.length;
    links.push('<a href="' + url + '">' + linkText + '</a>');
    return '%%L' + idx + '%%';
  });

  html = html.replace(/\[([^\]]+)\]\((tel:[^\)\s]+)\)/g, function(_, linkText, tel) {
    var idx = links.length;
    links.push('<a href="' + tel + '">' + linkText + '</a>');
    return '%%L' + idx + '%%';
  });

  html = html.replace(/(https?:\/\/[^\s<"]+)/g, function(url) {
    var idx = links.length;
    links.push('<a href="' + url + '">' + url + '</a>');
    return '%%L' + idx + '%%';
  });

  html = html.replace(/\n/g, '<br>');

  links.forEach(function(link, idx) {
    html = html.split('%%L' + idx + '%%').join(link);
  });

  return html;
}

function snapFrequency_(min) {
  return VALID_FREQUENCIES.reduce(function(prev, curr) {
    return Math.abs(curr - min) < Math.abs(prev - min) ? curr : prev;
  });
}

function extractEmail_(str) {
  if (!str) return null;
  var match = str.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  return str.includes('@') ? str.trim() : null;
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Fires once per hour max per trigger when a label is missing in Gmail
function sendLabelAlert_(labelName, triggerNum, staffEmail, cache) {
  var alertKey = 'label_alert_t' + triggerNum;
  if (cache.get(alertKey)) return;

  var subject = '[Auto Responder Alert] Gmail Label Not Found: "' + labelName + '"';
  var body =
    'Your Auto Responder could not find this Gmail label:<br><br>' +
    '<strong>"' + labelName + '"</strong> (Trigger ' + triggerNum + ')<br><br>' +
    'Emails for this trigger are <strong>not being processed</strong>.<br><br>' +
    '<strong>To fix:</strong><br>' +
    '1. Open Gmail → gear icon → See all settings → Labels tab<br>' +
    '2. Create a label named exactly: <strong>' + labelName + '</strong> (case-sensitive)<br>' +
    '3. Gmail → gear icon → Filters and Blocked Addresses → Create a new filter<br>' +
    '4. Set your match criteria → Apply the label: ' + labelName + '<br><br>' +
    'Then click <strong>Auto Responder → Check Labels</strong> in your sheet to confirm.';

  GmailApp.sendEmail(staffEmail, subject, '', { htmlBody: body });
  cache.put(alertKey, 'alerted', 3600);
}

function ensureLeadSheet_(ss) {
  if (ss.getSheetByName('Lead Log')) return;
  var sheet = ss.insertSheet('Lead Log');
  sheet.appendRow(['Timestamp', 'Gmail Label', 'Lead Email', 'Lead Name', 'Original Subject']);
  sheet.getRange('1:1').setFontWeight('bold').setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 240);
  sheet.setColumnWidth(4, 180);
  sheet.setColumnWidth(5, 280);
}

function deleteTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'autoResponder') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

// Builds the Setup Instructions tab on Sheet1 (or creates it)
function buildInstructionsSheet_(ss) {
  var sheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('Setup Instructions');

  if (!sheet) {
    sheet = ss.insertSheet('Setup Instructions');
  } else {
    sheet.setName('Setup Instructions');
    sheet.clearContents();
    sheet.clearFormats();
  }

  sheet.setColumnWidth(1, 520);

  var GREEN_DARK = '#1b5e20';
  var rows = [
    { text: 'AUTO RESPONDER — Setup Instructions', bold: true, size: 13, bg: GREEN_DARK, color: '#ffffff' },
    { text: '' },
    { text: 'Step 1  —  Fill in the Setup tab', bold: true },
    { text: '         Open the Setup tab. Fill in every yellow cell. Replace all placeholder values (look for "your-" or "REPLACE").' },
    { text: '' },
    { text: 'Step 2  —  Create your Gmail Labels', bold: true },
    { text: '         In Gmail: click the gear icon → See all settings → Labels → Create new label.' },
    { text: '         Name the label exactly as entered in the Setup tab (case-sensitive).' },
    { text: '         Create one label per trigger you configured.' },
    { text: '' },
    { text: 'Step 3  —  Set up Gmail Filters', bold: true },
    { text: '         In Gmail: gear icon → See all settings → Filters and Blocked Addresses → Create a new filter.' },
    { text: '         Set your match criteria (subject keywords, sender domain, etc.).' },
    { text: '         At the bottom of the filter, choose "Apply the label" and select your label.' },
    { text: '         Check "Also apply to matching conversations" to catch any existing emails.' },
    { text: '' },
    { text: 'Step 4  —  Activate', bold: true },
    { text: '         Click Auto Responder → Activate in the top menu.' },
    { text: '         Fix any warnings shown before the responder goes live.' },
    { text: '' },
    { text: 'Step 5  —  Confirm with a test email', bold: true },
    { text: '         Click Auto Responder → Send Test Email.' },
    { text: '         Check your inbox — the email should arrive formatted correctly with working links.' },
    { text: '' },
    { text: 'Step 6  —  Verify labels are active', bold: true },
    { text: '         Click Auto Responder → Check Labels anytime to confirm all labels are found.' },
    { text: '         If a label goes missing, an alert email will be sent to your Reply-To address automatically.' },
    { text: '' },
    { text: 'Need to update your settings?', bold: true },
    { text: '         Edit any yellow cell in the Setup tab and click Activate again — it updates immediately.' },
  ];

  rows.forEach(function(row, idx) {
    var cell = sheet.getRange(idx + 1, 1);
    cell.setValue(row.text || '');
    if (row.bold)  cell.setFontWeight('bold');
    if (row.size)  cell.setFontSize(row.size);
    if (row.bg)    cell.setBackground(row.bg);
    if (row.color) cell.setFontColor(row.color);
    if (!row.text) sheet.setRowHeight(idx + 1, 10);
  });

  sheet.setFrozenRows(1);
}

function buildSetupTab_(ss) {
  var existing = ss.getSheetByName('Setup');
  if (existing) ss.deleteSheet(existing);

  var s = ss.insertSheet('Setup', 0);
  s.setColumnWidth(1, 220);
  s.setColumnWidth(2, 410);
  s.setColumnWidth(3, 16);
  s.setColumnWidth(4, 290);

  var YELLOW     = '#fffde7';
  var INFO_BG    = '#f3e5f5';   // light purple — read-only variable reference rows
  var GREEN_DARK = '#1b5e20';
  var GREEN_MID  = '#c8e6c9';
  var BLUE_MID   = '#bbdefb';
  var BLUE_LIGHT = '#e3f2fd';

  var VARS_TEXT =
    '{{FIRST_NAME}}  →  Lead\'s first name from email (shows "there" if name can\'t be read)\n' +
    '[Button Text](https://your-url.com)  →  Clickable link — replace both the label and the URL';

  // Row 1: Title
  s.getRange('A1:D1').merge()
    .setValue('AUTO RESPONDER — Setup')
    .setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center')
    .setBackground(GREEN_DARK).setFontColor('#ffffff');

  // Row 2: Instructions
  s.getRange('A2:D2').merge()
    .setValue('Fill in column B (yellow cells) only.  Replace every value marked REPLACE or containing "your-" before activating.')
    .setFontStyle('italic').setFontSize(10).setFontColor('#555555').setBackground('#f5f5f5');

  // Row 4: General Settings header
  s.getRange('A4:D4').merge()
    .setValue('GENERAL SETTINGS')
    .setFontWeight('bold').setBackground(GREEN_MID);

  // Rows 5-8: general settings
  var generalFields = [
    [SETUP_ROWS.staffEmail, 'Reply-To & Alert Email',    EXAMPLE.staffEmail,  'Responses reply to this address. System alert emails are also sent here.  REPLACE'],
    [SETUP_ROWS.senderName, 'Sender Display Name',       EXAMPLE.senderName,  'Name shown in the recipient\'s inbox  (e.g. "Main Street Leasing")'],
    [SETUP_ROWS.cooldown,   'Cooldown (minutes)',         15,                  'Minimum time before sending another response to the same email address'],
    [SETUP_ROWS.frequency,  'Run Frequency (minutes)',    5,                   'How often the responder checks for new emails  (valid: 1, 5, 10, 15, 30)'],
  ];

  generalFields.forEach(function(field) {
    s.getRange(field[0], 1).setValue(field[1]);
    s.getRange(field[0], 2).setValue(field[2]).setBackground(YELLOW);
    s.getRange(field[0], 4).setValue(field[3]).setFontColor('#888888').setFontStyle('italic').setFontSize(9);
  });

  // Trigger blocks
  var triggerDefaults = [EXAMPLE.trigger1, EXAMPLE.trigger2, null, null, null];

  SETUP_ROWS.triggers.forEach(function(rows, idx) {
    var num      = idx + 1;
    var optional = num > 1 ? '  (optional)' : '';
    var defaults = triggerDefaults[idx];
    var headerBg = num === 1 ? BLUE_MID : BLUE_LIGHT;

    // Header row
    s.getRange(rows.label - 1, 1, 1, 4).merge()
      .setValue('TRIGGER ' + num + optional)
      .setFontWeight('bold').setBackground(headerBg);

    // Gmail Label row
    s.getRange(rows.label, 1).setValue('Gmail Label Name');
    s.getRange(rows.label, 2).setValue(defaults ? defaults.label : '').setBackground(YELLOW);
    s.getRange(rows.label, 4).setValue('Must match your Gmail label exactly — case-sensitive')
      .setFontColor('#888888').setFontStyle('italic').setFontSize(9);

    // Subject row
    s.getRange(rows.subject, 1).setValue('Response Subject Line');
    s.getRange(rows.subject, 2).setValue(defaults ? defaults.subject : '').setBackground(YELLOW);
    s.getRange(rows.subject, 4).setValue('Subject line the lead receives in their inbox')
      .setFontColor('#888888').setFontStyle('italic').setFontSize(9);

    // Variables info row (read-only, not yellow)
    s.getRange(rows.variables, 1).setValue('Available Variables').setFontStyle('italic').setFontColor('#6a1b9a');
    s.getRange(rows.variables, 2).setValue(VARS_TEXT)
      .setBackground(INFO_BG).setFontColor('#6a1b9a').setFontSize(9)
      .setVerticalAlignment('top').setWrap(true);
    s.setRowHeight(rows.variables, 44);

    // Body row
    s.getRange(rows.body, 1).setValue('Response Body');
    s.getRange(rows.body, 2).setValue(defaults ? defaults.body : '')
      .setBackground(YELLOW).setVerticalAlignment('top').setWrap(true);
    s.getRange(rows.body, 4).setValue('Paste your full email here. Use the variables above.')
      .setFontColor('#888888').setFontStyle('italic').setFontSize(9);
    s.setRowHeight(rows.body, 140);
  });

  s.setFrozenRows(2);
}
