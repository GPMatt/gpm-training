// Cunningham-facing sheet: a separate spreadsheet with two tabs.
//   Properties  - address + PM, overwritten from the Truth tab by this script
//                 (values only, no IMPORTRANGE). Edit the Truth tab, not this.
//   PM Contacts - typed by hand; the sync never touches it.
// Synced on every Truth edit (installable trigger) and hourly as a backstop.
// If the Truth tab is unreadable the sync throws and the last good copy stays.

const PUBLIC = {
  NAME: 'GPM Property List - Cunningham',
  PROPS_TAB: 'Properties',
  CONTACTS_TAB: 'PM Contacts',
  CONTACT_HEADERS: ['Name', 'Role', 'Email'],
  EXTRA_CONTACTS: [],   // contacts beyond the PMs on Truth (Jason Holmes is already a PM there)
};

// Run once from the editor. Creates the sheet (if not already made), installs
// the edit + hourly triggers, and runs the first sync. Safe to re-run.
function setupPublicSheet() {
  const props = PropertiesService.getScriptProperties();
  let ss = publicSheet_();
  if (!ss) {
    ss = SpreadsheetApp.create(PUBLIC.NAME);
    props.setProperty('PUBLIC_SHEET_ID', ss.getId());
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(exportFolder_());

    const propsTab = ss.getSheets()[0].setName(PUBLIC.PROPS_TAB);
    propsTab.protect().setDescription('Auto-filled from the Truth tab').setWarningOnly(true);

    const contacts = ss.insertSheet(PUBLIC.CONTACTS_TAB);
    const pms = [...new Set(buildList_().map(r => r[1]).filter(Boolean))];
    const names = pms.concat(PUBLIC.EXTRA_CONTACTS.filter(n => !pms.includes(n)));
    const w = PUBLIC.CONTACT_HEADERS.length;
    contacts.getRange(1, 1, 1, w).setValues([PUBLIC.CONTACT_HEADERS]).setFontWeight('bold');
    contacts.getRange(2, 1, names.length, w).setValues(names.map(n => [n].concat(Array(w - 1).fill(''))));
    contacts.setFrozenRows(1);
    Logger.log('Created ' + ss.getUrl());
  }

  ScriptApp.getProjectTriggers()
    .filter(t => ['onTruthEdit', 'syncPublicSheet'].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onTruthEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('syncPublicSheet').timeBased().everyHours(1).create();

  syncPublicSheet();
  Logger.log('Triggers installed. Sheet: ' + ss.getUrl());
}

function onTruthEdit(e) {
  if (e && e.range && e.range.getSheet().getName() !== CONFIG.TAB) return;
  syncPublicSheet();
}

function syncPublicSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;   // another sync is mid-write; it has the latest data
  try {
    const ss = publicSheet_();
    if (!ss) throw new Error('No PUBLIC_SHEET_ID; run setupPublicSheet first');
    const list = buildList_();
    if (!list.length) throw new Error('Truth tab produced 0 properties; leaving the Cunningham sheet as is');

    const sh = ss.getSheetByName(PUBLIC.PROPS_TAB);
    const stamp = Utilities.formatDate(new Date(), 'America/Detroit', 'yyyy-MM-dd h:mm a');
    sh.clearContents();
    sh.getRange(1, 1, 1, 2).setValues([['Property Address', 'Property Manager']]).setFontWeight('bold');
    sh.getRange(2, 1, list.length, 2).setValues(list);
    sh.getRange('D1').setValue('Updated automatically from Green Property Management. Last updated ' + stamp);
    sh.setFrozenRows(1);
  } finally {
    lock.releaseLock();
  }
}

function publicSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('PUBLIC_SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : null;
}

// [{name, role, email}] from the PM Contacts tab. Columns are found by header,
// so reordering or adding columns on the tab doesn't shift the output.
function readContacts_() {
  const ss = publicSheet_();
  if (!ss) return [];
  const values = ss.getSheetByName(PUBLIC.CONTACTS_TAB).getDataRange().getValues();
  const h = values[0].map(v => String(v).trim().toLowerCase());
  const get = (r, name) => { const i = h.indexOf(name); return i < 0 ? '' : String(r[i]).trim(); };
  return values.slice(1)
    .filter(r => get(r, 'name'))
    .map(r => ({ name: get(r, 'name'), role: get(r, 'role'), email: get(r, 'email') }));
}
