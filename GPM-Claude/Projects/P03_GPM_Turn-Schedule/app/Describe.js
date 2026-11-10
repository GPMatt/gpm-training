/**
 * Tech Prep -> AppFolio work-order description email (pure functions, no GAS services).
 * Called by apiSendTechPrepEmail in Code.js. Tested by app-test/describe.test.js.
 */

// Server copy of CHECK_ROOMS in Config.html. Keep identical: describe.test.js fails if they drift.
var CHECK_ROOMS_SERVER = [
  // Items match Jason's "TURN checklist 2026" (Drive 1CQD_TPlhFzpN3wyr3NTS4-0Dk6gzmSpdhwQrSywkutU) room by room.
  { id: 'exterior', label: 'Exterior', items: ['Garage opener', '1 remote per door', 'Garage service door', '2 GPM entry keys', 'Garage / storage room for items left behind'] },
  { id: 'entry', label: 'Entry', items: ['Mailbox key', 'Entry lock', '2 key min', 'Door latches', 'Hallway light', 'Closet door / shelves'] },
  { id: 'living', label: 'Living room', items: ['Window panes', 'Window screens', 'Window locks', 'Window blinds', 'Outlets have power', 'Outlet / switch covers', 'Light fixture', 'HVAC vents (replace / paint)', 'Thermostat (heat / A/C)', 'Smoke / CO2 (outside bedroom)'] },
  { id: 'kitchen', label: 'Kitchen', items: ['Light above sink', 'Run dishwasher', 'Disposal', 'Faucet', 'Drains under sink', 'Stove / oven', 'Drip pans', 'Hood filter', 'Microwave', 'Fridge / freezer', 'Countertops', 'Cabinets / drawers', 'GFCI protecting', 'Outlet / switch covers'] },
  { id: 'basement', label: 'Basement', items: ['Smoke detector', 'Furnace filter', 'Washer', 'Dryer', 'Utility sink', 'Lights'] },
  { id: 'bath', label: 'Bathroom', repeat: 'bathrooms', items: ['Light / vent fan', 'Tub faucet', 'Tub drain', 'Tub stopper', 'Shower caulk', 'Shower curtain', 'Shower bar', 'Toilet drain / fill', 'Bolt caps on toilet', 'Toilet seat / hinges', 'Vanity faucet', 'Vanity drain', 'Toilet paper bar', 'Towel bar', 'GFCI protecting', 'Outlet / switch covers'] },
  { id: 'bed', label: 'Bedroom', repeat: 'bedrooms', items: ['Door latches', 'Window panes', 'Window screens', 'Window locks', 'Window blinds', 'Outlets have power', 'Outlet / switch covers', 'Light fixture', 'Smoke detector', 'Closet door latches', 'Closet hardware'] }
];

var DEFAULT_BILL_PROPERTIES = ['2340 Michael Ave SW', '2935 Oak Valley Ave SW', '2700 Clyde Park Ave SW', '2860 Taft Ave SW', '3608 Havana Ave SW'];
var REQUIRED_ENTRY_KEYS = 2;

// Same matcher as isCookieCutter() in App.html: house number + street name only.
function addrKey_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' '); }

function isBillProperty(addr, settings) {
  var list = (settings && settings.billProperties) || DEFAULT_BILL_PROPERTIES;
  var a = addrKey_(addr);
  return !!a && list.some(function (c) { return addrKey_(c) === a; });
}

/** Real recipients, or (when testTo is set) only testTo plus a note naming the real ones. */
function techPrepRecipients(turn, settings, testTo) {
  var to = ['spencer@greenpropertymgt.com', isBillProperty(turn.property_label, settings) ? 'bill@greenpropertymgt.com' : 'riley@greenpropertymgt.com'];
  var cc = ['jason@greenpropertymgt.com'];
  testTo = String(testTo || '').trim();
  if (!testTo) return { to: to, cc: cc, testNote: '' };
  return { to: [testTo], cc: [], testNote: 'TEST: real recipients would be To: ' + to.join(', ') + '; Cc: ' + cc.join(', ') };
}

// Same as roomInstances() in App.html.
function roomInstancesServer_(tp, rooms) {
  var out = [];
  rooms.forEach(function (r) {
    if (!r.repeat) { out.push({ id: r.id, label: r.label, items: r.items }); return; }
    var n = parseInt(tp[r.repeat], 10) || 0;
    for (var i = 1; i <= n; i++) out.push({ id: r.id + i, label: r.label + (n > 1 ? ' ' + i : ''), items: r.items });
  });
  return out;
}

function sentence_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(s) ? s : s + '.';
}

function hasVal_(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }

function plural_(n, one, many) { return n + ' ' + (Number(n) === 1 ? one : many); }

function keysLine_(tp) {
  var parts = [];
  if (hasVal_(tp.keys_entry)) parts.push(plural_(tp.keys_entry, 'entry key', 'entry keys') + ' left (' + REQUIRED_ENTRY_KEYS + ' required).');
  if (hasVal_(tp.keys_mailbox)) parts.push(plural_(tp.keys_mailbox, 'mailbox key', 'mailbox keys') + ' left.');
  if (hasVal_(tp.remotes_garage)) parts.push(plural_(tp.remotes_garage, 'garage remote', 'garage remotes') + ' left.');
  if (tp.rekey === 'Re-key' || tp.rekey === 'Replace') parts.push(tp.rekey + ' entry lock' + (hasVal_(tp.lock_type) ? ' (' + String(tp.lock_type).trim() + ')' : '') + '.');
  if (hasVal_(tp.keys_other)) parts.push('Other keys: ' + sentence_(tp.keys_other));
  if (!parts.length) return '';
  return 'Keys: ' + parts.join(' ') + (tp.keys_charge ? ' (Charge Tenant)' : '');
}

// America/Detroit = US Eastern rules (DST from 2nd Sunday of March 2:00 to 1st Sunday of November 2:00).
// Done by hand so the output never depends on the runtime's time-zone data.
function detroitParts_(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  var y = d.getUTCFullYear();
  var nthSunday = function (month, n) { var first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
  var dstStart = Date.UTC(y, 2, nthSunday(2, 2), 7), dstEnd = Date.UTC(y, 10, nthSunday(10, 1), 6);
  var off = d.getTime() >= dstStart && d.getTime() < dstEnd ? -4 : -5;
  var l = new Date(d.getTime() + off * 3600000);
  var h = l.getUTCHours(), m = l.getUTCMinutes();
  return {
    date: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][l.getUTCDay()] + ' ' +
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][l.getUTCMonth()] + ' ' + l.getUTCDate() + ', ' + l.getUTCFullYear(),
    time: ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM')
  };
}

function pmiTimeLine_(timer) {
  if (!timer || !timer.start || !timer.end) return '';
  var a = detroitParts_(timer.start), b = detroitParts_(timer.end);
  if (!a || !b) return '';
  var hours = Math.round((new Date(timer.end) - new Date(timer.start)) / 360000) / 10;
  return 'PMI time: ' + a.date + ' ' + a.time + ' to ' + (b.date === a.date ? '' : b.date + ' ') + b.time + ' (' + hours + ' h)';
}

function textToHtml_(text) {
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  return text.split('\n\n').map(function (block) {
    if (block === '---- Not for the work order ----') return '<hr>';
    return '<p>' + block.split('\n').map(esc).join('<br>') + '</p>';
  }).join('\n');
}

/** turn = p03_turns row, rooms = room definitions (CHECK_ROOMS_SERVER, expanded per bedrooms/bathrooms), settings = p03_turn_settings value. */
function describeTechPrep(turn, rooms, settings) {
  var tp = turn.tech_prep || {};
  var cl = tp.checklist || {};
  var instances = roomInstancesServer_(tp, rooms || CHECK_ROOMS_SERVER);

  // Top block: ready to paste into the AppFolio Unit Turn WO.
  var top = [], notChecked = [];
  instances.forEach(function (r) {
    var st = cl[r.id] || {}, fixes = [];
    r.items.forEach(function (item, ii) {
      var e = st[ii];
      if (!e) return;
      if (e.s === 'fix') fixes.push(sentence_(hasVal_(e.note) ? e.note : item) + (e.charge ? ' (Charge Tenant)' : ''));
      if (e.s === 'nc') notChecked.push('- ' + r.label + ': ' + item + (hasVal_(e.note) ? ' (' + String(e.note).trim() + ')' : ''));
    });
    if (fixes.length) top.push(r.label + ': ' + fixes.join(' '));
  });
  var keys = keysLine_(tp);
  if (keys) top.push(keys);
  if (!top.length) top.push('No repairs found at the PMI.');

  // Below the divider: for Spencer / the tech / Jason only.
  var below = [];
  var parts = (tp.parts || []).filter(function (p) { return p && hasVal_(p.item); }).map(function (p) {
    return '- ' + (hasVal_(p.qty) ? p.qty + ' x ' : '') + String(p.item).trim() + (hasVal_(p.store) ? ' (' + p.store + ')' : '');
  });
  if (hasVal_(tp.rekey_parts) && (tp.rekey === 'Re-key' || tp.rekey === 'Replace')) parts.push('- Lock parts: ' + String(tp.rekey_parts).trim());
  if (hasVal_(tp.blinds_count) || hasVal_(tp.blinds_sizes)) parts.push('Blinds to replace: ' + (hasVal_(tp.blinds_count) ? tp.blinds_count : '?') + (hasVal_(tp.blinds_sizes) ? ' (sizes: ' + String(tp.blinds_sizes).trim() + ')' : ''));
  if (hasVal_(tp.furnace_filter_size)) parts.push('Furnace filter size: ' + String(tp.furnace_filter_size).trim());
  if (parts.length) below.push('Parts to order:\n' + parts.join('\n'));
  if (notChecked.length) below.push('Not checked at the PMI:\n' + notChecked.join('\n'));
  var misc = [];
  if (hasVal_(tp.tech_hours)) misc.push('Tech hours estimate: ' + tp.tech_hours);
  var pmi = pmiTimeLine_(tp.pmi_timer || (turn.scope && turn.scope.pmi_timer));
  if (pmi) misc.push(pmi);
  if (hasVal_(tp.done_by)) misc.push('Filled by: ' + tp.done_by);
  if (misc.length) below.push(misc.join('\n'));

  var text = top.join('\n\n') + (below.length ? '\n\n---- Not for the work order ----\n\n' + below.join('\n\n') : '');
  var subject = 'Turn WO description: ' + [turn.property_label, turn.unit_label].filter(hasVal_).join(' ') +
    (hasVal_(turn.af_wo_number) ? ' (WO ' + turn.af_wo_number + ')' : '');
  return { subject: subject, text: text, html: textToHtml_(text) };
}

/** Everything apiSendTechPrepEmail sends: recipients + subject/body, test mode applied. */
function buildTechPrepMail(turn, settings, testTo) {
  var d = describeTechPrep(turn, CHECK_ROOMS_SERVER, settings);
  var r = techPrepRecipients(turn, settings, testTo);
  var text = r.testNote ? r.testNote + '\n\n' + d.text : d.text;
  return { to: r.to, cc: r.cc, subject: (r.testNote ? '[TEST] ' : '') + d.subject, text: text, html: textToHtml_(text) };
}

// ---------- Move-out scope change email (apiSendMoveOutEmail in Code.js) ----------

// Business days = weekdays minus Fed bank holidays. Copy of holidays()/isBiz()/bizDiff() in Engine.html;
// describe.test.js compares bizDiffServer_ with Engine.bizDiff over two years so they can't drift.
function isoUtc_(d) { return d.toISOString().slice(0, 10); }
function parseUtc_(s) { var p = String(s).slice(0, 10).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function holidaysServer_(y) {
  var nth = function (m, wd, n) {
    if (n > 0) { var f = new Date(Date.UTC(y, m, 1)).getUTCDay(); return new Date(Date.UTC(y, m, 1 + ((wd - f + 7) % 7) + 7 * (n - 1))); }
    var l = new Date(Date.UTC(y, m + 1, 0)); return new Date(Date.UTC(y, m, l.getUTCDate() - ((l.getUTCDay() - wd + 7) % 7)));
  };
  var fixed = function (m, day) { var d = new Date(Date.UTC(y, m, day)); return d.getUTCDay() === 0 ? new Date(Date.UTC(y, m, day + 1)) : d; };
  var set = {};
  [fixed(0, 1), nth(0, 1, 3), nth(1, 1, 3), nth(4, 1, -1), fixed(5, 19), fixed(6, 4), nth(8, 1, 1), nth(9, 1, 2), fixed(10, 11), nth(10, 4, 4), fixed(11, 25)]
    .forEach(function (d) { if (d.getUTCDay() !== 6) set[isoUtc_(d)] = true; });
  return set;
}
function isBizServer_(s) { var d = parseUtc_(s), w = d.getUTCDay(); return w !== 0 && w !== 6 && !holidaysServer_(d.getUTCFullYear())[s]; }
function bizDiffServer_(a, b) {
  var sign = a < b ? 1 : -1, n = 0, s = a;
  while (s !== b) { s = isoUtc_(new Date(parseUtc_(s).getTime() + sign * 86400000)); if (isBizServer_(s)) n++; }
  return n * sign;
}
// Same output as Engine.fmt: "Mon Nov 9".
function fmtDay_(s) {
  if (!hasVal_(s)) return 'not scheduled';
  var d = parseUtc_(s);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate();
}

function rentReadyLine_(a, b) {
  if (!hasVal_(a) || !hasVal_(b)) return 'Scope changed at move-out. Rent ready is now ' + fmtDay_(b) + '.';
  if (a === b) return 'Scope changed at move-out. Rent ready stays ' + fmtDay_(a) + '.';
  var n = bizDiffServer_(a, b);
  return 'Scope changed at move-out. Rent ready moves ' + (n < 0 ? 'earlier, ' : '') + 'from ' + fmtDay_(a) + ' to ' + fmtDay_(b) +
    ' (' + (n < 0 ? '-' : '+') + plural_(Math.abs(n), 'business day', 'business days') + ').';
}

function changeLine_(c, catalog) {
  var cat = catalog.filter(function (x) { return x.key === c.trade; })[0];
  var trade = cat ? cat.label : String(c.trade || '');
  var sz = cat && (cat.sizes || []).filter(function (x) { return x.id === c.size; })[0];
  var size = sz ? sz.label : String(c.size || '');
  var note = hasVal_(c.note) ? String(c.note).trim() : '';
  if (c.type === 'tech') return '- New tech item: ' + note + (hasVal_(c.hours) ? ' (+' + c.hours + ' h)' : '');
  if (c.type === 'vendor') return '- Other vendor item: ' + note;
  var line = c.type === 'add' ? 'Add ' + trade + (size ? ' (' + size + ')' : '')
    : c.type === 'resize' ? trade + ': size now ' + size
    : c.type === 'remove' ? 'Remove ' + trade : String(c.type || '') + ' ' + trade;
  return '- ' + line + (note ? ' - ' + note : '');
}

function movedLine_(m) {
  // The Tech step's vendor is a person: never name them in the body.
  var vendor = m.key === 'tech' || /riley/i.test(m.vendor || '') ? '' : String(m.vendor || '').trim();
  return '- ' + m.label + (vendor ? ' - ' + vendor : '') + ': ' + fmtDay_(m.before) + ' -> ' + (m.after === null ? 'removed' : fmtDay_(m.after));
}

/** turn = p03_turns row with move_out_check.impact; settings = p03_turn_settings value (catalog gives trade/size labels). */
function describeMoveOut(turn, settings) {
  var mo = turn.move_out_check || {}, imp = mo.impact || {};
  var catalog = (settings && settings.catalog) || [];
  var moved = imp.moved || [];
  var confirmed = moved.filter(function (m) { return m.was_confirmed; }).map(movedLine_);
  var other = moved.filter(function (m) { return !m.was_confirmed; }).map(movedLine_);
  var blocks = [rentReadyLine_(imp.rr_before, imp.rr_after)];
  var changes = (mo.changes || []).map(function (c) { return changeLine_(c, catalog); });
  if (changes.length) blocks.push('Changes:\n' + changes.join('\n'));
  blocks.push('Vendors to re-contact (were confirmed):\n' + (confirmed.length ? confirmed.join('\n') : 'No confirmed vendors moved.'));
  if (other.length) blocks.push('Other dates that moved:\n' + other.join('\n'));
  var text = blocks.join('\n\n');
  var subject = 'Turn schedule changed: ' + [turn.property_label, turn.unit_label].filter(hasVal_).join(' ') +
    (hasVal_(turn.af_wo_number) ? ' (WO ' + turn.af_wo_number + ')' : '');
  return { subject: subject, text: text, html: textToHtml_(text) };
}

/** Everything apiSendMoveOutEmail sends; same recipients + test switch as the Tech Prep email. */
function buildMoveOutMail(turn, settings, testTo) {
  var d = describeMoveOut(turn, settings);
  var r = techPrepRecipients(turn, settings, testTo);
  var text = r.testNote ? r.testNote + '\n\n' + d.text : d.text;
  return { to: r.to, cc: r.cc, subject: (r.testNote ? '[TEST] ' : '') + d.subject, text: text, html: textToHtml_(text) };
}

// ---------- Move-out alert: scope changed, NOT applied (apiSendMoveOutAlert in Code.js) ----------

function wouldRentReadyLine_(a, b) {
  if (!hasVal_(a) || !hasVal_(b)) return 'If applied, rent ready would be ' + fmtDay_(b) + '.';
  if (a === b) return 'If applied, rent ready would stay ' + fmtDay_(a) + '.';
  var n = bizDiffServer_(a, b);
  return 'If applied, rent ready would move ' + (n < 0 ? 'earlier, ' : '') + 'from ' + fmtDay_(a) + ' to ' + fmtDay_(b) +
    ' (' + (n < 0 ? '-' : '+') + plural_(Math.abs(n), 'business day', 'business days') + ').';
}

/** turn = p03_turns row with move_out_check.pending_impact (the client's preview, saved at submit). */
function describeMoveOutAlert(turn, settings) {
  var mo = turn.move_out_check || {}, imp = mo.pending_impact || {};
  var catalog = (settings && settings.catalog) || [];
  var who = mo.done_by === 'Spencer' ? 'Spencer submitted the move-out check' : 'The move-out check was submitted';
  var blocks = [who + ': the scope changed, but the schedule has NOT been updated yet. Open the turn and tap Apply to schedule.',
    wouldRentReadyLine_(imp.rr_before, imp.rr_after)];
  var changes = (mo.changes || []).map(function (c) { return changeLine_(c, catalog); });
  if (changes.length) blocks.push('Changes:\n' + changes.join('\n'));
  var confirmed = (imp.moved || []).filter(function (m) { return m.was_confirmed; }).map(movedLine_);
  blocks.push(confirmed.length ? 'Confirmed vendors that would need a new date:\n' + confirmed.join('\n') : 'No confirmed vendors would move.');
  var text = blocks.join('\n\n');
  var subject = 'Turn scope changed, NOT applied: ' + [turn.property_label, turn.unit_label].filter(hasVal_).join(' ') +
    (hasVal_(turn.af_wo_number) ? ' (WO ' + turn.af_wo_number + ')' : '');
  return { subject: subject, text: text, html: textToHtml_(text) };
}

/** Everything apiSendMoveOutAlert sends; same recipients + test switch as the other emails. */
function buildMoveOutAlertMail(turn, settings, testTo) {
  var d = describeMoveOutAlert(turn, settings);
  var r = techPrepRecipients(turn, settings, testTo);
  var text = r.testNote ? r.testNote + '\n\n' + d.text : d.text;
  return { to: r.to, cc: r.cc, subject: (r.testNote ? '[TEST] ' : '') + d.subject, text: text, html: textToHtml_(text) };
}
