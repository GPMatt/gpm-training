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
  assert.equal(D.techForProperty('2861 Taft Ave SW', {}), null);
  assert.equal(D.techForProperty('2860 Clyde Park Ave SW', {}), null);
});

t('(R4.2) techProperties: Wesley default, custom list, lowercase, old billProperties honoured', () => {
  let r = plain(D.techPrepRecipients({ property_label: '547 Cherry Street SE' }, {}, ''));
  assert.deepEqual(r.to, ['spencer@greenpropertymgt.com', 'wesley@greenpropertymgt.com']);
  assert.deepEqual(r.cc, ['jason@greenpropertymgt.com']);
  assert.equal(D.techForProperty('547 Cherry St SE', {}).walks, true);
  assert.equal(D.techForProperty('3608 Havana Ave SW', {}).walks, false);
  const tp = { techProperties: [{ tech: 'Zed', email: ' Zed@GreenPropertyMgt.com ', walks: true, addresses: ['900 Leonard St NW'] }] };
  r = plain(D.techPrepRecipients({ property_label: '900 Leonard St NW' }, tp, ''));
  assert.deepEqual(r.to, ['spencer@greenpropertymgt.com', 'zed@greenpropertymgt.com']);
  // techProperties set: replaces the defaults, so Bill's old address now goes to riley@
  r = plain(D.techPrepRecipients({ property_label: '3608 Havana Ave SW' }, tp, ''));
  assert.deepEqual(r.to, ['spencer@greenpropertymgt.com', 'riley@greenpropertymgt.com']);
  // move-out emails use the same routing
  const m = moveOutTurn(); m.property_label = '547 Cherry St SE';
  assert.deepEqual(plain(D.buildMoveOutMail(m, {}, '')).to, ['spencer@greenpropertymgt.com', 'wesley@greenpropertymgt.com']);
});

t('(R4) cleanTestTo: strips space + trailing punctuation, throws on junk', () => {
  assert.equal(D.cleanTestTo('  matt@greenpropertymgt.com. '), 'matt@greenpropertymgt.com');
  assert.equal(D.cleanTestTo('Matt@GreenPropertyMgt.com,;'), 'matt@greenpropertymgt.com');
  assert.equal(D.cleanTestTo(''), '');
  assert.equal(D.cleanTestTo(null), '');
  assert.equal(D.cleanTestTo('  '), '');
  assert.throws(() => D.cleanTestTo('matt at gpm'), /EMAIL_TEST_TO is not a valid email: matt at gpm/);
  assert.throws(() => D.cleanTestTo('matt@'), /not a valid email/);
});

t('(R4.8) blinds rows under Parts to order; old fields as fallback', () => {
  const turn = { tech_prep: { bedrooms: '2', bathrooms: '1', blinds_count: 9, blinds_sizes: 'ignored',
    blinds: [{ room: 'bed1', window: 'North', size: '35x64' }, { room: 'living', window: 'Front left', size: '23x64' },
      { room: 'den', window: '', size: '30x64' }, { room: '', window: '', size: '' }] } };
  assert.equal(D.describeTechPrep(turn, D.CHECK_ROOMS_SERVER, {}).text, [
    'No repairs found at the PMI.', '', '---- Not for the work order ----', '',
    'Parts to order:',
    '- Blinds to replace: 3',
    '  - Bedroom 1, North: 35x64',
    '  - Living room, Front left: 23x64',
    '  - den: 30x64'
  ].join('\n'));
  delete turn.tech_prep.blinds;
  assert.ok(D.describeTechPrep(turn, D.CHECK_ROOMS_SERVER, {}).text.endsWith('- Blinds to replace: 9 (sizes: ignored)'));
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
    '- Blinds to replace: 1 (sizes: 35x64)',
    '- Furnace filter size: 16x25x1',
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

// ---------- Move-out scope change email ----------
const eng = {};
new Function('ctx', (read('Config.html') + read('Engine.html')).replace(/<\/?script>/g, '') + ';ctx.E=Engine;ctx.S=DEFAULT_SETTINGS;')(eng);

function moveOutTurn() {
  return {
    id: 'x', property_label: '2361 Example St SW', unit_label: '#4', af_wo_number: '18171-1',
    move_out_check: {
      scope_matches: 'No',
      changes: [
        { type: 'add', trade: 'flooring', size: 'lvp', note: 'Kitchen + bath' },
        { type: 'resize', trade: 'paint', size: 'color' },
        { type: 'remove', trade: 'carpetclean' },
        { type: 'tech', note: 'Replace closet door', hours: 2 },
        { type: 'vendor', note: 'Glass company for cracked window' }
      ],
      impact: {
        applied_at: '2026-11-19T20:00:00Z', rr_before: '2026-11-24', rr_after: '2026-11-30',
        moved: [
          { key: 'tech', label: 'Tech', vendor: 'Riley', before: '2026-11-20', after: '2026-11-23', was_confirmed: true },
          { key: 'paint', label: 'Paint', vendor: 'Trevor', before: '2026-11-23', after: '2026-11-25', was_confirmed: true },
          { key: 'clean', label: 'Clean', vendor: 'GR Cleaning Co / Up & Up', before: '2026-11-24', after: '2026-11-30', was_confirmed: false }
        ]
      }
    }
  };
}

const EXPECTED_MOVEOUT = [
  'Scope changed at move-out. Rent ready moves from Tue Nov 24 to Mon Nov 30 (+3 business days).', // skips Thanksgiving
  '',
  'Changes:',
  '- Add Flooring (LVP / vinyl) - Kitchen + bath',
  '- Paint: size now Color change (2 days)',
  '- Remove Carpet cleaning',
  '- New tech item: Replace closet door (+2 h)',
  '- Other vendor item: Glass company for cracked window',
  '',
  'Vendors to re-contact (were confirmed):',
  '- Tech: Fri Nov 20 -> Mon Nov 23',
  '- Paint - Trevor: Mon Nov 23 -> Wed Nov 25',
  '',
  'Other dates that moved:',
  '- Clean - GR Cleaning Co / Up & Up: Tue Nov 24 -> Mon Nov 30'
].join('\n');

t('(m1) move-out: confirmed vendors moved, exact text + subject, no Riley', () => {
  const d = D.describeMoveOut(moveOutTurn(), eng.S);
  assert.equal(d.text, EXPECTED_MOVEOUT);
  assert.equal(d.subject, 'Turn schedule changed: 2361 Example St SW #4 (WO 18171-1)');
  assert.ok(!/riley/i.test(d.text + d.subject + d.html));
  assert.ok(d.html.includes('<p>Changes:<br>- Add Flooring (LVP / vinyl) - Kitchen + bath<br>'));
  console.log('\n' + d.text + '\n');
});

t('(m2) move-out: no confirmed vendor moved, rent ready stays / earlier', () => {
  const turn = { property_label: '547 Cherry St SE', move_out_check: { scope_matches: 'No',
    changes: [{ type: 'tech', note: 'Tighten railing' }],
    impact: { rr_before: '2026-12-04', rr_after: '2026-12-04', moved: [] } } };
  assert.equal(D.describeMoveOut(turn, eng.S).text, [
    'Scope changed at move-out. Rent ready stays Fri Dec 4.',
    '',
    'Changes:',
    '- New tech item: Tighten railing',
    '',
    'Vendors to re-contact (were confirmed):',
    'No confirmed vendors moved.'
  ].join('\n'));
  assert.equal(D.describeMoveOut(turn, eng.S).subject, 'Turn schedule changed: 547 Cherry St SE');
  turn.move_out_check.impact = { rr_before: '2026-12-07', rr_after: '2026-12-04', moved: [] };
  assert.equal(D.describeMoveOut(turn, eng.S).text.split('\n')[0],
    'Scope changed at move-out. Rent ready moves earlier, from Mon Dec 7 to Fri Dec 4 (-1 business day).');
  // No catalog in settings: raw keys, still no crash.
  assert.ok(D.describeMoveOut(moveOutTurn(), {}).text.includes('- Add flooring (lvp) - Kitchen + bath'));
});

t('(m3) move-out: test switch + Bill routing', () => {
  const m = plain(D.buildMoveOutMail(moveOutTurn(), eng.S, 'matt@greenpropertymgt.com'));
  assert.deepEqual(m.to, ['matt@greenpropertymgt.com']);
  assert.deepEqual(m.cc, []);
  assert.equal(m.subject, '[TEST] Turn schedule changed: 2361 Example St SW #4 (WO 18171-1)');
  assert.equal(m.text, 'TEST: real recipients would be To: spencer@greenpropertymgt.com, riley@greenpropertymgt.com; Cc: jason@greenpropertymgt.com\n\n' + EXPECTED_MOVEOUT);
  const bill = moveOutTurn(); bill.property_label = '3608 Havana Ave SW';
  const real = plain(D.buildMoveOutMail(bill, eng.S, ''));
  assert.deepEqual(real.to, ['spencer@greenpropertymgt.com', 'bill@greenpropertymgt.com']);
  assert.deepEqual(real.cc, ['jason@greenpropertymgt.com']);
  assert.ok(!real.subject.includes('[TEST]'));
});

t('(m4) bizDiffServer_ + fmtDay_ match Engine over 2026-2027', () => {
  for (let a = '2026-01-01'; a < '2027-12-31'; a = eng.E.addDays(a, 5)) {
    for (const k of [-9, -1, 1, 3, 12]) {
      const b = eng.E.addDays(a, k);
      assert.equal(D.bizDiffServer_(a, b), eng.E.bizDiff(a, b), a + ' -> ' + b);
    }
    assert.equal(D.fmtDay_(a), eng.E.fmt(a));
  }
});

// ---------- Move-out alert (submitted without Apply) ----------
function alertTurn() {
  const t = moveOutTurn();
  t.move_out_check.done_by = 'Spencer';
  t.move_out_check.pending_impact = {
    computed_at: '2026-11-19T20:00:00Z', rr_before: '2026-11-24', rr_after: '2026-11-30',
    moved: [
      { key: 'tech', label: 'Tech', vendor: 'Riley', before: '2026-11-20', after: '2026-11-23', before_end: '2026-11-20', after_end: '2026-11-23', was_confirmed: true },
      { key: 'carpetclean', label: 'Carpet cleaning', vendor: 'Stanley Steemer', before: '2026-11-24', after: null, before_end: '2026-11-24', after_end: null, was_confirmed: true },
      { key: 'clean', label: 'Clean', vendor: 'Up & Up', before: '2026-11-24', after: '2026-11-30', was_confirmed: false }
    ]
  };
  delete t.move_out_check.impact;
  return t;
}

const EXPECTED_ALERT = [
  'Spencer submitted the move-out check: the scope changed, but the schedule has NOT been updated yet. Open the turn and tap Apply to schedule.',
  '',
  'If applied, rent ready would move from Tue Nov 24 to Mon Nov 30 (+3 business days).',
  '',
  'Changes:',
  '- Add Flooring (LVP / vinyl) - Kitchen + bath',
  '- Paint: size now Color change (2 days)',
  '- Remove Carpet cleaning',
  '- New tech item: Replace closet door (+2 h)',
  '- Other vendor item: Glass company for cracked window',
  '',
  'Confirmed vendors that would need a new date:',
  '- Tech: Fri Nov 20 -> Mon Nov 23',
  '- Carpet cleaning - Stanley Steemer: Tue Nov 24 -> removed'
].join('\n');

t('(n1) move-out alert: exact text + subject, no Riley, neutral wording', () => {
  const d = D.describeMoveOutAlert(alertTurn(), eng.S);
  assert.equal(d.text, EXPECTED_ALERT);
  assert.equal(d.subject, 'Turn scope changed, NOT applied: 2361 Example St SW #4 (WO 18171-1)');
  assert.ok(!/riley/i.test(d.text + d.subject + d.html));
  console.log('\n' + d.text + '\n');
  const t2 = alertTurn();
  delete t2.move_out_check.done_by;
  t2.move_out_check.pending_impact.moved = [];
  t2.move_out_check.pending_impact.rr_after = '2026-11-24';
  t2.move_out_check.changes = [];
  assert.equal(D.describeMoveOutAlert(t2, eng.S).text, [
    'The move-out check was submitted: the scope changed, but the schedule has NOT been updated yet. Open the turn and tap Apply to schedule.',
    '',
    'If applied, rent ready would stay Tue Nov 24.',
    '',
    'No confirmed vendors would move.'
  ].join('\n'));
});

t('(n2) move-out alert: test switch + Bill routing', () => {
  const m = plain(D.buildMoveOutAlertMail(alertTurn(), eng.S, 'matt@greenpropertymgt.com'));
  assert.deepEqual(m.to, ['matt@greenpropertymgt.com']);
  assert.deepEqual(m.cc, []);
  assert.equal(m.subject, '[TEST] Turn scope changed, NOT applied: 2361 Example St SW #4 (WO 18171-1)');
  assert.equal(m.text, 'TEST: real recipients would be To: spencer@greenpropertymgt.com, riley@greenpropertymgt.com; Cc: jason@greenpropertymgt.com\n\n' + EXPECTED_ALERT);
  const bill = alertTurn(); bill.property_label = '2340 Michael Ave SW';
  const real = plain(D.buildMoveOutAlertMail(bill, eng.S, ''));
  assert.deepEqual(real.to, ['spencer@greenpropertymgt.com', 'bill@greenpropertymgt.com']);
  assert.deepEqual(real.cc, ['jason@greenpropertymgt.com']);
});

// ---------- R4.5 conflict review email ----------
function otherTurns() {
  return [
    { id: 'x', property_label: '2361 Example St SW', unit_label: '#4', steps: [{ key: 'paint', label: 'Paint', vendor: 'Trevor', start: '2026-11-25', status: 'booked' }] }, // same turn: skipped
    { id: 'o1', property_label: '90 Wealthy St SE', unit_label: '2B', steps: [
      { key: 'paint', label: 'Paint', vendor: 'trevor ', start: '2026-12-01', status: 'booked' },
      { key: 'clean', label: 'Clean', vendor: 'Up & Up', start: '2026-12-02', status: 'open' },
      { key: 'paint', label: 'Paint', vendor: 'Trevor', start: '2027-01-15', status: 'open' }] },     // > 15 business days: out
    { id: 'o2', property_label: '445 Knapp St NE', unit_label: null, steps: [
      { key: 'tech', label: 'Tech', vendor: 'Riley', start: '2026-11-19', status: 'resched' },
      { key: 'paint', label: 'Paint', vendor: 'Trevor', start: '2026-11-18', status: 'done' }] },
    { id: 'o3', archived: true, property_label: '1 Old St', steps: [{ key: 'paint', label: 'Paint', vendor: 'Trevor', start: '2026-11-24', status: 'booked' }] }
  ];
}

const EXPECTED_REVIEW = [
  'Scope changed at move-out. Rent ready moves from Tue Nov 24 to Mon Nov 30 (+3 business days).',
  '',
  'Changes:',
  '- Add Flooring (LVP / vinyl) - Kitchen + bath',
  '- Paint: size now Color change (2 days)',
  '- Remove Carpet cleaning',
  '- New tech item: Replace closet door (+2 h)',
  '- Other vendor item: Glass company for cracked window',
  '',
  'Vendors to re-contact (were confirmed):',
  '- Tech - Riley: Fri Nov 20 -> Mon Nov 23',
  '- Paint - Trevor: Mon Nov 23 -> Wed Nov 25',
  '',
  'Same vendors on other open turns:',
  '- Trevor: Wed Nov 18 Paint at 445 Knapp St NE (Done)',
  '- Riley: Thu Nov 19 Tech at 445 Knapp St NE (Reschedule)',
  '- Trevor: Tue Dec 1 Paint at 90 Wealthy St SE 2B (Confirmed)'
].join('\n');

t('(R4.5) conflict review: exact text, Matt only, test switch, null when nothing confirmed', () => {
  const turn = moveOutTurn();
  const d = D.describeConflictReview(turn, turn.move_out_check.impact, true, otherTurns(), eng.S);
  assert.equal(d.subject, 'Turn conflict review: 2361 Example St SW #4');
  assert.equal(d.text, EXPECTED_REVIEW);
  // Spencer's emails for the same turn still never name the tech
  assert.ok(!/riley/i.test(D.describeMoveOut(turn, eng.S).text));
  assert.ok(!/riley/i.test(D.describeMoveOutAlert(alertTurn(), eng.S).text));
  console.log('\n' + d.text + '\n');
  let m = plain(D.buildConflictReviewMail(turn, turn.move_out_check.impact, true, otherTurns(), eng.S, ''));
  assert.deepEqual(m.to, ['matt@greenpropertymgt.com']);
  assert.deepEqual(m.cc, []);
  m = plain(D.buildConflictReviewMail(turn, turn.move_out_check.impact, true, otherTurns(), eng.S, 'test@greenpropertymgt.com'));
  assert.deepEqual(m.to, ['test@greenpropertymgt.com']);
  assert.equal(m.subject, '[TEST] Turn conflict review: 2361 Example St SW #4');
  assert.equal(m.text, 'TEST: real recipients would be To: matt@greenpropertymgt.com\n\n' + EXPECTED_REVIEW);
  // not-applied wording (alert) + None found
  const a = alertTurn();
  const ad = D.describeConflictReview(a, a.move_out_check.pending_impact, false, [], eng.S);
  assert.ok(ad.text.startsWith('If applied, rent ready would move'));
  assert.ok(ad.text.includes('Confirmed vendors that would need a new date:\n'));
  assert.ok(ad.text.endsWith('Same vendors on other open turns:\nNone found'));
  // nothing confirmed -> no review
  assert.equal(D.buildConflictReviewMail(turn, { moved: [{ key: 'clean', vendor: 'X', was_confirmed: false }] }, true, [], eng.S, ''), null);
});

// ---------- R4.6 calendar events ----------
t('(R4.6) calendarEvents: titles, all-day vs timed, rent ready, duplicate keys', () => {
  const turn = { id: 'x', property_label: '2361 Example St SW', unit_label: '#4', af_wo_number: '18171-1', rent_ready_date: '2026-11-30',
    steps: [
      { key: 'tech', label: 'Tech', vendor: 'Riley', start: '2026-11-23', end: '2026-11-23', time: '09:00', hours: 4, status: 'done' },
      { key: 'drywall', label: 'Drywall / plaster', vendor: 'Matt Luschas', start: '2026-11-24', end: '2026-11-25', time: '09:00', hours: 16, status: 'booked' },
      { key: 'paint', label: 'Paint', vendor: 'Trevor', start: '2026-11-27', end: '2026-11-27', time: '', status: 'resched' },
      { key: 'clean', label: 'Clean', vendor: '', start: '2026-11-30', end: '2026-11-30', time: '13:30', hours: 0, status: 'open' },
      { key: 'carpetclean', label: 'Carpet cleaning', vendor: '', start: null, end: null, status: 'open' },
      { key: 'clean', label: 'Clean', vendor: 'Up & Up', start: '2026-11-30', end: '2026-11-30', time: '', status: 'booked' }
    ] };
  const ev = plain(D.calendarEvents(turn, 'https://script.google.com/a/macros/x/exec'));
  assert.deepEqual(ev.map(e => [e.key, e.title, e.allDay, e.start, e.end]), [
    ['tech', '✓ Tech · Riley · 2361 Example St SW #4', false, '2026-11-23 09:00', '2026-11-23 13:00'],
    ['drywall', 'Drywall / plaster · Matt Luschas · 2361 Example St SW #4', true, '2026-11-24', '2026-11-26'],
    ['paint', 'Paint · Trevor · 2361 Example St SW #4 [Reschedule]', true, '2026-11-27', '2026-11-28'],
    ['clean', 'Clean · no vendor · 2361 Example St SW #4 [Not booked]', false, '2026-11-30 13:30', '2026-11-30 21:30'],
    ['clean#2', 'Clean · Up & Up · 2361 Example St SW #4', true, '2026-11-30', '2026-12-01'],
    ['_rentready', 'Rent ready · 2361 Example St SW #4', true, '2026-11-30', '2026-12-01']
  ]);
  assert.equal(ev[1].description, 'Status: Confirmed\nWO: 18171-1\nRent ready: Mon Nov 30\nGPM Turns: https://script.google.com/a/macros/x/exec');
  assert.equal(ev[5].description, 'WO: 18171-1\nRent ready: Mon Nov 30\nGPM Turns: https://script.google.com/a/macros/x/exec');
  ev.forEach(e => console.log('  ' + e.title));
  // hash: stable, changes when the event changes
  assert.equal(D.eventHash(ev[0]), D.eventHash(plain(D.calendarEvents(turn, 'https://script.google.com/a/macros/x/exec'))[0]));
  turn.steps[0].status = 'booked';
  assert.notEqual(D.eventHash(ev[0]), D.eventHash(plain(D.calendarEvents(turn, 'https://script.google.com/a/macros/x/exec'))[0]));
  assert.deepEqual(plain(D.calendarEvents({ steps: [] }, '')), []);
});

console.log(n + ' tests passed');
