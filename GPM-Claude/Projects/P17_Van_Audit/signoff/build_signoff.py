"""Build the blank Van Inventory Sign-Off sheet from the 25-bin map (P09 van_bin_map.csv)."""
import csv, html, os
HERE = os.path.dirname(os.path.abspath(__file__))
MAP = os.path.join(HERE, '..', '..', 'P09_Inventory-Guide', 'van_bin_map.csv')
rows = list(csv.DictReader(open(MAP)))
bins = {}
for r in rows:
    bins.setdefault(int(r['Bin']), []).append(r)

body = []
for b in sorted(bins):
    items = sorted(bins[b], key=lambda r: r['Item'].lower())
    body.append(f'<tr class="bin"><td colspan="6">Bin {b}<span>{len(items)} part{"s" if len(items)!=1 else ""}</span></td></tr>')
    for r in items:
        body.append('<tr><td class="sku">%s</td><td>%s</td><td class="box"></td><td class="box"></td><td class="chk"><span></span></td><td class="note"></td></tr>'
                    % (html.escape(r['SKU']), html.escape(r['Item'])))

page = open(os.path.join(HERE, 'template.html')).read()
page = page.replace('{{ROWS}}', '\n'.join(body)).replace('{{COUNT}}', str(len(rows))).replace('{{BINS}}', str(len(bins)))
open(os.path.join(HERE, 'van_signoff_sheet.html'), 'w').write(page)
print('parts', len(rows), 'bins', len(bins))
