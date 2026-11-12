// Run: node app-test/engine.test.js  (from the P03 folder)
const fs = require('fs'), path = require('path'), assert = require('assert');
const load = f => fs.readFileSync(path.join(__dirname, '../app', f), 'utf8').replace(/<\/?script>/g, '');
const ctx = {};
new Function('ctx', load('Config.html') + load('Engine.html') + ';ctx.E=Engine;ctx.D=DEFAULT_SETTINGS;')(ctx);
const { E, D } = ctx;
const cat = D.catalog;
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('vendor holidays (6 standard, Sat -> Fri, Sun -> Mon)', () => {
  assert.equal(E.holidayName('2026-11-26'), 'Thanksgiving');
  assert.equal(E.holidayName('2026-11-11'), '');           // Veterans Day: vendors work
  assert.equal(E.holidayName('2026-10-12'), '');           // Columbus Day: vendors work
  assert.equal(E.holidayName('2027-01-18'), '');           // MLK Day: vendors work
  assert.equal(E.holidayName('2027-06-18'), '');           // Juneteenth: not a vendor holiday
  assert.equal(E.holidayName('2026-12-25'), 'Christmas');
  assert.equal(E.holidayName('2026-07-03'), 'Independence Day'); // July 4 2026 is a Saturday -> Friday
  assert.equal(E.holidayName('2027-07-05'), 'Independence Day'); // Sunday -> Monday
  assert.equal(E.holidayName('2027-12-31'), "New Year's Day");   // Jan 1 2028 is a Saturday -> Fri Dec 31
  assert.equal(E.holidayName('2027-12-24'), 'Christmas');        // Dec 25 2027 is a Saturday -> Friday
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
  assert.equal(by.flooring, '2026-11-24..2026-11-24');           // resurface sits overnight: no cure day
  assert.equal(by.drywall, '2026-11-25..2026-11-27');            // skips Thanksgiving
  assert.equal(by.appliances, '2026-11-30..2026-11-30');
  assert.equal(by.tech, '2026-11-30..2026-11-30');               // same day as appliances
  assert.equal(by.paint, '2026-12-01..2026-12-01');
  assert.equal(by.clean, '2026-12-02..2026-12-02');
  assert.equal(by.carpetclean, '2026-12-03..2026-12-03');
  assert.equal(r.rentReady, '2026-12-03');  // rent ready = last day of work
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

// ---------- move-out scope changes (P4) ----------
function baseSchedule() {
  // Fri 11/20 move-out: tech Mon 11/23, paint Tue 11/24, clean Wed 11/25
  const steps = E.stepsFromScope(scope({ tech: { size: 'basic' }, paint: { size: 'full' }, clean: { size: 'std' } }), cat, 0);
  return E.layout(steps, '2026-11-20', cat).steps;
}
const dates = steps => Object.fromEntries(steps.map(s => [s.key, s.start + '..' + s.end]));

t('move-out rebuild starts the next business day after move-out', () => {
  const r = E.applyChanges(baseSchedule(), [], cat, '2026-11-20');
  assert.equal(r.firstBuildDay, '2026-11-23');
  assert.equal(r.steps[0].start, '2026-11-23');
  const r2 = E.applyChanges(baseSchedule(), [], cat, '2026-11-25'); // Wed before Thanksgiving
  assert.equal(r2.steps[0].start, '2026-11-27');
});

t('added trade shifts later steps; old list untouched', () => {
  const before = baseSchedule();
  const r = E.applyChanges(before, [{ type: 'add', trade: 'drywall', size: 'small' }], cat, '2026-11-20');
  assert.deepEqual(r.steps.map(s => s.key), ['drywall', 'tech', 'paint', 'clean']);
  assert.equal(dates(r.steps).drywall, '2026-11-23..2026-11-24');
  assert.equal(dates(r.steps).tech, '2026-11-25..2026-11-25');
  assert.equal(dates(r.steps).clean, '2026-11-30..2026-11-30'); // skips Thanksgiving + weekend
  assert.equal(before[0].start, '2026-11-23');                    // input not mutated
  assert.equal(E.bizDiff('2026-11-25', r.rentReady), 2);           // Wed 11/25 -> Mon 11/30 (Thanksgiving off)
});

t('removed trade pulls later steps forward', () => {
  const r = E.applyChanges(baseSchedule(), [{ type: 'remove', trade: 'tech' }], cat, '2026-11-20');
  assert.deepEqual(r.steps.map(s => s.key), ['paint', 'clean']);
  assert.equal(r.steps[0].start, '2026-11-23');
  assert.equal(r.rentReady, '2026-11-24');
});

t('resize + new tech item hours lengthen steps; vendor item has no effect', () => {
  const r = E.applyChanges(baseSchedule(), [{ type: 'resize', trade: 'clean', size: 'heavy' },
    { type: 'tech', note: 'Replace 3 blinds', hours: 3 }, { type: 'vendor', note: 'HVAC service' }], cat, '2026-11-20');
  const by = Object.fromEntries(r.steps.map(s => [s.key, s]));
  assert.equal(by.tech.hours, 11); assert.equal(by.tech.days, 2);
  assert.equal(by.clean.days, 2);
  assert.equal(dates(r.steps).paint, '2026-11-25..2026-11-25');
  assert.equal(r.rentReady, '2026-11-30');
  const r2 = E.applyChanges(baseSchedule(), [{ type: 'vendor', note: 'HVAC' }], cat, '2026-11-20');
  assert.equal(r2.rentReady, '2026-11-25');
});

t('confirmed-moved detection (diffSteps) + pinned clash is released', () => {
  const before = baseSchedule();
  before[1].status = 'booked';                                     // paint confirmed Tue 11/24
  before[2].status = 'booked'; before[2].pinned = true; before[2].start = '2026-12-01'; // clean confirmed, pinned later
  E.layout(before, '2026-11-20', cat);
  let r = E.applyChanges(before, [{ type: 'add', trade: 'flooring', size: 'lvp' }], cat, '2026-11-20');
  let d = E.diffSteps(before, r.steps);
  assert.deepEqual(d.added.map(x => x.key), ['flooring']);
  assert.deepEqual(d.moved.map(x => [x.key, x.before, x.after, x.was_confirmed]),
    [['tech', '2026-11-23', '2026-11-24', false], ['paint', '2026-11-24', '2026-11-25', true]]);
  assert.equal(r.steps[3].start, '2026-12-01');                    // pin later than needed: kept, not moved
  // big add pushes past the pin: pin is released and shows as moved
  r = E.applyChanges(before, [{ type: 'add', trade: 'flooring', size: 'hardwood' }, { type: 'add', trade: 'drywall', size: 'large' }], cat, '2026-11-20');
  d = E.diffSteps(before, r.steps);
  const clean = d.moved.filter(x => x.key === 'clean')[0];
  assert.ok(clean && clean.was_confirmed && clean.after > '2026-12-01');
  assert.equal(r.steps.filter(s => s.key === 'clean')[0].pinned, false);
  // removed confirmed step -> removed with after null
  r = E.applyChanges(before, [{ type: 'remove', trade: 'paint' }], cat, '2026-11-20');
  d = E.diffSteps(before, r.steps);
  assert.deepEqual(d.removed.map(x => [x.key, x.after, x.was_confirmed]), [['paint', null, true]]);
});

t("progress does not count 'resched' as done or confirmed", () => {
  const p = E.progress([{ status: 'done' }, { status: 'resched' }, { status: 'booked' }, { status: 'open' }]);
  assert.deepEqual([p.done, p.booked, p.total, p.pct], [1, 1, 4, 38]);
});

// ---------- Run 2b B3: buffer days (new turns only, flag scope.buffers) ----------
function chain3() { return E.stepsFromScope(scope({ tech: { size: 'basic' }, paint: { size: 'full' }, clean: { size: 'std' } }), cat, 0); }

t('B3 unflagged turn: layout identical to before, no buffers', () => {
  const a = E.layout(chain3(), '2026-11-20', cat), b = E.layout(chain3(), '2026-11-20', cat, { buffers: false });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.deepEqual(a.buffers, []);
  assert.deepEqual(a.steps.map(s => s.start), ['2026-11-23', '2026-11-24', '2026-11-25']);
  assert.equal(a.rentReady, '2026-11-25');
});

t('B3 flagged turn: start + end buffer, rent ready = end buffer (skips Thanksgiving)', () => {
  const r = E.layout(chain3(), '2026-11-20', cat, { buffers: true });   // move-out Fri
  assert.deepEqual(r.buffers.map(x => [x.key, x.date, x.label]), [
    ['buffer_start', '2026-11-23', 'Buffer: trash-out if needed'],
    ['buffer_end', '2026-11-30', 'Buffer: tech punch list']]);
  assert.deepEqual(r.steps.map(s => s.start), ['2026-11-24', '2026-11-25', '2026-11-27']); // clean skips Thu 11-26
  assert.equal(r.rentReady, '2026-11-30');
  assert.equal(r.firstBuildDay, '2026-11-23');
  assert.deepEqual(r.warnings, []);
});

t('B3 buffer skips holiday + weekend (move-out Wed 2026-11-25)', () => {
  const r = E.layout(E.stepsFromScope(scope({ tech: { size: 'basic' } }), cat, 0), '2026-11-25', cat, { buffers: true });
  assert.equal(r.buffers[0].date, '2026-11-27');   // Thanksgiving 11-26 skipped
  assert.equal(r.steps[0].start, '2026-11-30');    // weekend skipped
  assert.equal(r.buffers[1].date, '2026-12-01');
  assert.equal(r.rentReady, '2026-12-01');
});

t('B3 end buffer comes after cure days; applyChanges + recommended keep the buffers', () => {
  const st = chain3(); st[2].cure = 1;
  let r = E.layout(st, '2026-11-20', cat, { buffers: true });
  assert.equal(r.buffers[1].date, '2026-12-01');   // clean 11-27, cure Mon 11-30, buffer Tue 12-01
  r = E.applyChanges(chain3(), [{ type: 'add', trade: 'drywall', size: 'small' }], cat, '2026-11-20', { buffers: true });
  assert.equal(r.buffers[0].date, '2026-11-23');
  assert.equal(r.steps[0].key, 'drywall');
  assert.equal(r.steps[0].start, '2026-11-24');
  assert.equal(r.rentReady, r.buffers[1].date);
  assert.equal(r.buffers[1].date, E.nextBiz(r.steps[r.steps.length - 1].end));
  assert.deepEqual(E.applyChanges(chain3(), [], cat, '2026-11-20').buffers, []);
  r = E.recommended(chain3(), '2026-11-20', cat, { buffers: true });
  assert.equal(r.rentReady, '2026-11-30');
});

console.log(n + ' tests passed');
