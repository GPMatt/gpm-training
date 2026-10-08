// P15 Client Onboarding — utility set-up handoff
//
// When an owner submits the Jotform intake form, this hands Alaina what she
// needs to file the three utility forms by hand (Consumers consent, DTE ATS,
// Grand Rapids water agreement). It does NOT fill the PDFs and does not
// collect a signature yet.
//
// Flow: Jotform webhook -> doPost -> fetch the submission from Jotform's API
// -> one private Drive folder per submission (details doc, photo ID, rent
// roll) -> email a link to NOTIFY_EMAIL.
//
// Security choices, on purpose:
// - The webhook body is never trusted. Only the submission ID is taken from
//   it; the answers come from Jotform's API using the stored key, and the
//   submission must belong to JOTFORM_FORM_ID. A forged POST can at worst
//   make the script re-read a real submission it has already handled.
// - The email carries no SSN / EIN and no ID attachment, only a folder link.
// - The SSN / EIN is written once, into the details doc, inside a folder
//   that is private until shareParentFolder() is run.
//
// Script Properties (Project Settings -> Script Properties):
//   JOTFORM_API_KEY   required. A Jotform API key that can read submissions.
//   JOTFORM_FORM_ID   optional, defaults to the v2 intake form.
//   JOTFORM_API_BASE  optional, defaults to https://api.jotform.com
//   WEBHOOK_TOKEN     written by setup(). The webhook URL must end
//                     ?token=<it>, or the POST is refused.
//   NOTIFY_EMAIL      who gets the handoff email. Defaults to ADMIN_EMAIL so
//                     nothing reaches Alaina until this is set on purpose.
//   ADMIN_EMAIL       who hears about failures. Defaults to matt@.
//   SHARE_WITH        comma-separated viewers for shareParentFolder().
//   PARENT_FOLDER_ID  written by setup().
//   TEST_SUBMISSION_ID  optional. The two test functions at the bottom use
//                     it, or the form's newest submission when it is unset.
//
// First run: add JOTFORM_API_KEY, run setup(), then paste the web app's
// /exec URL plus the ?token=... that setup() logs into the form's
// Settings -> Integrations -> WebHooks. After any code change the web app
// only updates on `clasp deploy -i <deploymentId>`, not on `clasp push`.

const DEFAULT_FORM_ID = '262804649990066';
const DEFAULT_API_BASE = 'https://api.jotform.com';
const DEFAULT_ADMIN_EMAIL = 'matt@greenpropertymgt.com';
const DEFAULT_SHARE_WITH = [
  'alaina@greenpropertymgt.com',
  'laura@greenpropertymgt.com',
  'matt@greenpropertymgt.com',
  'automation@greenpropertymgt.com'
].join(',');
const PARENT_FOLDER_NAME = 'P15 Utility Set-Up Handoffs';

// Which form questions feed the handoff, matched on the question's label
// because the labels are all we have a record of. If a label is reworded on
// the form, the field shows up under "could not find" in the admin email
// rather than silently going blank. `required` only controls that warning.
const FIELDS = [
  { key: 'ownerName',       label: 'Owner full legal name',      match: /^full legal name/i, required: true },
  { key: 'signingAs',       label: 'Signing as',                 match: /individual or (a )?business entity/i },
  { key: 'entityName',      label: 'Entity legal name',          match: /^entity legal name/i },
  { key: 'ssn',             label: 'Social Security Number',     match: /^social security/i },
  { key: 'ein',             label: 'EIN / Tax ID',               match: /^(ein|tax id|employer identification)/i },
  { key: 'phone',           label: 'Owner phone',                match: /^phone number/i, required: true },
  { key: 'email',           label: 'Owner email',                match: /^e-?mail address/i, required: true },
  { key: 'ownerMailing',    label: 'Owner mailing address',      match: /^mailing address/i },
  { key: 'contactPref',     label: 'Contact method, first choice',  match: /first choice for how we contact/i },
  { key: 'contactPref2',    label: 'Contact method, second choice', match: /second choice for how we contact/i },
  { key: 'propertyAddress', label: 'Property (service) address', match: /^property address/i, required: true },
  { key: 'unitCount',       label: 'Number of units',            match: /^number of units/i, required: true },
  { key: 'occupied',        label: 'Tenants living there now',   match: /tenants currently living/i },
  { key: 'priorMgmt',       label: 'Managed before GPM by',      match: /managed before/i },
  { key: 'closingDate',     label: 'Closing date',               match: /^closing date/i },
  { key: 'subsidized',      label: 'Any units subsidized',       match: /^are any units subsidized/i },
  { key: 'subsidizedCount', label: 'Subsidized unit count',      match: /^how many units are subsidized/i },
  { key: 'subsidyProgram',  label: 'Subsidy program / agency',   match: /^subsidy program/i },
  { key: 'taxExempt',       label: 'Property tax exempt',        match: /tax exempt/i },
  { key: 'whoPays',         label: 'Who pays each utility',      match: /^who pays for each/i },
  { key: 'unitList',        label: 'Unit list (owner-entered)',  match: /^unit list/i },
  { key: 'tenantList',      label: 'Tenant list (owner-entered)', match: /^tenant list/i }
];

const UPLOADS = [
  { key: 'photoId',  label: 'Photo ID',  match: /photo id/i, required: true },
  { key: 'rentRoll', label: 'Rent roll', match: /rent roll/i }
];

// ---------------------------------------------------------------- entry points

function doPost(e) {
  const params = (e && e.parameter) || {};
  const id = String(params.submissionID || '');
  // Stray traffic to a public URL is expected; refuse it without emailing anyone.
  const token = prop_('WEBHOOK_TOKEN');
  if (!token || params.token !== token) {
    console.warn('Refused a POST with a missing or wrong token.');
    return ContentService.createTextOutput('ok');
  }
  try {
    if (!/^\d+$/.test(id)) throw new Error('Webhook had no usable submissionID.');
    handleSubmission_(id);
  } catch (err) {
    notifyAdmin_(id, err);
  }
  return ContentService.createTextOutput('ok');
}

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!prop_('JOTFORM_API_KEY')) throw new Error('Add the JOTFORM_API_KEY script property first.');
  if (!prop_('PARENT_FOLDER_ID')) {
    const folder = DriveApp.createFolder(PARENT_FOLDER_NAME);
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    props.setProperty('PARENT_FOLDER_ID', folder.getId());
  }
  if (!prop_('WEBHOOK_TOKEN')) {
    props.setProperty('WEBHOOK_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('Parent folder: ' + DriveApp.getFolderById(prop_('PARENT_FOLDER_ID')).getUrl());
  Logger.log('Add this to the end of the web app /exec URL for the Jotform webhook: ?token=' + prop_('WEBHOOK_TOKEN'));
}

// Go-live step, kept out of setup() because Drive emails everyone it adds.
function shareParentFolder() {
  const folder = DriveApp.getFolderById(requireProp_('PARENT_FOLDER_ID'));
  (prop_('SHARE_WITH') || DEFAULT_SHARE_WITH).split(',')
    .map(s => s.trim()).filter(Boolean)
    .forEach(addr => folder.addViewer(addr));
}

// ---------------------------------------------------------------- core

function handleSubmission_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let folder = null;
  try {
    const props = PropertiesService.getScriptProperties();
    const doneKey = 'done_' + id;
    if (props.getProperty(doneKey)) return;

    const submission = fetchSubmission_(id);
    const formId = prop_('JOTFORM_FORM_ID') || DEFAULT_FORM_ID;
    if (String(submission.form_id) !== formId) {
      throw new Error('Submission belongs to form ' + submission.form_id + ', not ' + formId + '.');
    }

    const data = extract_(submission);
    const title = folderTitle_(data, id);
    folder = DriveApp.getFolderById(requireProp_('PARENT_FOLDER_ID')).createFolder(title);

    const files = copyUploads_(data, folder);
    const notes = filingNotes_(data, files);
    const doc = writeDetailsDoc_(data, notes, files, folder, id);
    sendHandoff_(data, notes, files, folder, id);

    props.setProperty(doneKey, folder.getId());
    const problems = data.missing.map(m => 'Could not find on the form: ' + m)
      .concat(files.failed.map(f => 'Could not copy from Jotform: ' + f));
    if (problems.length) notifyAdmin_(id, new Error(problems.join('\n')), folder.getUrl());
    return { folderUrl: folder.getUrl(), docUrl: doc.getUrl(), problems: problems };
  } catch (err) {
    if (folder) folder.setTrashed(true);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function fetchSubmission_(id) {
  const base = (prop_('JOTFORM_API_BASE') || DEFAULT_API_BASE).replace(/\/$/, '');
  const resp = UrlFetchApp.fetch(base + '/submission/' + id, {
    headers: { APIKEY: requireProp_('JOTFORM_API_KEY') },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Jotform API returned ' + resp.getResponseCode() + ' for submission ' + id + '.');
  }
  const body = JSON.parse(resp.getContentText());
  if (!body.content || !body.content.answers) throw new Error('Jotform API returned no answers for ' + id + '.');
  return body.content;
}

// Turns the raw submission into { values, uploads, missing }.
function extract_(submission) {
  const answers = Object.keys(submission.answers)
    .map(qid => submission.answers[qid])
    .filter(a => a && a.text)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const labelOf = a => stripHtml_(a.text).trim();

  const values = {};
  const uploads = {};
  const missing = [];

  FIELDS.forEach(f => {
    const hit = answers.filter(a => a.type !== 'control_fileupload' && f.match.test(labelOf(a)));
    values[f.key] = hit.map(answerText_).filter(Boolean)[0] || '';
    if (!hit.length && f.required) missing.push(f.label);
  });

  UPLOADS.forEach(u => {
    const hit = answers.filter(a => a.type === 'control_fileupload' && u.match.test(labelOf(a)));
    uploads[u.key] = hit.reduce((urls, a) => urls.concat(fileUrls_(a.answer)), []);
    if (!hit.length && u.required) missing.push(u.label + ' upload');
  });

  return { values: values, uploads: uploads, missing: missing, createdAt: submission.created_at || '' };
}

function answerText_(a) {
  const v = a.answer;
  if (v === undefined || v === null || v === '') return '';
  if (a.type === 'control_address' && typeof v === 'object') {
    const street = [v.addr_line1, v.addr_line2].filter(Boolean).join(' ');
    const cityLine = [v.city, [v.state, v.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [street, cityLine].filter(Boolean).join(', ');
  }
  if (a.type === 'control_fullname' && typeof v === 'object') {
    return [v.prefix, v.first, v.middle, v.last, v.suffix].filter(Boolean).join(' ');
  }
  if (a.type === 'control_phone' && typeof v === 'object') {
    return v.full || [v.area, v.phone].filter(Boolean).join('-');
  }
  if (a.type === 'control_datetime' && typeof v === 'object' && v.month && v.day && v.year) {
    return v.month + '/' + v.day + '/' + v.year;
  }
  if (typeof v === 'string' || typeof v === 'number') return flatten_(v);
  if (a.type === 'control_matrix') return matrixText_(a);
  if (typeof a.prettyFormat === 'string' && a.prettyFormat.trim()) {
    return stripHtml_(a.prettyFormat).trim();
  }
  return flatten_(v);
}

// A grid answer can arrive keyed by row name, or as a bare list of choices
// in row order. A bare list is useless without the row names, so pair it
// with them, or fall back to Jotform's own rendering of the grid.
function matrixText_(a) {
  const v = a.answer;
  if (!Array.isArray(v)) return flatten_(v);
  const rows = String(a.mrows || '').split('|').map(r => r.trim()).filter(Boolean);
  if (rows.length === v.length) {
    return rows.map((r, i) => r + ': ' + (flatten_(v[i]) || 'not answered')).join('\n');
  }
  if (typeof a.prettyFormat === 'string' && a.prettyFormat.trim()) {
    return stripHtml_(a.prettyFormat).split('\n').map(l => l.trim().replace(/\s{2,}/g, ': ').replace(/: $/, ''))
      .filter(Boolean).join('\n');
  }
  return flatten_(v) + '\n(Row names did not come through; order on the form is gas, electric, water, trash, lawn care, snow removal.)';
}

function flatten_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^[\[{]/.test(s)) {
      try { return flatten_(JSON.parse(s)); } catch (e) { /* plain text that happens to start with a bracket */ }
    }
    return s;
  }
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) {
    const rowSep = v.some(x => x && typeof x === 'object') ? '\n' : ', ';
    return v.map(x => (x && typeof x === 'object' && !Array.isArray(x))
      ? Object.keys(x).map(k => k + ': ' + flatten_(x[k])).filter(s => !/: $/.test(s)).join(', ')
      : flatten_(x)).filter(Boolean).join(rowSep);
  }
  return Object.keys(v).map(k => {
    const inner = flatten_(v[k]);
    return inner ? k + ': ' + inner : '';
  }).filter(Boolean).join('\n');
}

function fileUrls_(v) {
  if (!v) return [];
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\[/.test(s)) {
      try { return fileUrls_(JSON.parse(s)); } catch (e) { return []; }
    }
    return /^https?:\/\//.test(s) ? [s] : [];
  }
  if (Array.isArray(v)) return v.reduce((out, x) => out.concat(fileUrls_(x)), []);
  return [];
}

function stripHtml_(s) {
  return String(s || '')
    .replace(/<\s*br\s*\/?>|<\/(p|tr|div|li)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n');
}

function folderTitle_(data, id) {
  const v = data.values;
  const who = v.entityName || v.ownerName || 'Unknown owner';
  const where = (v.propertyAddress || 'Unknown address').split(',')[0];
  return (where + ' - ' + who + ' (' + id + ')').replace(/[\/\\:*?"<>|\n\r]+/g, ' ').slice(0, 150);
}

// The things Alaina has to know that the form does not settle for her.
function filingNotes_(data, files) {
  const v = data.values;
  const notes = [];

  const count = v.unitCount || 'not given';
  notes.push('Unit count is ' + count + '. This does not confirm the unit names or numbers at the property'
    + (v.unitList || v.tenantList ? '; the owner-entered unit / tenant list in the details doc may help.' : '.'));

  if (/^no\b/i.test(v.occupied)) {
    notes.push('Owner reports no tenants living there, so there is no in-place date.');
  } else if (!files.copied.rentRoll.length && !v.tenantList) {
    notes.push('In-place date not obtained: no rent roll was provided.'
      + (v.closingDate ? ' Closing date on the form is ' + v.closingDate + '.' : ''));
  } else {
    notes.push('In-place date: take it from the '
      + (files.copied.rentRoll.length ? 'rent roll in this folder.' : 'tenant list in the details doc.'));
  }

  notes.push('Driver\'s license number was not collected. Use the photo ID in this folder.');
  notes.push('Owner signature was not collected on the form. It still has to be obtained for all three utility forms.');
  notes.push('The signed management agreement comes from DocuSign and is not in this folder.');
  return notes;
}

function copyUploads_(data, folder) {
  const who = (data.values.entityName || data.values.ownerName || 'owner').replace(/[\/\\:*?"<>|]+/g, ' ');
  const copied = {};
  const failed = [];
  UPLOADS.forEach(u => {
    copied[u.key] = [];
    data.uploads[u.key].forEach((url, i) => {
      try {
        const blob = fetchUpload_(url);
        const ext = (decodeURIComponent(url.split('?')[0].split('/').pop()).match(/\.[A-Za-z0-9]{2,5}$/) || [''])[0];
        const name = u.label + ' - ' + who + (data.uploads[u.key].length > 1 ? ' ' + (i + 1) : '') + ext;
        copied[u.key].push(folder.createFile(blob.setName(name)));
      } catch (err) {
        failed.push(u.label + ' (' + err.message + ')');
      }
    });
  });
  return { copied: copied, failed: failed };
}

// Uploads can be login-protected on the Jotform side; the API key opens
// them, as a header on some setups and as a query parameter on others.
function fetchUpload_(url) {
  const key = requireProp_('JOTFORM_API_KEY');
  const attempts = [
    () => UrlFetchApp.fetch(url, { headers: { APIKEY: key }, muteHttpExceptions: true }),
    () => UrlFetchApp.fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'apiKey=' + encodeURIComponent(key),
      { muteHttpExceptions: true })
  ];
  let last = '';
  for (let i = 0; i < attempts.length; i++) {
    const resp = attempts[i]();
    const type = String(resp.getHeaders()['Content-Type'] || '');
    if (resp.getResponseCode() === 200 && !/text\/html/i.test(type)) return resp.getBlob();
    last = 'HTTP ' + resp.getResponseCode() + ' ' + type;
  }
  throw new Error(last);
}

function writeDetailsDoc_(data, notes, files, folder, id) {
  const v = data.values;
  const doc = DocumentApp.create('Utility set-up details - ' + (v.propertyAddress || id).split(',')[0]);
  const body = doc.getBody();
  const section = (heading, rows) => {
    body.appendParagraph(heading).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendTable(rows.map(r => [r[0], r[1] || 'Not provided']));
  };

  body.appendParagraph('Utility set-up details').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('From Jotform submission ' + id + (data.createdAt ? ', received ' + data.createdAt : '')
    + '. Contains a Social Security or tax ID number: keep it in this folder.');

  body.appendParagraph('Read before filing').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  notes.forEach(n => body.appendListItem(n));

  section('Owner', fieldRows_(v, ['ownerName', 'signingAs', 'entityName', 'ssn', 'ein', 'phone', 'email',
    'ownerMailing', 'contactPref', 'contactPref2']));
  section('Property', fieldRows_(v, ['propertyAddress', 'unitCount', 'occupied', 'priorMgmt', 'closingDate',
    'subsidized', 'subsidizedCount', 'subsidyProgram', 'taxExempt']));
  section('Utilities and units', fieldRows_(v, ['whoPays', 'unitList', 'tenantList']));
  section('Files in this folder', UPLOADS.map(u => [u.label,
    files.copied[u.key].map(f => f.getName()).join('\n') || 'None provided']));

  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  return doc;
}

function fieldRows_(values, keys) {
  return keys.map(k => [FIELDS.filter(f => f.key === k)[0].label, values[k]]);
}

function sendHandoff_(data, notes, files, folder, id) {
  const v = data.values;
  const to = prop_('NOTIFY_EMAIL') || prop_('ADMIN_EMAIL') || DEFAULT_ADMIN_EMAIL;
  const address = v.propertyAddress || 'address not given';
  const rows = [
    ['Owner', v.entityName ? v.entityName + ' (' + v.ownerName + ')' : v.ownerName],
    ['Property', address],
    ['Units', v.unitCount],
    ['Who pays', v.whoPays],
    ['Photo ID', files.copied.photoId.length ? 'In the folder' : 'NOT in the folder'],
    ['Rent roll', files.copied.rentRoll.length ? 'In the folder' : 'None provided']
  ];
  const html = '<p>A new owner intake form came in. Everything needed for the Consumers, DTE and water forms is '
    + 'in this folder:</p><p><a href="' + folder.getUrl() + '">' + esc_(folder.getName()) + '</a></p>'
    + '<table cellpadding="4" style="border-collapse:collapse">'
    + rows.map(r => '<tr><td style="vertical-align:top"><b>' + esc_(r[0]) + '</b></td><td>'
      + esc_(r[1] || 'Not provided').replace(/\n/g, '<br>') + '</td></tr>').join('')
    + '</table><p><b>Read before filing</b></p><ul>'
    + notes.map(n => '<li>' + esc_(n) + '</li>').join('') + '</ul>'
    + '<p>The Social Security / tax ID number is in the details doc in the folder, not in this email.</p>';
  MailApp.sendEmail({
    to: to,
    subject: 'New owner intake: ' + address.split(',')[0] + ' - utility set-up',
    htmlBody: html
  });
}

function notifyAdmin_(id, err, folderUrl) {
  try {
    MailApp.sendEmail({
      to: prop_('ADMIN_EMAIL') || DEFAULT_ADMIN_EMAIL,
      subject: 'P15 utility handoff ' + (folderUrl ? 'needs a look' : 'FAILED') + ' (submission ' + (id || 'unknown') + ')',
      body: (folderUrl ? 'The handoff was sent, with gaps:\n\n' : 'No handoff was sent.\n\n')
        + (err && err.message ? err.message : String(err))
        + (folderUrl ? '\n\nFolder: ' + folderUrl : '')
    });
  } catch (mailErr) {
    console.error('Could not email admin: ' + mailErr + ' / original: ' + err);
  }
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function requireProp_(name) {
  const value = prop_(name);
  if (!value) throw new Error('Missing script property ' + name + '.');
  return value;
}

// ---------------------------------------------------------------- testing

function testSubmissionId_() {
  const fixed = prop_('TEST_SUBMISSION_ID');
  if (fixed) return fixed;
  const base = (prop_('JOTFORM_API_BASE') || DEFAULT_API_BASE).replace(/\/$/, '');
  const formId = prop_('JOTFORM_FORM_ID') || DEFAULT_FORM_ID;
  const resp = UrlFetchApp.fetch(base + '/form/' + formId + '/submissions?limit=1&orderby=created_at', {
    headers: { APIKEY: requireProp_('JOTFORM_API_KEY') },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Jotform API returned ' + resp.getResponseCode() + ' listing submissions.');
  }
  const newest = (JSON.parse(resp.getContentText()).content || [])[0];
  if (!newest) throw new Error('The form has no submissions to test with.');
  Logger.log('Using the newest submission: ' + newest.id + ' (' + newest.created_at + ')');
  return String(newest.id);
}

// Runs the whole handoff for the test submission, even if it ran before.
function processTestSubmission() {
  const id = testSubmissionId_();
  PropertiesService.getScriptProperties().deleteProperty('done_' + id);
  Logger.log(JSON.stringify(handleSubmission_(id), null, 2));
}

// Dry run: logs which questions matched and which did not. Writes nothing,
// sends nothing, and logs labels only, never answers.
function inspectTestSubmission() {
  const submission = fetchSubmission_(testSubmissionId_());
  const data = extract_(submission);
  FIELDS.forEach(f => Logger.log((data.values[f.key] ? 'answered  ' : 'empty     ') + f.label));
  UPLOADS.forEach(u => Logger.log(data.uploads[u.key].length + ' file(s)  ' + u.label));
  Logger.log('Could not find on the form: ' + (data.missing.join(', ') || 'nothing'));
  Object.keys(submission.answers).map(qid => submission.answers[qid])
    .filter(a => a && a.type === 'control_matrix')
    .forEach(a => Logger.log('Grid "' + stripHtml_(a.text).trim() + '": answer is '
      + (Array.isArray(a.answer) ? 'a list' : typeof a.answer) + ', row names ' + (a.mrows ? 'present' : 'absent')
      + ', Jotform rendering ' + (a.prettyFormat ? 'present' : 'absent') + '. Reads as:\n' + answerText_(a)));
  Logger.log('All question labels on this submission:');
  Object.keys(submission.answers).forEach(qid => {
    const a = submission.answers[qid];
    if (a && a.text) Logger.log('  ' + a.type + '  ' + stripHtml_(a.text).trim());
  });
}
