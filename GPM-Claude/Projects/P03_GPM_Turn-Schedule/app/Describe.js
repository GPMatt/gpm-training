/**
 * Email builders (pure functions, no GAS services): Tech Prep WO description, schedule, move-out, calendar events.
 * Called by the api* functions in Code.js. Tested by app-test/describe.test.js.
 */

// Server copy of CHECK_ROOMS in Config.html. Keep identical: describe.test.js fails if they drift.
var CHECK_ROOMS_SERVER = [
  // Items match Jason's "TURN checklist 2026" (Drive 1CQD_TPlhFzpN3wyr3NTS4-0Dk6gzmSpdhwQrSywkutU) room by room.
  { id: 'exterior', label: 'Exterior', items: ['Garage opener', '1 remote per door', 'Garage service door', '2 GPM entry keys', 'Garage / storage room for items left behind', 'Porch light'] },
  { id: 'entry', label: 'Entry', items: ['Mailbox key', 'Entry lock', '2 key min', 'Door latches', 'Hallway light', 'Closet door / shelves'] },
  { id: 'living', label: 'Living room', items: ['Window panes', 'Window screens', 'Window locks', 'Window blinds', 'Outlets have power', 'Outlet / switch covers', 'Light fixture', 'HVAC vents (replace / paint)', 'Thermostat (heat / A/C)', 'Smoke / CO2 (outside bedroom)'] },
  { id: 'kitchen', label: 'Kitchen', items: ['Light above sink', 'Run dishwasher', 'Disposal', 'Faucet', 'Drains under sink', 'Stove / oven', 'Drip pans', 'Hood filter', 'Microwave', 'Fridge / freezer', 'Countertops', 'Cabinets / drawers', 'GFCI protecting', 'Outlet / switch covers'] },
  { id: 'basement', label: 'Basement', items: ['Smoke detector', 'Furnace filter', 'Washer', 'Dryer', 'Utility sink', 'Lights'] },
  { id: 'bath', label: 'Bathroom', repeat: 'bathrooms', items: ['Light / vent fan', 'Tub faucet', 'Tub drain', 'Tub stopper', 'Shower caulk', 'Shower curtain', 'Shower bar', 'Toilet drain / fill', 'Bolt caps on toilet', 'Toilet seat / hinges', 'Vanity faucet', 'Vanity drain', 'Toilet paper bar', 'Towel bar', 'GFCI protecting', 'Outlet / switch covers'] },
  { id: 'bed', label: 'Bedroom', repeat: 'bedrooms', items: ['Door latches', 'Window panes', 'Window screens', 'Window locks', 'Window blinds', 'Outlets have power', 'Outlet / switch covers', 'Light fixture', 'Smoke detector', 'Closet door latches', 'Closet hardware'] }
];

var REQUIRED_ENTRY_KEYS = 2;

// Run 2 (2026-11-11): app emails go only to Jason + Spencer (+ Matt on cc for the move-out email). Never a tech or vendor.
var TEAM_TO = ['jason@greenpropertymgt.com', 'spencer@greenpropertymgt.com'];
var MOVE_OUT_CC = ['matt@greenpropertymgt.com'];

/** Wraps real recipients for the EMAIL_TEST_TO switch: only testTo, no cc, plus a note naming the real ones. */
function applyTestTo_(to, cc, testTo) {
  testTo = String(testTo || '').trim();
  if (!testTo) return { to: to, cc: cc, testNote: '' };
  return { to: [testTo], cc: [], testNote: 'TEST: real recipients would be To: ' + to.join(', ') + (cc.length ? '; Cc: ' + cc.join(', ') : '') };
}

/** EMAIL_TEST_TO cleanup: strips whitespace + trailing punctuation; '' = off; throws when not an email. */
function cleanTestTo(v) {
  var s = String(v || '').replace(/\s+/g, '').replace(/[.,;:!?'")\]>]+$/, '').replace(/^[<'"(\[]+/, '');
  if (!s) return '';
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) throw new Error('EMAIL_TEST_TO is not a valid email: ' + v);
  return s.toLowerCase();
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

var FILLER_WORDS_ = { the: 1, a: 1, an: 1, on: 1, in: 1, of: 1, per: 1, to: 1, for: 1, and: 1, or: 1, at: 1, with: 1, is: 1, are: 1, min: 1 };

/** Main words of a checklist item, lowercased, plural 's' dropped ("Window blinds" -> window, blind). */
function itemWords_(item) {
  return String(item || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
    return w && !FILLER_WORDS_[w] && !/^\d+$/.test(w);
  }).map(function (w) { return w.length > 3 ? w.replace(/s$/, '') : w; });
}

/**
 * One Fix line: the note alone when it already names the item (shares a main word), else "<Item> - <note>".
 * No note = the item name. Always a sentence ("Faucet - new one.").
 */
function fixText_(item, note) {
  if (!hasVal_(note)) return sentence_(item);
  note = String(note).trim();
  var noteWords = itemWords_(note);
  var named = itemWords_(item).some(function (w) { return noteWords.indexOf(w) >= 0; });
  if (named) return sentence_(note);
  var first = note.split(/\s+/)[0];
  if (first !== first.toUpperCase()) note = note.charAt(0).toLowerCase() + note.slice(1); // keep "GFCI ..." as is
  return sentence_(item + ' - ' + note);
}

/** tech_prep.rooms_off: room instance ids left out of the walk (array, or {id: true}). */
function roomsOff_(tp) {
  var off = {}, v = tp.rooms_off;
  if (Array.isArray(v)) v.forEach(function (id) { off[id] = true; });
  else if (v && typeof v === 'object') Object.keys(v).forEach(function (id) { if (v[id]) off[id] = true; });
  return off;
}

/** turn = p03_turns row, rooms = room definitions (CHECK_ROOMS_SERVER, expanded per bedrooms/bathrooms), settings = p03_turn_settings value. */
function describeTechPrep(turn, rooms, settings) {
  var tp = turn.tech_prep || {};
  var cl = tp.checklist || {};
  var instances = roomInstancesServer_(tp, rooms || CHECK_ROOMS_SERVER);

  // Top block: ready to paste into the AppFolio Unit Turn WO.
  var top = [], notChecked = [];
  var off = roomsOff_(tp);
  instances.forEach(function (r) {
    if (off[r.id]) return;
    var st = cl[r.id] || {}, fixes = [];
    r.items.forEach(function (item, ii) {
      var e = st[ii];
      if (!e) return;
      if (e.s === 'fix') fixes.push(fixText_(item, e.note) + (e.charge ? ' (Charge Tenant)' : ''));
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
  var blinds = (tp.blinds || []).filter(function (b) { return b && (hasVal_(b.room) || hasVal_(b.window) || hasVal_(b.size)); });
  if (blinds.length) {
    var roomLabel = {};
    instances.forEach(function (r) { roomLabel[r.id] = r.label; });
    parts.push('- Blinds to replace: ' + blinds.length);
    blinds.forEach(function (b) {
      var where = [hasVal_(b.room) ? roomLabel[b.room] || String(b.room).trim() : '', hasVal_(b.window) ? String(b.window).trim() : ''].filter(Boolean).join(', ');
      parts.push('  - ' + where + (where && hasVal_(b.size) ? ': ' : '') + (hasVal_(b.size) ? String(b.size).trim() : ''));
    });
  } else if (hasVal_(tp.blinds_count) || hasVal_(tp.blinds_sizes)) parts.push('- Blinds to replace: ' + (hasVal_(tp.blinds_count) ? tp.blinds_count : '?') + (hasVal_(tp.blinds_sizes) ? ' (sizes: ' + String(tp.blinds_sizes).trim() + ')' : ''));
  if (hasVal_(tp.furnace_filter_size)) parts.push('- Furnace filter size: ' + String(tp.furnace_filter_size).trim());
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
  // paste = only the part above the divider: what Spencer copies into the AppFolio Unit Turn WO (V1 copy button)
  return { subject: subject, text: text, html: textToHtml_(text), paste: top.join('\n\n') };
}

/** "Email schedule to Jason + Spencer": the schedule text the old Copy button put on the clipboard. */
function buildScheduleMail(turn, text, testTo) {
  var r = applyTestTo_(TEAM_TO, [], testTo);
  var body = (r.testNote ? r.testNote + '\n\n' : '') + String(text || '').trim();
  return { to: r.to, cc: r.cc, subject: (r.testNote ? '[TEST] ' : '') + 'Turn schedule: ' + placeOf_(turn), text: body, html: textToHtml_(body) };
}

/** Everything apiSendTechPrepEmail sends: recipients + subject/body, test mode applied. */
function buildTechPrepMail(turn, settings, testTo) {
  var d = describeTechPrep(turn, CHECK_ROOMS_SERVER, settings);
  var r = applyTestTo_(TEAM_TO, [], testTo);
  var text = r.testNote ? r.testNote + '\n\n' + d.text : d.text;
  return { to: r.to, cc: r.cc, subject: (r.testNote ? '[TEST] ' : '') + d.subject, text: text, html: textToHtml_(text) };
}

// ---------- Move-out scope change email (apiSendMoveOutEmail in Code.js) ----------

// Business days = weekdays minus the 6 vendor holidays. Copy of holidays()/isBiz()/bizDiff() in Engine.html;
// describe.test.js compares bizDiffServer_ with Engine.bizDiff over two years so they can't drift.
function isoUtc_(d) { return d.toISOString().slice(0, 10); }
function parseUtc_(s) { var p = String(s).slice(0, 10).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function holidaysServer_(y) {
  // Same 6 vendor holidays + weekend rule as holidays() in Engine.html (Sat -> Fri, Sun -> Mon).
  var nth = function (m, wd, n) {
    if (n > 0) { var f = new Date(Date.UTC(y, m, 1)).getUTCDay(); return new Date(Date.UTC(y, m, 1 + ((wd - f + 7) % 7) + 7 * (n - 1))); }
    var l = new Date(Date.UTC(y, m + 1, 0)); return new Date(Date.UTC(y, m, l.getUTCDate() - ((l.getUTCDay() - wd + 7) % 7)));
  };
  var obs = function (d) { var w = d.getUTCDay(); return new Date(d.getTime() + (w === 6 ? -1 : w === 0 ? 1 : 0) * 86400000); };
  var set = {};
  [new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)), nth(4, 1, -1), new Date(Date.UTC(y, 6, 4)), nth(8, 1, 1), nth(10, 4, 4), new Date(Date.UTC(y, 11, 25))]
    .forEach(function (d) { var o = obs(d); if (o.getUTCFullYear() === y) set[isoUtc_(o)] = true; });
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
  if (!hasVal_(a) || !hasVal_(b)) return 'Rent ready is now ' + fmtDay_(b) + '.';
  if (a === b) return 'Rent ready stays ' + fmtDay_(a) + '.';
  var n = bizDiffServer_(a, b);
  return 'Rent ready moves ' + (n < 0 ? 'earlier, ' : '') + 'from ' + fmtDay_(a) + ' to ' + fmtDay_(b) +
    ' (' + (n < 0 ? '-' : '+') + plural_(Math.abs(n), 'business day', 'business days') + ').';
}

function wouldRentReadyLine_(a, b) {
  if (!hasVal_(a) || !hasVal_(b)) return 'If applied, rent ready would be ' + fmtDay_(b) + '.';
  if (a === b) return 'If applied, rent ready would stay ' + fmtDay_(a) + '.';
  var n = bizDiffServer_(a, b);
  return 'If applied, rent ready would move ' + (n < 0 ? 'earlier, ' : '') + 'from ' + fmtDay_(a) + ' to ' + fmtDay_(b) +
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

/** One moved step, vendor named (techs included: the email goes to Jason, Spencer and Matt only). */
function movedLine_(m) {
  var vendor = String(m.vendor || '').trim();
  return '- ' + m.label + (vendor ? ' - ' + vendor : '') + ': ' + fmtDay_(m.before) + ' -> ' + (m.after === null ? 'removed' : fmtDay_(m.after));
}

var STATUS_LABEL_SERVER = { open: 'Not booked', booked: 'Confirmed', done: 'Done', resched: 'Reschedule' };
var REVIEW_WINDOW_BIZ_DAYS = 15;

function placeOf_(t) { return [t.property_label, t.unit_label].filter(hasVal_).join(' '); }

function withinBiz_(a, b, n) {
  if (!hasVal_(a) || !hasVal_(b)) return false;
  if (Math.abs(parseUtc_(a) - parseUtc_(b)) > 40 * 86400000) return false; // 15 business days < 40 calendar days
  return Math.abs(bizDiffServer_(a, b)) <= n;
}

/** The moved confirmed vendors' steps on other open turns within 15 business days of the old or new date, sorted by date. */
function sameVendorLines_(turn, moved, otherTurns) {
  var seen = {}, rows = [];
  moved.forEach(function (m) {
    var v = String(m.vendor || '').trim().toLowerCase();
    if (!v) return;
    (otherTurns || []).forEach(function (o) {
      if (o.id === turn.id || o.archived) return;
      (o.steps || []).forEach(function (s, i) {
        var id = o.id + ':' + i;
        if (seen[id] || String(s.vendor || '').trim().toLowerCase() !== v) return;
        if (!withinBiz_(s.start, m.before, REVIEW_WINDOW_BIZ_DAYS) && !withinBiz_(s.start, m.after, REVIEW_WINDOW_BIZ_DAYS)) return;
        seen[id] = true;
        var who = String(m.vendor).trim();
        rows.push({ sort: s.start + '|' + who + '|' + placeOf_(o), line: '- ' + who + ': ' + fmtDay_(s.start) + ' ' + s.label + ' at ' + placeOf_(o) + ' (' + (STATUS_LABEL_SERVER[s.status] || s.status || '') + ')' });
      });
    });
  });
  rows.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
  return rows.map(function (r) { return r.line; });
}

/**
 * Run 2 (2026-11-11): the ONE move-out email (replaces schedule changed / NOT applied alert / conflict review).
 * impact = move_out_check.impact (applied = true) or move_out_check.pending_impact (applied = false);
 * otherTurns = open p03_turns rows (id, property_label, unit_label, steps), only read when a confirmed vendor moved.
 */
function describeMoveOutMail(turn, impact, applied, otherTurns, settings) {
  var mo = turn.move_out_check || {}, imp = impact || {};
  var catalog = (settings && settings.catalog) || [];
  var moved = imp.moved || [];
  var confirmed = moved.filter(function (m) { return m.was_confirmed; });
  var blocks = [applied ? 'Scope changed at move-out; the schedule has been updated.'
    : 'Scope changed at move-out; the schedule has NOT been updated yet. Open the turn and tap Apply to schedule.',
    (applied ? rentReadyLine_ : wouldRentReadyLine_)(imp.rr_before, imp.rr_after)];
  var changes = (mo.changes || []).map(function (c) { return changeLine_(c, catalog); });
  if (changes.length) blocks.push('Changes:\n' + changes.join('\n'));
  if (confirmed.length) blocks.push((applied ? 'Confirmed vendors whose date moved:' : 'Confirmed vendors whose date would move:') + '\n' + confirmed.map(movedLine_).join('\n'));
  else blocks.push(applied ? 'No confirmed vendors moved.' : 'No confirmed vendors would move.');
  var other = moved.filter(function (m) { return !m.was_confirmed; }).map(movedLine_);
  if (applied && other.length) blocks.push('Other dates that moved:\n' + other.join('\n'));
  if (confirmed.length) {
    var rows = sameVendorLines_(turn, confirmed, otherTurns);
    blocks.push('Same vendors on other open turns (within ' + REVIEW_WINDOW_BIZ_DAYS + ' business days):\n' + (rows.length ? rows.join('\n') : 'None found'));
  }
  var text = blocks.join('\n\n');
  var subject = (applied ? 'Turn schedule changed: ' : 'Turn scope changed, NOT applied: ') + placeOf_(turn) +
    (hasVal_(turn.af_wo_number) ? ' (WO ' + turn.af_wo_number + ')' : '');
  return { subject: subject, text: text, html: textToHtml_(text) };
}

/** Everything apiSendMoveOutEmail sends: To Jason + Spencer, cc Matt, test switch applied. */
function buildMoveOutMail(turn, impact, applied, otherTurns, settings, testTo) {
  var d = describeMoveOutMail(turn, impact, applied, otherTurns, settings);
  var r = applyTestTo_(TEAM_TO, MOVE_OUT_CC, testTo);
  var text = r.testNote ? r.testNote + '\n\n' + d.text : d.text;
  return { to: r.to, cc: r.cc, subject: (r.testNote ? '[TEST] ' : '') + d.subject, text: text, html: textToHtml_(text) };
}

// ---------- R4.6 Google Calendar: event list for a turn (synced by syncTurnCalendar_ in Code.js) ----------

function addDaysIso_(s, n) { return isoUtc_(new Date(parseUtc_(s).getTime() + n * 86400000)); }

/**
 * One event per step with a start date + one Rent ready event. All-day events: start..end inclusive,
 * endExclusive = end + 1 day. A one-day step with a start time is timed: time .. time + hours (8 if unset, max 12).
 * key = step key ('#2' suffix on duplicates), '_rentready' for rent ready.
 */
function calendarEvents(turn, appUrl) {
  var place = placeOf_(turn), out = [], used = {};
  // Rent ready only on the Rent ready event, so a rent-ready change doesn't rewrite every step event.
  var info = function (status, rr) {
    return [status ? 'Status: ' + status : '', hasVal_(turn.af_wo_number) ? 'WO: ' + turn.af_wo_number : '',
      rr ? 'Rent ready: ' + fmtDay_(turn.rent_ready_date) : '', appUrl ? 'GPM Turns: ' + appUrl : ''].filter(Boolean).join('\n');
  };
  (turn.steps || []).forEach(function (s) {
    if (!hasVal_(s.start)) return;
    var key = s.key || 'step';
    used[key] = (used[key] || 0) + 1;
    if (used[key] > 1) key += '#' + used[key];
    var end = hasVal_(s.end) && s.end >= s.start ? s.end : s.start;
    var title = (s.status === 'done' ? '✓ ' : '') + s.label + ' · ' + (hasVal_(s.vendor) ? String(s.vendor).trim() : 'no vendor') + ' · ' + place +
      (s.status === 'resched' ? ' [Reschedule]' : s.status === 'open' || !s.status ? ' [Not booked]' : '');
    var ev = { key: key, title: title, description: info(STATUS_LABEL_SERVER[s.status] || 'Not booked') };
    if (end === s.start && /^\d{1,2}:\d{2}$/.test(s.time || '')) {
      var p = s.time.split(':'), startMin = +p[0] * 60 + +p[1];
      var h = Number(s.hours) > 0 && Number(s.hours) <= 12 ? Number(s.hours) : 8;
      var endMin = Math.min(startMin + Math.round(h * 60), 23 * 60 + 59);
      var hm = function (m) { return (m < 600 ? '0' : '') + Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60); };
      ev.allDay = false; ev.start = s.start + ' ' + hm(startMin); ev.end = s.start + ' ' + hm(endMin);
    } else {
      ev.allDay = true; ev.start = s.start; ev.end = addDaysIso_(end, 1);
    }
    out.push(ev);
  });
  (turn.steps || []).forEach(function (s, i) { // Eastpointe measure day (1 week before the flooring install)
    if (!hasVal_(s.measure)) return;
    out.push({ key: '_measure' + i, title: 'Flooring measure · ' + (hasVal_(s.vendor) ? String(s.vendor).trim() : 'Eastpointe') + ' · ' + place,
      description: info('Install ' + fmtDay_(s.start)), allDay: true, start: s.measure, end: addDaysIso_(s.measure, 1) });
  });
  if (hasVal_(turn.rent_ready_date)) {
    out.push({ key: '_rentready', title: 'Rent ready · ' + place, description: info('', true), allDay: true,
      start: turn.rent_ready_date, end: addDaysIso_(turn.rent_ready_date, 1) });
  }
  return out;
}

/** Short fingerprint of an event so unchanged events are not re-written on every save. */
function eventHash(ev) {
  var s = JSON.stringify([ev.title, ev.description, ev.allDay, ev.start, ev.end]), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
