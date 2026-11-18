// Builds a local preview of the tech calendar (Tech.html) with a fake google.script.run.
// Run: node app-test/build-tech-preview.js <out.html>   Sample turns go through the real techTurn_ (Describe.js).
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '../app');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const D = {}; vm.createContext(D); vm.runInContext(read('Describe.js'), D);
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const step = (key, label, vendor, start, end, status, extra) => Object.assign({ key, label, vendor, start, end: end || start, days: 1, hours: 8, status }, extra || {});
const turns = [
  { id: 't1', property_label: 'Daylor Dr - B Small', unit_label: '', af_wo_number: '18171-1', move_out_date: day(-3), rent_ready_date: day(4),
    scope: { walk_type: 'Riley walk (Spencer + Riley)', pmi_date: day(-10), pmi_time: '10:00', access: 'Lockbox 1234', buffers: true, notes: 'Dog lived here' },
    steps: [step('tech', 'Tech', 'Riley', day(0), day(1), 'booked', { days: 2, sizeLabel: 'Basic (1 day)' }), step('paint', 'Paint', 'Trevor', day(2), null, 'booked')],
    tech_prep: { done_by: 'Riley', tech_hours: 12, bedrooms: '2', bathrooms: '1', checklist: { kitchen: { 2: { s: 'fix', note: 'Disposal jammed' } } }, parts: [{ qty: 2, item: 'Blind 35x64', store: 'Home Depot' }] } },
  { id: 't2', property_label: 'Oak Valley Apartments', unit_label: '301', move_out_date: day(1), rent_ready_date: day(8),
    scope: { walk_type: "Bill's property (Spencer alone)", pmi_date: day(-5), other_vendors: [{ type: 'HVAC', note: 'Furnace noise' }], pests: 'Roaches' },
    steps: [step('tech', 'Tech', 'Bill', day(2), null, 'open', { hours: 4, time: '13:00' })], tech_prep: null },
  { id: 't3', property_label: '547 Cherry St SE', unit_label: '5A', move_out_date: day(5), rent_ready_date: day(12),
    scope: { walk_type: 'Wesley walk (Spencer + Wesley)', pmi_date: day(1), pmi_time: '09:30' },
    steps: [step('tech', 'Tech', 'Wesley', day(6), null, 'booked')], tech_prep: null },
  { id: 't4', property_label: 'Victory on Leonard', unit_label: '108', move_out_date: day(2), rent_ready_date: day(9),
    scope: { walk_type: 'Cookie cutter (Spencer alone)', pmi_date: day(0) },
    steps: [step('tech', 'Tech', 'Laura C', day(6), null, 'booked')], tech_prep: null }
].map(t => JSON.parse(JSON.stringify(D.techTurn_(t, {}))));
let html = read('Tech.html').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, f) => read(f + '.html'));
const mock = `<script>window.google={script:{run:(function(){var h={s:null,f:null};var o={withSuccessHandler:function(x){h.s=x;return o},withFailureHandler:function(x){h.f=x;return o},
  apiTechBoot:function(){var s=h.s;setTimeout(function(){s({techProperties:null,turns:${JSON.stringify(turns)},at:new Date().toISOString()})},50)}};return o})()}};</script>`;
html = html.replace('<?!= include(', '').replace('<body>', '<body>' + mock);
fs.writeFileSync(process.argv[2] || 'tech-preview.html', html);
console.log('wrote', process.argv[2] || 'tech-preview.html', turns.length, 'turns');
