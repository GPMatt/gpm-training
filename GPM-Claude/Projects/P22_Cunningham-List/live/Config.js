// Cunningham property list: weekly export + Supabase discrepancy report.
// Bound to the "Property Manager & Tech Assignments" sheet.

const CONFIG = {
  TAB: 'Truth',

  // Leave blank until Blake confirms the address. While blank, the weekly
  // list goes to REPORT_TO only (dry run) and nothing reaches Cunningham.
  CUNNINGHAM_EMAIL: 'support@newtownanswering.com',

  REPORT_TO: 'matt@greenpropertymgt.com',

  // Named in the Cunningham email as the person to contact; replies go here too.
  CONTACT_NAME: 'Blake Roush',
  CONTACT_EMAIL: 'blake@greenpropertymgt.com',
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

  // Other street addresses that are part of a property on the Truth tab
  // (from the AppFolio unit directory, 2026-10-19). Tenants call in with these,
  // so Cunningham gets one row each, with the PM of the Truth row the
  // [address, belongs to] pair points at. If that Truth row is gone, the
  // extras for it are dropped. Prairie Winds homes are left off on purpose (Matt).
  EXTRA_ADDRESSES: [
    ['O-682 Lake Michigan Dr NW, Grand Rapids, MI 49534', 'O-680 Lake Michigan'],
    ['O-684 Lake Michigan Dr NW, Grand Rapids, MI 49534', 'O-680 Lake Michigan'],
    ['O-686 Lake Michigan Dr NW, Grand Rapids, MI 49534', 'O-680 Lake Michigan'],
    ['413 College Ave SE, Grand Rapids, MI 49503', '411-413 College'],   // matches the Truth spelling
    ['32 S Main St NE, Cedar Springs, MI 49319', '30 S Main'],
    ['3003 Woodcliff Ln SE, Grand Rapids, MI 49546', '3001 Woodcliff'],
    ['1015 Fremont Ave NW, Grand Rapids, MI 49504', '1013 Fremont'],
    ['18 Packard Ave SE, Grand Rapids, MI 49503', '16 Packard'],
    ['2083 Shangrai La Dr SE, Grand Rapids, MI 49508', '2081 Shangrai'],
    ['2131 Leonard St NE, Grand Rapids, MI 49505', '2121 Leonard'],
    ['30 Gold Ave SW, Grand Rapids, MI 49504', '28 Gold'],
    ['536 56th St SE, Kentwood, MI 49508', '538 56th'],
    ['719 5th St NW, Grand Rapids, MI 49504', '717 5th'],
    ['813 Park St SW, Grand Rapids, MI 49504', '811 Park'],
    ['919 Park St SW, Grand Rapids, MI 49504', '917 Park'],
    ['453 Knapp St NE, Grand Rapids, MI 49505', '445 Knapp'],          // Cardinal Point
    ['1958 Crestmoor Ct SE, Kentwood, MI 49508', '1956 Crestmoor'],
    ['3716 Groveland Ave SW, Wyoming, MI 49519', '3718 Groveland'],
    ['415 Sheldon Ave SE, Grand Rapids, MI 49503', '90 Wealthy'],       // Wealthy and Sheldon
    // Christie: needs its own Truth row (5924 Christie) before these appear.
    ['5926 Christie Ave SE, Kentwood, MI 49508', '5924 Christie'],
    ['5928 Christie Ave SE, Kentwood, MI 49508', '5924 Christie'],
    ['5930 Christie Ave SE, Kentwood, MI 49508', '5924 Christie'],
    ['5932 Christie Ave SE, Kentwood, MI 49508', '5924 Christie'],
    ['5934 Christie Ave SE, Kentwood, MI 49508', '5924 Christie'],
    // Eaglebrook Apartments buildings
    ['5957 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    ['5969 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    ['5979 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    ['5993 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    ['5999 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    ['6009 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    ['6025 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    ['6029 8th Ave SW, Grandville, MI 49418', '5943 8th'],
    // Woods Edge Apartments buildings
    ['2704 Clyde Park Ave SW, Wyoming, MI 49509', '2700 Clyde'],
    ['2720 Clyde Park Ave SW, Wyoming, MI 49509', '2700 Clyde'],
    ['2657 McKee Ave SW, Wyoming, MI 49509', '2700 Clyde'],
    ['2715 McKee Ave SW, Wyoming, MI 49509', '2700 Clyde'],
    ['2721 McKee Ave SW, Wyoming, MI 49509', '2700 Clyde'],
  ],
};

// Script Properties needed: SUPABASE_URL, SUPABASE_SERVICE_KEY
