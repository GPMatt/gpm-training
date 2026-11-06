// Run: node app-test/engine.test.js  (from the P03 folder)
const fs = require('fs'), path = require('path'), assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, '../app', f), 'utf8').replace(/<\/?script>/g, '');
const ctx = {};
new Function('ctx', load('Config.html') + load('Engine.html') + ';ctx.E=Engine;ctx.D=DEFAULT_SETTINGS;')(ctx);
const { E, D } = ctx;
const cat = D.catalog;
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('fed holidays', () => {
  assert.equal(E.holidayName('2026-11-26'), 'Thanksgiving');
  assert.equal(E.holidayName('2026-11-11'), 'Veterans Day');
  assert.equal(E.holidayName('2026-12-25'), 'Christmas');
  assert.equal(E.holidayName('2027-06-18'), '');           // Juneteenth 2027 is a Saturday: not observed Friday
  assert.equal(E.holidayName('2027-07-05'), 'Independence Day'); // Sunday -> Monday
  assert.equal(E.holidayName('2026-05-25'), 'Memorial Day');
  assert.equal(E.isBiz('2026-11-26'), false);
  assert.equal(E.isBiz('2026-11-28'), false); // Saturday
});

t('first build day = next business day after move-out', () => {
  assert.equal(E.nextBiz('2026-11-20'), '2026-11-23'); // Fri -> Mon
  assert.equal(E.nextBiz('2026-11-25'), '2026-11-27'); // Wed -> Fri (skips Thanksgiving)
});

function scope(tr) { return { trades: tr }; }

t('full chain: cure, holiday, appliances+tech share a day', () => {
  const steps = E.stepsFromScope(scope({ tub: { size: 'resurface' }, flooring: { size: 'lvp' }, drywall: { size: 'small' },
    appliances: { size: 'replace' }, tech: { size: 'basic' }, paint: { size: 'full' }, clean: { size: 'std' }, carpetclean: { size: 'std' } }), cat, 0);
  const r = E.layout(steps, '2026-11-20', cat);
  const by = Object.fromEntries(r.steps.map(s => [s.key, s.start + '..' + s.end]));
  assert.equal(by.tub, '2026-11-23..2026-11-23');
  assert.equal(by.flooring, '2026-11-25..2026-11-25');           // 11/24 = cure day
  assert.equal(by.drywall, '2026-11-27..2026-11-30');            // skips Thanksgiving + weekend
  assert.equal(by.appliances, '2026-12-01..2026-12-01');
  assert.equal(by.tech, '2026-12-01..2026-12-01');               // same day as appliances
  assert.equal(by.paint, '2026-12-02..2026-12-02');
  assert.equal(by.clean, '2026-12-03..2026-12-03');
  assert.equal(by.carpetclean, '2026-12-04..2026-12-04');
  assert.equal(r.rentReady, '2026-12-04');
  assert.deepEqual(r.warnings, []);
});

t('skipped steps pull forward', () => {
  const steps = E.stepsFromScope(scope({ tech: { size: 'basic' }, paint: { size: 'full' }, clean: { size: 'std' } }), cat, 0);
  const r = E.layout(steps, '2026-11-20', cat);
  assert.equal(r.steps[0].start, '2026-11-23');
  assert.equal(r.rentReady, '2026-11-25');
});

t('tech hours from tech prep set length', () => {
  const steps = E.stepsFromScope(scope({ tech: { size: 'basic' }, paint: { size: 'full' } }), cat, 14);
  const r = E.layout(steps, '2026-11-20', cat);
  assert.equal(r.steps[0].days, 2);
  assert.equal(r.steps[1].start, '2026-11-25');
});

t('pinned date: later steps flow after it; early pin warns', () => {
  const steps = E.stepsFromScope(scope({ tech: { size: 'basic' }, paint: { size: 'full' }, clean: { size: 'std' } }), cat, 0);
  steps[1].start = '2026-11-30'; steps[1].pinned = true; // paint pushed out
  let r = E.layout(steps, '2026-11-20', cat);
  assert.equal(r.steps[2].start, '2026-12-01');
  assert.equal(r.warnings.length, 0);
  steps[1].start = '2026-11-23'; // paint same day as tech
  r = E.layout(steps, '2026-11-20', cat);
  assert.ok(r.warnings.some(w => /starts before Tech/.test(w)));
  assert.ok(r.warnings.some(w => /overlap/.test(w)));
});

t('recommended clears pins + restores order', () => {
  const steps = E.stepsFromScope(scope({ tech: { size: 'basic' }, paint: { size: 'full' } }), cat, 0);
  steps.reverse(); steps[0].pinned = true; steps[0].start = '2026-12-10';
  let r = E.layout(steps, '2026-11-20', cat);
  assert.ok(r.warnings.some(w => /Order changed/.test(w)));
  r = E.recommended(steps, '2026-11-20', cat);
  assert.equal(r.steps[0].key, 'tech');
  assert.equal(r.rentReady, '2026-11-24');
  assert.deepEqual(r.warnings, []);
});

t('tub replace without flooring warns', () => {
  const r = E.layout(E.stepsFromScope(scope({ tub: { size: 'replace' } }), cat, 0), '2026-11-20', cat);
  assert.ok(r.warnings.some(w => /flooring/.test(w)));
});

t('buffer before move-in', () => {
  assert.deepEqual(E.buffer('2026-12-04', '2026-12-07'), { days: 1, ok: true });  // Fri -> Mon
  assert.deepEqual(E.buffer('2026-12-04', '2026-12-04'), { days: 0, ok: false });
  assert.deepEqual(E.buffer('2026-12-07', '2026-12-04'), { days: -1, ok: false });
});

t('mergeScope keeps booked steps + dates, adds new in order', () => {
  let steps = E.stepsFromScope(scope({ tech: { size: 'basic' }, clean: { size: 'std' } }), cat, 0);
  E.layout(steps, '2026-11-20', cat);
  steps[1].status = 'booked'; steps[1].vendor = 'Up & Up'; steps[1].vendorEdited = true;
  steps = E.mergeScope(steps, scope({ tech: { size: 'basic' }, paint: { size: 'full' }, clean: { size: 'heavy' } }), cat, 0);
  assert.deepEqual(steps.map(s => s.key), ['tech', 'paint', 'clean']);
  assert.equal(steps[2].vendor, 'Up & Up');
  assert.equal(steps[2].size, 'std'); // booked: size not silently changed
  steps = E.mergeScope(steps, scope({ paint: { size: 'full' } }), cat, 0);
  assert.deepEqual(steps.map(s => s.key), ['paint', 'clean']); // tech dropped (open), clean kept (booked) as orphan
  assert.ok(steps[1].orphan);
});

t('vendor message drops empty lines', () => {
  const s = E.layout(E.stepsFromScope(scope({ paint: { size: 'full', note: 'Ceilings too' } }), cat, 0), '2026-11-20', cat).steps[0];
  const m = E.vendorMessage(D.template, { vendor: 'Trevor', trade: 'paint (full paint)', address: '547 Cherry St SE', unit: 'Unit 4B',
    date: E.fmt(s.start), time: E.fmtTime(s.time), length: E.lengthText(s), scope: s.note, access: '' });
  assert.ok(m.includes('Mon Nov 23, starting 9 AM'));
  assert.ok(m.includes('Scope: Ceilings too'));
  assert.ok(!m.includes('Access'));
  console.log('\n' + m + '\n');
});

console.log(n + ' tests passed');
