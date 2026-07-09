// =============================================================
// AUTO RESPONDER — Generic Template v1.0
// Stack A: Google Sheet + Apps Script
// Triggers: Gmail Labels | Lead logging: Sheet tab
// =============================================================
//
// SETUP INSTRUCTIONS
// 1. In Google Sheets: Extensions → Apps Script → paste this file
// 2. Save, then reload your Sheet — an "Auto Responder" menu will appear
// 3. Click Auto Responder → Initialize (builds the Setup and Lead Log tabs)
// 4. In Gmail: Settings → Labels → create one label per trigger
// 5. In Gmail: Settings → Filters → apply that label to matching emails
// 6. Fill in the Setup tab in your Sheet
// 7. Click Auto Responder → Activate
// =============================================================

var PROPS = PropertiesService.getScriptProperties();

// Row positions in the Setup tab (do not change unless you rebuild the tab)
var SETUP_ROWS = {
  staffEmail:   5,
  senderName:   6,
  cooldown:     7,
  triggers: [
    { label: 10, name: 11, subject: 12, body: 13 },
    { label: 16, name: 17, subject: 18, body: 19 },
    { label: 22, name: 23, subject: 24, body: 25 },
    { label: 28, name: 29, subject: 30, body: 31 },
    { label: 34, name: 35, subject: 36, body: 37 },
  ]
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
// Builds the Setup and Lead Log tabs. Safe to re-run — rebuilds Setup tab only.

function initialize() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildSetupTab_(ss);
  ensureLeadSheet_(ss);
  ui.alert(
    'Ready to Configure',
    'Setup and Lead Log tabs created.\n\n' +
    'Next steps:\n' +
    '1. Fill in the Setup tab (column B)\n' +
    '2. In Gmail → Settings → Labels: create one label per trigger\n' +
    '3. In Gmail → Settings → Filters: route matching emails to that label\n' +
    '4. Click Auto Responder → Activate',
    ui.ButtonSet.OK
  );
}


// ---- ACTIVATE ----
// Reads config from the Setup tab, saves to Script Properties, starts the trigger.

function activateResponder() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Setup');

  if (!sheet) {
    if (ui.alert('No Setup Tab', 'Run Auto Responder → Initialize first?', ui.ButtonSet.YES_NO) === ui.Button.YES) {
      initialize();
    }
    return;
  }

  var staffEmail = sheet.getRange(SETUP_ROWS.staffEmail, 2).getValue().toString().trim();
  var senderName = sheet.getRange(SETUP_ROWS.senderName, 2).getValue().toString().trim();
  var cooldownMin = parseFloat(sheet.getRange(SETUP_ROWS.cooldown, 2).getValue()) || 15;

  var errors = [];
  if (!staffEmail) errors.push('• Staff Email is required (row ' + SETUP_ROWS.staffEmail + ')');
  if (staffEmail && !isValidEmail_(staffEmail)) errors.push('• Staff Email address is not valid');
  if (!senderName) errors.push('• Sender Display Name is required (row ' + SETUP_ROWS.senderName + ')');

  if (errors.length) {
    ui.alert('Fix Before Activating', errors.join('\n'), ui.ButtonSet.OK);
    return;
  }

  PROPS.setProperty('STAFF_EMAIL', staffEmail);
  PROPS.setProperty('SENDER_NAME', senderName);
  PROPS.setProperty('COOLDOWN_SECONDS', String(Math.round(cooldownMin * 60)));

  var triggerCount = 0;
  var skipped = [];
  var labelWarnings = [];

  SETUP_ROWS.triggers.forEach(function(rows, idx) {
    var num = idx + 1;
    var labelName = sheet.getRange(rows.label, 2).getValue().toString().trim();
    if (!labelName) return; // Empty slot — skip silently

    var triggerName = sheet.getRange(rows.name, 2).getValue().toString().trim() || 'Trigger ' + num;
    var subject    = sheet.getRange(rows.subject, 2).getValue().toString().trim();
    var bodyRaw    = sheet.getRange(rows.body, 2).getValue().toString().trim();

    if (!subject) { skipped.push('• Trigger ' + num + ' ("' + labelName + '"): missing Subject Line.'); return; }
    if (!bodyRaw)  { skipped.push('• Trigger ' + num + ' ("' + labelName + '"): missing Response Body.'); return; }

    if (!GmailApp.getUserLabelByName(labelName)) {
      labelWarnings.push('• Trigger ' + num + ': label "' + labelName + '" not found in Gmail.');
    }

    triggerCount++;
    PROPS.setProperty('TRIGGER_' + triggerCount + '_LABEL',   labelName);
    PROPS.setProperty('TRIGGER_' + triggerCount + '_NAME',    triggerName);
    PROPS.setProperty('TRIGGER_' + triggerCount + '_SUBJECT', subject);
    PROPS.setProperty('TRIGGER_' + triggerCount + '_BODY',    convertBodyToHtml_(bodyRaw));
  });

  if (triggerCount === 0) {
    ui.alert('No Triggers Found',
      'Fill in at least one trigger block (Label Name + Subject + Body) and try again.',
      ui.ButtonSet.OK);
    return;
  }

  PROPS.setProperty('TRIGGER_COUNT', String(triggerCount));

  deleteTriggers_();
  ScriptApp.newTrigger('autoResponder').timeBased().everyMinutes(10).create();
  ensureLeadSheet_(ss);

  var msg = triggerCount + ' trigger(s) activated. Running every 10 minutes.';
  if (skipped.length)       msg += '\n\nSkipped:\n' + skipped.join('\n');
  if (labelWarnings.length) msg += '\n\n⚠ Label Warning (auto-alert will fire when these run):\n' + labelWarnings.join('\n') +
    '\n\nFix: Gmail → Settings → Labels → create label with that exact name, then set up a Filter to apply it.';

  ui.alert('Activated', msg, ui.ButtonSet.OK);
}


// ---- MAIN RUNNER ----
// Runs on schedule. For each trigger: check label, send response, log lead.

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
    var triggerName  = PROPS.getProperty('TRIGGER_' + t + '_NAME');
    var subject      = PROPS.getProperty('TRIGGER_' + t + '_SUBJECT');
    var bodyTemplate = PROPS.getProperty('TRIGGER_' + t + '_BODY');

    if (!labelName) continue;

    var gmailLabel = GmailApp.getUserLabelByName(labelName);
    if (!gmailLabel) {
      sendLabelAlert_(labelName, triggerName, t, staffEmail, cache);
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
          htmlBody:  body,
          name:      senderName,
          replyTo:   staffEmail
        });

        cache.put(cacheKey, 'sent', cooldown);

        if (leadSheet) {
          leadSheet.appendRow([
            new Date(),
            triggerName,
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
    var name  = PROPS.getProperty('TRIGGER_' + t + '_NAME');
    var ok    = GmailApp.getUserLabelByName(label) !== null;
    lines.push((ok ? '✓ ' : '✗ ') + name + ': "' + label + '"');
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

// Converts a plain-text body to HTML.
// Supports:
//   {{FIRST_NAME}}          → replaced at send time with lead's first name
//   [Link Text](https://…)  → <a href="…">Link Text</a>
//   bare URLs               → <a href="…">…</a>  (prevents raw URL duplication in email clients)
//   newlines                → <br>

function convertBodyToHtml_(text) {
  var links = [];

  // 1. Protect markdown links: [text](url)
  var html = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g, function(_, linkText, url) {
    var idx = links.length;
    links.push('<a href="' + url + '">' + linkText + '</a>');
    return '%%L' + idx + '%%';
  });

  // 2. Convert bare URLs not already protected
  html = html.replace(/(https?:\/\/[^\s<"]+)/g, function(url) {
    // Skip if already a placeholder
    if (/%%L\d+%%/.test(url)) return url;
    var idx = links.length;
    links.push('<a href="' + url + '">' + url + '</a>');
    return '%%L' + idx + '%%';
  });

  // 3. Newlines → <br>
  html = html.replace(/\n/g, '<br>');

  // 4. Restore links
  links.forEach(function(link, idx) {
    html = html.split('%%L' + idx + '%%').join(link);
  });

  return html;
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

// Sends a one-per-hour alert email when a configured label is missing in Gmail.
function sendLabelAlert_(labelName, triggerName, triggerNum, staffEmail, cache) {
  var alertKey = 'label_alert_t' + triggerNum;
  if (cache.get(alertKey)) return;

  var subject = '[Auto Responder Alert] Missing Gmail Label: "' + labelName + '"';
  var body =
    'Your Auto Responder cannot find this Gmail label:<br><br>' +
    '<strong>"' + labelName + '"</strong> — Trigger ' + triggerNum + ': ' + triggerName + '<br><br>' +
    'Emails matching this trigger are <strong>not being processed</strong>.<br><br>' +
    '<strong>To fix:</strong><br>' +
    '1. Open Gmail<br>' +
    '2. Gear icon → See all settings → Labels tab<br>' +
    '3. Create a label named exactly: <strong>' + labelName + '</strong> (case-sensitive)<br>' +
    '4. Gear icon → Filters and Blocked Addresses → Create a new filter<br>' +
    '5. Set your match criteria → Apply the label: ' + labelName + '<br><br>' +
    'Then return to your sheet and click <strong>Auto Responder → Check Labels</strong> to confirm.';

  GmailApp.sendEmail(staffEmail, subject, '', { htmlBody: body });
  cache.put(alertKey, 'alerted', 3600);
}

function ensureLeadSheet_(ss) {
  if (ss.getSheetByName('Lead Log')) return;
  var sheet = ss.insertSheet('Lead Log');
  sheet.appendRow(['Timestamp', 'Trigger Name', 'Gmail Label', 'Lead Email', 'Lead Name', 'Original Subject']);
  sheet.getRange('1:1').setFontWeight('bold').setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 6, 160);
  sheet.setColumnWidth(4, 240);
  sheet.setColumnWidth(6, 280);
}

function deleteTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'autoResponder') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

// Builds the Setup tab with labeled rows and highlighted input cells.
// Defines the exact row layout that SETUP_ROWS references above.
function buildSetupTab_(ss) {
  var existing = ss.getSheetByName('Setup');
  if (existing) ss.deleteSheet(existing);

  var s = ss.insertSheet('Setup', 0);
  s.setColumnWidth(1, 210);
  s.setColumnWidth(2, 380);
  s.setColumnWidth(3, 16);
  s.setColumnWidth(4, 300);

  var YELLOW = '#fffde7';
  var GREEN_DARK  = '#1b5e20';
  var GREEN_MID   = '#c8e6c9';
  var GREEN_LIGHT = '#e8f5e9';
  var BLUE_MID    = '#bbdefb';
  var BLUE_LIGHT  = '#e3f2fd';

  // Row 1: Title
  s.getRange('A1:D1').merge()
    .setValue('AUTO RESPONDER — Setup')
    .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center')
    .setBackground(GREEN_DARK).setFontColor('#ffffff');

  // Row 2: Instructions
  s.getRange('A2:D2').merge()
    .setValue('Fill in column B only.  Use {{FIRST_NAME}} in body for personalization.  Links: [Button Text](https://your-url.com)')
    .setFontStyle('italic').setFontSize(10).setFontColor('#555555').setBackground('#f5f5f5');

  // Row 3: blank separator

  // Row 4: General Settings header
  s.getRange('A4:D4').merge()
    .setValue('GENERAL SETTINGS')
    .setFontWeight('bold').setBackground(GREEN_MID);

  // Rows 5-7: general settings fields
  [
    [SETUP_ROWS.staffEmail,  'Staff Email',           'Alert emails and reply-to address for outgoing responses'],
    [SETUP_ROWS.senderName,  'Sender Display Name',   'Name shown in the recipient\'s inbox  (e.g. "Victory Leasing Team")'],
    [SETUP_ROWS.cooldown,    'Cooldown (minutes)',     'Minimum time between responses to the same email address  (default: 15)'],
  ].forEach(function(item) {
    var row = item[0];
    s.getRange(row, 1).setValue(item[1]);
    s.getRange(row, 2).setBackground(YELLOW);
    s.getRange(row, 4).setValue(item[2]).setFontColor('#888888').setFontStyle('italic').setFontSize(9);
  });
  s.getRange(SETUP_ROWS.cooldown, 2).setValue(15); // default

  // Blank row 8 separator

  // Trigger blocks: rows 9-37
  SETUP_ROWS.triggers.forEach(function(rows, idx) {
    var num      = idx + 1;
    var optional = num > 1 ? '  (optional)' : '';
    var headerBg = num === 1 ? BLUE_MID : BLUE_LIGHT;

    // Header row (e.g. row 9 for trigger 1)
    s.getRange(rows.label - 1, 1, 1, 4).merge()
      .setValue('TRIGGER ' + num + optional)
      .setFontWeight('bold').setBackground(headerBg);

    // Fields
    [
      [rows.label,   'Gmail Label Name',       'Must match exactly in Gmail Settings → Labels  (case-sensitive)'],
      [rows.name,    'Trigger Name',            'Your internal reference  (e.g. "Tour Requests")'],
      [rows.subject, 'Response Subject Line',   'Subject line the lead receives in their inbox'],
      [rows.body,    'Response Body',           'Full email body.  HTML accepted.  {{FIRST_NAME}} and [Link Text](url) supported.'],
    ].forEach(function(field) {
      var row = field[0];
      s.getRange(row, 1).setValue(field[1]);
      s.getRange(row, 2).setBackground(YELLOW);
      s.getRange(row, 4).setValue(field[2]).setFontColor('#888888').setFontStyle('italic').setFontSize(9);
    });

    // Make body row tall for multi-line pasting
    s.setRowHeight(rows.body, 110);
    s.getRange(rows.body, 2).setVerticalAlignment('top').setWrap(true);
  });

  s.setFrozenRows(2);
}
