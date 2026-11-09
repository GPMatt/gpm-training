// Run: node app-test/describe.test.js  (from the P03 folder)
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, '../app', f), 'utf8');
const D = {};
vm.createContext(D);
vm.runInContext(read('Describe.js'), D);
const cfg = {};
new Function('ctx', read('Config.html').replace(/<\/?script>/g, '') + ';ctx.CHECK_ROOMS=CHECK_ROOMS;')(cfg);
let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
const plain = x => JSON.parse(JSON.stringify(x)); // vm objects come from another realm

// 2361 #4 (PAPER_CHECKLIST.md): 2 bed / 1 bath, exterior + basement N/A.
function example2361() {
  const allNa = k => Object.fromEntries(cfg.CHECK_ROOMS.find(r => r.id === k).items.map((_, i) => [i, { s: 'na' }]));
  return {
    id: 'x', property_label: '2361 Example St SW', unit_label: '#4', af_wo_number: '18171-1',
    tech_prep: {
      done_by: 'Spencer', bedrooms: '2', bathrooms: '1', rekey: 'OK as is', keys_mailbox: 1,
      checklist: {
        exterior: allNa('exterior'), basement: allNa('basement'),
        kitchen: { 11: { s: 'fix', note: 'Cabinets stay open' } },
        bed1: { 4: { s: 'fix', note: 'Replace blinds', charge: true } },
        bed2: { 4: { s: 'fix', note: 'Replace blinds', charge: true } }
      }
    }
  };
}

const EXPECTED_2361 = [
  'Kitchen: Cabinets stay open.',
  '',
  'Bedroom 1: Replace blinds. (Charge Tenant)',
  '',
  'Bedroom 2: Replace blinds. (Charge Tenant)',
  '',
  'Keys: 1 mailbox key left.',
  '',
  '---- Not for the work order ----',
  '',
  'Filled by: Spencer'
].join('\n');

t('(a) 2361 #4 exact text + subject', () => {
  const d = D.describeTechPrep(example2361(), D.CHECK_ROOMS_SERVER, {});
  assert.equal(d.text, EXPECTED_2361);
  assert.equal(d.subject, 'Turn WO description: 2361 Example St SW #4 (WO 18171-1)');
  assert.ok(d.html.includes('<hr>') && d.html.includes('<p>Kitchen: Cabinets stay open.</p>'));
  console.log('\n' + d.text + '\n');
});

t('(a2) deterministic', () => {
  assert.equal(D.describeTechPrep(example2361(), D.CHECK_ROOMS_SERVER, {}).text, D.describeTechPrep(example2361(), D.CHECK_ROOMS_SERVER, {}).text);
});

t('(b) Bill property routes to bill@, not riley@', () => {
  const turn = { property_label: '2860 Taft Avenue SW,' };
  let r = plain(D.techPrepRecipients(turn, {}, ''));
  assert.deepEqual(r.to, ['spencer@greenpropertymgt.com', 'bill@greenpropertymgt.com']);
  assert.deepEqual(r.cc, ['jason@greenpropertymgt.com']);
  r = plain(D.techPrepRecipients({ property_label: '900 Leonard St NW' }, {}, ''));
  assert.deepEqual(r.to, ['spencer@greenpropertymgt.com', 'riley@greenpropertymgt.com']);
  // settings.billProperties overrides the default list
  r = plain(D.techPrepRecipients({ property_label: '900 Leonard St NW' }, { billProperties: ['900 Leonard Street NW'] }, ''));
  assert.deepEqual(r.to, ['spencer@greenpropertymgt.com', 'bill@greenpropertymgt.com']);
  r = plain(D.techPrepRecipients(turn, { billProperties: [] }, ''));
  assert.ok(r.to.includes('riley@greenpropertymgt.com'));
  // 2860 must not match 2861 / a different street
  assert.equal(D.isBillProperty('2861 Taft Ave SW', {}), false);
  assert.equal(D.isBillProperty('2860 Clyde Park Ave SW', {}), false);
});

t('(c) EMAIL_TEST_TO: only test address, [TEST] subject, first line names real recipients', () => {
  const turn = example2361();
  const m = plain(D.buildTechPrepMail(turn, {}, ' matt@greenpropertymgt.com '));
  assert.deepEqual(m.to, ['matt@greenpropertymgt.com']);
  assert.deepEqual(m.cc, []);
  assert.ok(m.subject.startsWith('[TEST] Turn WO description:'));
  const first = m.text.split('\n')[0];
  assert.equal(first, 'TEST: real recipients would be To: spencer@greenpropertymgt.com, riley@greenpropertymgt.com; Cc: jason@greenpropertymgt.com');
  assert.equal(m.text, first + '\n\n' + EXPECTED_2361);
  assert.ok(m.html.startsWith('<p>TEST: real recipients'));
  const real = plain(D.buildTechPrepMail(turn, {}, ''));
  assert.deepEqual(real.to, ['spencer@greenpropertymgt.com', 'riley@greenpropertymgt.com']);
  assert.deepEqual(real.cc, ['jason@greenpropertymgt.com']);
  assert.equal(real.text, EXPECTED_2361);
  assert.ok(!real.subject.includes('[TEST]'));
});

t('(d) CHECK_ROOMS_SERVER deep-equals Config.html CHECK_ROOMS', () => {
  assert.deepStrictEqual(plain(D.CHECK_ROOMS_SERVER), plain(cfg.CHECK_ROOMS));
});

t('(e) no Riley unless done_by is Riley; full sections', () => {
  const turn = {
    property_label: '547 Cherry St SE', unit_label: null, af_wo_number: null,
    scope: { pmi_timer: { start: '2026-11-09T14:00:00Z', end: '2026-11-09T14:45:00Z' } },
    tech_prep: {
      done_by: 'Spencer', bedrooms: '1', bathrooms: '1', tech_hours: 6, rekey: 'Re-key', lock_type: 'Kwikset',
      rekey_parts: 'Kwikset pins', keys_entry: '1', keys_charge: true,
      parts: [{ item: 'Shower head', qty: 1, store: 'Ace' }, { item: '', qty: 2 }],
      blinds_count: 1, blinds_sizes: '35x64', furnace_filter_size: '16x25x1',
      pmi_timer: { start: '2026-11-09T15:05:00Z', end: '2026-11-09T16:20:00Z' },
      checklist: {
        living: { 3: { s: 'fix', note: 'missing blinds on one window', charge: true } },
        bath1: { 1: { s: 'fix', note: 'Crack in tile around tub faucet' }, 5: { s: 'fix' } },
        basement: { 2: { s: 'nc', note: 'tenant boxes in the way' }, 3: { s: 'nc' } }
      }
    }
  };
  const d = D.describeTechPrep(turn, D.CHECK_ROOMS_SERVER, {});
  assert.ok(!/riley/i.test(d.text + d.subject + d.html));
  assert.equal(d.subject, 'Turn WO description: 547 Cherry St SE');
  assert.equal(d.text, [
    'Living room: Missing blinds on one window. (Charge Tenant)',
    '',
    'Bathroom: Crack in tile around tub faucet. Shower curtain.',
    '',
    'Keys: 1 entry key left (2 required). Re-key entry lock (Kwikset). (Charge Tenant)',
    '',
    '---- Not for the work order ----',
    '',
    'Parts to order:',
    '- 1 x Shower head (Ace)',
    '- Lock parts: Kwikset pins',
    'Blinds to replace: 1 (sizes: 35x64)',
    'Furnace filter size: 16x25x1',
    '',
    'Not checked at the PMI:',
    '- Basement: Washer (tenant boxes in the way)',
    '- Basement: Dryer',
    '',
    'Tech hours estimate: 6',
    'PMI time: Mon Nov 9, 2026 10:05 AM to 11:20 AM (1.3 h)', // tech_prep.pmi_timer wins over scope.pmi_timer
    'Filled by: Spencer'
  ].join('\n'));
  turn.tech_prep.done_by = 'Riley';
  assert.ok(D.describeTechPrep(turn, D.CHECK_ROOMS_SERVER, {}).text.endsWith('Filled by: Riley'));
});

t('no fixes + no keys -> "No repairs found at the PMI."; html escapes', () => {
  const d = D.describeTechPrep({ property_label: 'A <b> & Co', tech_prep: { bedrooms: '1', bathrooms: '1' } }, D.CHECK_ROOMS_SERVER, {});
  assert.equal(d.text, 'No repairs found at the PMI.');
  assert.equal(d.html, '<p>No repairs found at the PMI.</p>');
  const e = D.describeTechPrep({ tech_prep: { bathrooms: '1', checklist: { bath1: { 0: { s: 'fix', note: 'Fan <loud> & "rattles"!' } } } } }, D.CHECK_ROOMS_SERVER, {});
  assert.equal(e.text, 'Bathroom: Fan <loud> & "rattles"!');
  assert.ok(e.html.includes('Fan &lt;loud&gt; &amp; &quot;rattles&quot;!'));
});

t('PMI time in EST (winter) and DST boundary', () => {
  const line = timer => D.describeTechPrep({ tech_prep: { pmi_timer: timer } }, D.CHECK_ROOMS_SERVER, {}).text.split('\n').pop();
  assert.equal(line({ start: '2026-12-01T14:00:00Z', end: '2026-12-01T15:30:00Z' }), 'PMI time: Tue Dec 1, 2026 9:00 AM to 10:30 AM (1.5 h)');
  assert.equal(line({ start: '2026-11-01T05:30:00Z', end: '2026-11-01T06:30:00Z' }), 'PMI time: Sun Nov 1, 2026 1:30 AM to 1:30 AM (1 h)'); // fall back
});

console.log(n + ' tests passed');
