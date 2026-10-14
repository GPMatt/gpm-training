// Cunningham property list: weekly export + Supabase discrepancy report.
// Bound to the "Property Manager & Tech Assignments" sheet.

const CONFIG = {
  TAB: 'Truth',

  // Leave blank until Blake confirms the address. While blank, the weekly
  // list goes to REPORT_TO only (dry run) and nothing reaches Cunningham.
  CUNNINGHAM_EMAIL: '',

  REPORT_TO: 'matt@greenpropertymgt.com',
  EXPORT_FOLDER_NAME: 'Cunningham Property Lists',

  // Thursday, 7am Detroit time (the warehouse pipeline ingests Wednesday).
  TRIGGER_DAY: ScriptApp.WeekDay.THURSDAY,
  TRIGGER_HOUR: 7,

  // Properties still open in AppFolio (so still active in Supabase) that GPM
  // no longer manages. Matt confirmed 2026-10-14. Matched on house number +
  // street name, so "884 Orlando SE" and "884 Orlando Ave SE" both hit.
  NOT_MANAGED: [
    '825 Orlando', '852 Orlando', '853 Orlando', '872 Orlando',
    '875 Orlando', '883 Orlando', '884 Orlando',
    '1205 Fulton', '1050 Michigan', '1121 Michigan', '1234 Michigan',
    '4300 Remembrance', '558 Water',
    '1787 Grand',          // "Green Miscellaneous" ledger catch-all
    '3810 Algansee', '868 Kirk', '874 Kirk', '1107 Lake', '1357 Eventide'
  ],
};

// Script Properties needed: SUPABASE_URL, SUPABASE_SERVICE_KEY
