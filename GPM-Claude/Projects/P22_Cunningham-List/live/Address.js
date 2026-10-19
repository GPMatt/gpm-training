// One address format everywhere: "9 Union Ave NE, Grand Rapids, MI 49503".
// Comma before the city (Matt, 2026-10-19), short suffixes, no stray periods.

// Cities GPM manages in, longest first so "East Grand Rapids" beats "Grand Rapids".
const CITIES = ['East Grand Rapids', 'Grand Rapids', 'Comstock Park', 'Cedar Springs', 'Byron Center',
  'Howard City', 'Grandville', 'Allendale', 'Caledonia', 'Kentwood', 'Rockford', 'Richland', 'Wyoming',
  'Zeeland', 'Holland', 'Walker', 'Morley', 'Lowell', 'Allegan', 'Ada'];
const SUFFIX = { STREET: 'St', AVENUE: 'Ave', DRIVE: 'Dr', COURT: 'Ct', LANE: 'Ln', PLACE: 'Pl', ROAD: 'Rd', PL: 'Pl' };
const CITY_FIX = { 'GRAND RAPDS': 'Grand Rapids' };

function normalizeAddress_(addr) {
  let s = String(addr).replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.*?)[\s,]*\bMI\.?\s+(\d{5})$/i);
  if (!m) return null;
  let head = m[1].replace(/[\s,]+$/, '');
  let city = null;
  const fix = Object.keys(CITY_FIX).find(c => head.toUpperCase().endsWith(' ' + c));
  if (fix) { city = CITY_FIX[fix]; head = head.slice(0, -fix.length); }
  else {
    const c = CITIES.find(c => head.toUpperCase().endsWith(c.toUpperCase()) &&
      /[\s,]$/.test(head.slice(0, head.length - c.length)));
    if (!c) return null;
    city = c; head = head.slice(0, -c.length);
  }
  let street = head.replace(/[\s,-]+$/, '').replace(/\s*,\s*/g, ' ')
    .replace(/\b(ne|nw|se|sw)\b/gi, d => d.toUpperCase())
    .replace(/\b(St|Ave|Dr|Ct|Ln|Pl|Rd)\./gi, '$1')
    .replace(/\b(Street|Avenue|Drive|Court|Lane|Place|Road|PL)\b/g, w => SUFFIX[w.toUpperCase()])
    .replace(/ NW 500$/, ' NW Ste 500');
  return `${street}, ${city}, MI ${m[2]}`;
}

// Run once from the editor: rewrites the Truth tab's Property Address column
// in the format above, then re-syncs the Cunningham sheet. Addresses it can't
// parse (city not in CITIES) are left as typed and logged.
function normalizeTruthAddresses() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.TAB);
  const values = sh.getDataRange().getValues();
  const c = values[0].map(String).indexOf('Property Address');
  if (c < 0) throw new Error('Column "Property Address" not found on ' + CONFIG.TAB);
  let changed = 0;
  const col = values.slice(1).map(r => {
    const was = String(r[c]).trim();
    if (!was) return [r[c]];
    const now = normalizeAddress_(was);
    if (!now) { Logger.log('Left as is (unparsed): ' + was); return [r[c]]; }
    if (now !== was) changed++;
    return [now];
  });
  sh.getRange(2, c + 1, col.length, 1).setValues(col);
  syncPublicSheet();
  Logger.log(changed + ' addresses reformatted; Cunningham sheet synced.');
}
