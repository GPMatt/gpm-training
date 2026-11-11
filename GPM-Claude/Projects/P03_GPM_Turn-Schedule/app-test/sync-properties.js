// Rebuilds app/Properties.html from a CSV export of the "Property Manager & Tech Assignments" sheet
// (Drive 1dTtRD-CF3FZj8TKDzDgG5ZkaHGreUrIoiCedRRLXzEw, columns: Property Name, Property Address, Units, PM, Tech, Property Type, Owner).
// Run: node app-test/sync-properties.js <export.csv>   then clasp push. Only name, street, type and unit count are kept.
const fs = require('fs'), path = require('path');
function parse(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const rows = parse(fs.readFileSync(process.argv[2], 'utf8'));
const h = rows.shift().map(s => s.trim());
const col = n => h.indexOf(n);
const out = rows.filter(r => r[col('Property Address')]).map(r => [
  r[col('Property Address')].split(',')[0].trim(), r[col('Property Name')].trim(), r[col('Property Type')].trim(), Number(r[col('Units')]) || null]);
const js = '<script>\n// From the "Property Manager & Tech Assignments" sheet, synced ' + new Date().toISOString().slice(0, 10) +
  ' by app-test/sync-properties.js. [street address, property name, type, units]. Turn titles use the name.\nvar PROPERTY_DIRECTORY = ' +
  JSON.stringify(out).replace(/\],\[/g, '],\n  [') + ';\n</script>\n';
fs.writeFileSync(path.join(__dirname, '../app/Properties.html'), js);
console.log(out.length + ' properties written');
