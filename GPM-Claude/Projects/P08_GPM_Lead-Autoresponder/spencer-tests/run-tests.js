// Local tests for the Spencer showing pre-screen (../spencer-live).
//
//   node run-tests.js        (from this folder; run before every clasp push)
//
// Loads the real .js files into a sandbox with in-memory fakes for Gmail,
// Sheets, Forms and Script Properties — nothing here touches Google. Lives
// outside spencer-live on purpose: clasp pushes every .js under that folder.
// Email bodies are modelled on real AppFolio emails captured by
// diagnoseShowingPairing() on 2026-10-05.

process.env.TZ = 'America/Detroit';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIVE = path.join(__dirname, '..', 'spencer-live');
const MIN = 60000, DAY = 86400000;
const RESP_ID = 'resp-sheet', UNITS_ID = 'units-sheet', FORM_ID = 'form-1';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeWorld() {
  const w = {
    messages: [], sent: [], replies: [], props: {}, sheets: {}, created: [],
    failFormOpen: false, failSendTo: null, failAppendOnce: false, failSheetOpen: null, idSeq: 0,
    cache: {}, bodyReads: {}, failCache: false
  };
  w.props.PRESCREEN_FORM_ID = FORM_ID;
  w.props.PRESCREEN_RESPONSES_SHEET_ID = RESP_ID;
  w.props.UNITS_SHEET_ID = UNITS_ID;
  w.sheets[RESP_ID] = {};
  w.sheets[UNITS_ID] = {
    Requirements: [
      ['PropertyKey', 'Credit', 'Income', 'Beds', 'Min Rent by Bedroom'],
      ['GRAND_CENTRAL_LOFTS', 625, '3x', 0, 1000],
      ['GRAND_CENTRAL_LOFTS', 625, '3x', 1, 1400],
      ['WEALTHY_SHELDON', 625, '3x', 0, 1300],
      ['WEALTHY_SHELDON', 625, '3x', 3, '']
    ]
  };
  return w;
}

function fakeSheet(w, ssId, name) {
  const rows = () => w.sheets[ssId][name];
  return {
    appendRow(r) {
      if (w.failAppendOnce) { w.failAppendOnce = false; throw new Error('Service Spreadsheets failed'); }
      rows().push(r.slice());
    },
    getLastRow: () => rows().length,
    getLastColumn: () => (rows()[0] || []).length,
    setFrozenRows() {},
    clear() { w.sheets[ssId][name] = []; },
    getDataRange: () => ({ getValues: () => rows().map(r => r.slice()) }),
    getRange(r, c, nr, nc) {
      return {
        getValues: () => rows().slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
        setValue(v) { const row = rows()[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; },
        setValues(vals) { vals.forEach((x, i) => { rows()[r - 1 + i] = x.slice(); }); }
      };
    }
  };
}

function fakeMessage(w, m) {
  m.id = m.id || 'm' + (++w.idSeq);
  m.unread = m.unread !== false;
  const api = {
    raw: m,
    getId: () => m.id, getDate: () => m.date, getSubject: () => m.subject || '',
    getBody: () => { w.bodyReads[m.id] = (w.bodyReads[m.id] || 0) + 1; return m.html || ''; }, getPlainBody: () => m.plain || '',
    getFrom: () => m.from || '', getReplyTo: () => m.replyTo || '', getTo: () => m.to || '',
    isUnread: () => m.unread, markRead() { m.unread = false; },
    reply(text) { w.replies.push({ to: m.from, text, inReplyTo: m.id }); }
  };
  return api;
}

function buildSandbox(w) {
  const within = (m, days) => Date.now() - m.date.getTime() <= days * DAY;
  const GmailApp = {
    search(q) {
      w.messages.forEach(m => { if (m.unread === undefined) m.unread = true; if (!m.id) m.id = 'm' + (++w.idSeq); });
      let hits;
      if (q.includes('New Showing Assignment')) {
        hits = w.messages.filter(m => /notifications@appfolio\.com/.test(m.from) && m.unread && within(m, 2));
      } else if (q.startsWith('from:guestcards@appfolio.com newer_than:2d')) {
        hits = w.messages.filter(m => /guestcards@appfolio\.com/.test(m.from) && within(m, 2));
      } else if (q.startsWith('from:guestcards@appfolio.com "')) {
        const last = q.match(/"([^"]+)"/)[1];
        hits = w.messages.filter(m => /guestcards@appfolio\.com/.test(m.from) && within(m, 30) &&
          (m.from + m.subject + m.html).toLowerCase().includes(last));
      } else if (q.includes('NEED EMAIL')) {
        hits = w.messages.filter(m => m.unread && /NEED EMAIL|NO EMAIL FOUND/.test(m.subject));
      } else if (q.includes('mailer-daemon')) {
        hits = w.messages.filter(m => m.unread && /mailer-daemon|postmaster/i.test(m.from));
      } else {
        throw new Error('fake GmailApp.search: unexpected query ' + q);
      }
      return hits.map(m => ({ getMessages: () => [fakeMessage(w, m)] }));
    },
    sendEmail(to, subject, body, opts) {
      if (w.failSendTo && to === w.failSendTo) throw new Error('Invalid email: ' + to);
      w.sent.push({ to, subject, html: (opts && opts.htmlBody) || '' });
    }
  };

  const SpreadsheetApp = {
    openById(id) {
      if (w.failSheetOpen === id) throw new Error('Service unavailable: Spreadsheets');
      if (!w.sheets[id]) throw new Error('no such spreadsheet ' + id);
      return {
        getSheetByName: n => (w.sheets[id][n] ? fakeSheet(w, id, n) : null),
        insertSheet(n) { w.sheets[id][n] = []; return fakeSheet(w, id, n); }
      };
    },
    create(name) { w.created.push('spreadsheet:' + name); throw new Error('TEST: SpreadsheetApp.create must never run at runtime'); }
  };

  const FormApp = {
    openById(id) {
      if (w.failFormOpen) throw new Error('Service unavailable: Forms');
      const item = t => ({
        getTitle: () => t,
        asTextItem: () => ({ createResponse: v => ({ t, v }) }),
        asMultipleChoiceItem: () => ({ createResponse: v => ({ t, v }) })
      });
      return {
        getItems: () => ['Full Name', 'Email Address', 'Property'].map(item),
        createResponse() {
          const parts = [];
          const r = {
            withItemResponse(x) { parts.push(x.t + '=' + x.v); return r; },
            toPrefilledUrl: () => 'https://forms.test/' + id + '?' + encodeURIComponent(parts.join('&'))
          };
          return r;
        },
        getPublishedUrl: () => 'https://forms.test/' + id,
        getDestinationId: () => RESP_ID
      };
    },
    create(name) { w.created.push('form:' + name); throw new Error('TEST: FormApp.create must never run at runtime'); }
  };

  const Utilities = {
    formatDate(d, tz, fmt) {
      if (fmt === 'yyyy-MM-dd') return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
      const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
      const h = d.getHours() % 12 || 12;
      return wd + ', ' + mo + ' ' + d.getDate() + ' at ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM');
    }
  };

  const sandbox = {
    GmailApp, SpreadsheetApp, FormApp, Utilities,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in w.props ? w.props[k] : null),
      setProperty(k, v) { w.props[k] = String(v); }
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({
      get(k) { if (w.failCache) throw new Error('TEST: cache down'); return k in w.cache ? w.cache[k] : null; },
      put(k, v) { if (w.failCache) throw new Error('TEST: cache down'); w.cache[k] = String(v); }
    }) },
    Logger: { log() {} },
    ScriptApp: {},
    // Sheets hands dates back as its own realm's Date; the code checks
    // `instanceof Date`, so the sandbox must share this realm's constructor.
    Date
  };
  vm.createContext(sandbox);
  ['Code.js', 'PreScreenForm.js', 'PreScreenSubmit.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(LIVE, f), 'utf8'), sandbox, { filename: f }));
  return sandbox;
}

// ---------------------------------------------------------------------------
// Sample emails
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function showingStart(daysOut) {
  const d = new Date(Date.now() + daysOut * DAY);
  d.setHours(13, 0, 0, 0);
  return d;
}

// mode: 'self' | 'staff' | 'system'
function showingEmail(o) {
  const start = o.start || showingStart(3);
  const lead = o.mode === 'staff' ? 'Spencer Green assigned you the following showing:'
    : o.mode === 'system' ? 'System assigned you the following showing:'
    : o.name + ' has scheduled a showing with you for the following:';
  const dateLine = o.badDate ? 'Date: sometime next week'
    : 'Date: ' + WEEKDAYS[start.getDay()] + ', ' + MONTHS[start.getMonth()] + ' ' + start.getDate() + ', ' + start.getFullYear();
  return {
    from: 'Green Property Management <notifications@appfolio.com>', to: 'spencer@greenpropertymgt.com',
    subject: 'New Showing Assignment - ' + (o.subjectUnit || '100 Commerce Ave SW  - 207'),
    date: new Date(Date.now() - (o.ageMin || 1) * MIN),
    html: '<div>New Showing Assignment</div><p>' + lead + '</p><p>' + dateLine + '</p><p>Time: 1:00pm EDT</p>' +
      '<p>Unit: ' + (o.unit || '100 Commerce Ave SW - 207 Grand Rapids, MI 49503') + '</p>' +
      '<p>Prospect: ' + o.name + ' ( <a href="https://sg.appfolio.com/ls/click">View guest card</a> )</p>'
  };
}

function guestCard(o) {
  return {
    from: o.name + ' <guestcards@appfolio.com>', replyTo: o.name + ' <' + o.email + '>', to: 'automation@greenpropertymgt.com',
    subject: 'New Interest on an existing guest card for ' + (o.subjectProp || 'Grand Central Lofts  - 207'),
    date: new Date(Date.now() - (o.ageMin || 1) * MIN), unread: true,
    html: '<div>CONTACT INFO</div><div>' + o.name + '</div><div>' + o.email + '</div><div>INTEREST INFO</div>'
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0, failed = 0;
function test(name, fn) {
  const w = makeWorld();
  const sb = buildSandbox(w);
  try { fn(w, sb); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error((label || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'assertion failed'); }

function showings(w) {
  const rows = w.sheets[RESP_ID].Showings || [];
  if (!rows.length) return [];
  return rows.slice(1).map(r => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));
}
const errors = w => (w.sheets[RESP_ID].Errors || []).slice(1).map(r => r[1]);
const toProspects = w => w.sent.filter(s => !/greenpropertymgt\.com$/.test(s.to));
const toSpencer = w => w.sent.filter(s => s.to === 'spencer@greenpropertymgt.com');
const toMatt = w => w.sent.filter(s => s.to === 'matt@greenpropertymgt.com');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('Name matching');
test('same name matches; nickname needs 4+ letters; last names must agree', (w, sb) => {
  const f = sb.namesLooselyMatch_;
  eq(f('Karen Patterson', 'Karen Patterson'), true, 'exact');
  eq(f('Matt Fournier', 'Matthieu Fournier'), true, 'matt/matthieu');
  eq(f('Al Green', 'Alex Green'), false, 'al/alex');
  eq(f('Sam Young', 'Samantha Young'), false, 'sam/samantha (3 letters)');
  eq(f('Karen Patterson', 'Yciara patterson'), false, 'different first name');
  eq(f('Karen Patterson', 'Karen Peterson'), false, 'different last name');
  eq(f('Olivia', 'Olivia'), false, 'single-word names never match');
});

console.log('Reading the AppFolio showing email');
test('self-booked, Zillow and staff-booked are told apart', (w, sb) => {
  const parse = o => sb.parseShowingEmail_(fakeMessage(w, showingEmail(o)));
  const self = parse({ mode: 'self', name: 'Olivia Zlydaszyk' });
  eq([self.name, self.unitKey, self.staffBooked, self.start.getHours()], ['Olivia Zlydaszyk', '207', false, 13], 'self');
  eq(parse({ mode: 'system', name: 'india young' }).staffBooked, false, 'system');
  eq(parse({ mode: 'staff', name: 'Savana Kotas' }).staffBooked, true, 'staff');
});
test('a showing at a property we do not handle is left untouched', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Pat Doe', subjectUnit: '2737 Burton St SE', unit: '2737 Burton St SE Grand Rapids' }));
  sb.showingWatcher();
  eq(w.sent.length, 0, 'emails sent');
  eq(w.messages[0].unread, true, 'still unread');
  eq(showings(w).length, 0, 'rows');
});

test('Wealthy and Sheldon: detected by name or address, unit codes normalize, suites skipped', (w, sb) => {
  const parse = o => sb.parseShowingEmail_(fakeMessage(w, showingEmail(Object.assign({ mode: 'self', name: 'Dana Wells' }, o))));
  const s = parse({ subjectUnit: '90 Wealthy Street SE - W 201', unit: '90 Wealthy Street SE - W 201 Grand Rapids, MI 49503' });
  eq([s.property.key, s.property.displayName, s.unitKey], ['WEALTHY_SHELDON', 'Wealthy and Sheldon', 'W201'], 'by address');
  eq(parse({ subjectUnit: 'Wealthy and Sheldon - S 108 ADA', unit: 'Wealthy and Sheldon - S 108 ADA' }).unitKey, 'S108', 'by name, ADA unit');
  eq(sb.unitKey_('WEALTHY_SHELDON', 'New Interest on an existing guest card for Wealthy and Sheldon - S303'), 'S303', 'guest card subject');
  eq(sb.unitKey_('WEALTHY_SHELDON', '90 Wealthy Street SE, Grand Rapids, MI 49503'), '', 'address alone gives no unit');
  eq(parse({ subjectUnit: '90 Wealthy Street SE - Suite B', unit: '90 Wealthy Street SE - Suite B Grand Rapids, MI 49503' }), null, 'commercial suite');
});
test('Wealthy and Sheldon showing with its guest card: form sent', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Dana Wells', subjectUnit: '90 Wealthy Street SE - W 201',
    unit: '90 Wealthy Street SE - W 201 Grand Rapids, MI 49503' }));
  w.messages.push(guestCard({ name: 'Dana Wells', email: 'dana.wells@gmail.com', subjectProp: 'Wealthy and Sheldon - W 201' }));
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['dana.wells@gmail.com'], 'form recipient');
  ok(/Wealthy and Sheldon/.test(toProspects(w)[0].subject), 'property named in subject');
  eq(showings(w).map(r => [r.Status, r.PropertyKey]), [['FORM_SENT', 'WEALTHY_SHELDON']], 'row');
  eq(errors(w), [], 'no errors');
});
test('Wealthy and Sheldon matching check: Matt is alerted when the real email format is not what was assumed', (w, sb) => {
  const ws = o => showingEmail(Object.assign({ mode: 'self', subjectUnit: '90 Wealthy Street SE - W 201',
    unit: '90 Wealthy Street SE - W 201 Grand Rapids, MI 49503' }, o));
  // unreadable unit on the showing, card found by name: form still goes out
  w.messages.push(ws({ name: 'Dana Wells', subjectUnit: '90 Wealthy Street SE - Wealthy 2B', unit: '90 Wealthy Street SE - Wealthy 2B' }));
  w.messages.push(guestCard({ name: 'Dana Wells', email: 'dana.wells@gmail.com', subjectProp: 'Wealthy and Sheldon - W 201' }));
  // unreadable unit on the guest card
  w.messages.push(ws({ name: 'Lee Park' }));
  w.messages.push(guestCard({ name: 'Lee Park', email: 'lee.park@gmail.com', subjectProp: 'Wealthy and Sheldon' }));
  // prospect-booked, no guest card after the wait
  w.messages.push(ws({ name: 'Rosa Diaz', ageMin: 45 }));
  // staff-booked with no card is expected, not a matching problem
  w.messages.push(ws({ name: 'Omar Reyes', mode: 'staff' }));
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to).sort(), ['dana.wells@gmail.com', 'lee.park@gmail.com'], 'forms still sent');
  const e = errors(w);
  eq(e.length, 3, 'three alerts');
  ok(/MATCHING CHECK — Dana Wells: the unit could not be read from the showing email \(Unit line: "90 Wealthy Street SE - Wealthy 2B"\)/.test(e[0]), 'showing unit');
  ok(/Lee Park: the unit could not be read from the guest card/.test(e[1]) && /form WAS still sent to lee\.park@gmail\.com/.test(e[1]), 'card unit');
  ok(/Rosa Diaz: the prospect booked this themselves but no guest card was found/.test(e[2]) && /NO form was sent/.test(e[2]), 'no card');
  eq(toMatt(w).length, 3, 'emailed to Matt');
});
test('matching check stays quiet for the other properties', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Pat Doe', ageMin: 45 }));
  sb.showingWatcher();
  eq(errors(w), [], 'no alert for Grand Central Lofts');
});
test('a Wealthy and Sheldon commercial suite showing is left untouched', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'staff', name: 'Pat Doe', subjectUnit: '90 Wealthy Street SE - Suite A',
    unit: '90 Wealthy Street SE - Suite A Grand Rapids, MI 49503' }));
  sb.showingWatcher();
  eq(w.sent.length, 0, 'emails sent');
  eq(w.messages[0].unread, true, 'still unread');
  eq(showings(w).length, 0, 'rows');
});

console.log('Pairing a showing with a guest card');
test('self-booked with its guest card: form sent, row recorded, email marked read', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley' }));
  w.messages.push(guestCard({ name: 'Chelsea Daley', email: 'daleychelsea96@gmail.com' }));
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['daleychelsea96@gmail.com'], 'form recipient');
  ok(/COMPLETE YOUR PRE-SCREENING/.test(toProspects(w)[0].html) && /forms\.test\/form-1\?/.test(toProspects(w)[0].html), 'prefilled link in email');
  eq(showings(w).map(r => [r.Status, r.Email]), [['FORM_SENT', 'daleychelsea96@gmail.com']], 'row');
  eq(w.messages[0].unread, false, 'showing read');
  eq(w.messages[1].unread, true, 'guest card never marked read');
});
test('SAFETY: someone else\'s inquiry on the same unit is never used', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Olivia Zlydaszyk', ageMin: 5 }));
  w.messages.push(guestCard({ name: 'Marquayvius Green', email: 'quayg70@gmail.com', ageMin: 10 }));
  sb.showingWatcher();
  eq(toProspects(w).length, 0, 'nothing sent to the wrong person');
  eq(w.messages[0].unread, true, 'still waiting for the right card');
});
test('two cards for the same name: the one for the showing\'s unit wins', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Jordan Reda' }));
  w.messages.push(guestCard({ name: 'Jordan Reda', email: 'other-unit@gmail.com', subjectProp: 'Grand Central Lofts  - 202', ageMin: 1 }));
  w.messages.push(guestCard({ name: 'Jordan Reda', email: 'right-unit@gmail.com', subjectProp: 'Grand Central Lofts  - 207', ageMin: 20 }));
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['right-unit@gmail.com'], 'recipient');
});
test('guest card from 23 hours earlier is found by the 30-day name lookback (Karen Patterson)', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Karen Patterson' }));
  w.messages.push(guestCard({ name: 'Karen Patterson', email: 'karenpatterson4367@icloud.com', subjectProp: 'Grand Central Lofts', ageMin: 23 * 60 }));
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['karenpatterson4367@icloud.com'], 'recipient');
});
test('lookback ignores the same name at a different property', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Karen Patterson', ageMin: 5 }));
  w.messages.push(guestCard({ name: 'Karen Patterson', email: 'kp@icloud.com', subjectProp: 'Eaglebrook Apartments - 5993C', ageMin: 3 * 24 * 60 }));
  sb.showingWatcher();
  eq(toProspects(w).length, 0, 'nothing sent');
});
test('guest cards are read from Gmail once, not on every run while a showing waits', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Olivia Zlydaszyk', ageMin: 5 }));
  w.messages.push(guestCard({ name: 'Marquayvius Green', email: 'quayg70@gmail.com', ageMin: 10 }));
  w.messages.push(guestCard({ name: 'Someone Else', email: 'else@gmail.com', subjectProp: 'Oakwood Apartments - 12', ageMin: 10 }));
  sb.showingWatcher(); sb.showingWatcher(); sb.showingWatcher();
  eq([w.bodyReads[w.messages[1].id], w.bodyReads[w.messages[2].id]], [1, 1], 'each card body read once over 3 runs');
  w.messages.push(guestCard({ name: 'Olivia Zlydaszyk', email: 'olivia@gmail.com', ageMin: 1 }));
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['olivia@gmail.com'], 'a card arriving later is still picked up, from cached and fresh cards alike');
});
test('cache unavailable: cards are read directly and the form still goes out', (w, sb) => {
  w.failCache = true;
  w.messages.push(showingEmail({ mode: 'self', name: 'Olivia Zlydaszyk', ageMin: 5 }));
  w.messages.push(guestCard({ name: 'Olivia Zlydaszyk', email: 'olivia@gmail.com', ageMin: 5 }));
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['olivia@gmail.com'], 'recipient');
  eq(errors(w), [], 'no errors logged');
});
test('no card yet: waits, then alerts Spencer after 30 minutes', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Olivia Zlydaszyk', ageMin: 10 }));
  sb.showingWatcher();
  eq([w.sent.length, showings(w).length, w.messages[0].unread], [0, 0, true], 'still waiting at 10 min');
  w.messages[0].date = new Date(Date.now() - 31 * MIN);
  sb.showingWatcher();
  ok(/^\[NEED EMAIL\] Olivia Zlydaszyk/.test(toSpencer(w)[0].subject), 'alert subject');
  eq(showings(w).map(r => r.Status), ['NO_MATCH'], 'row');
});

console.log('Staff-booked showings');
test('staff-booked with no card: Spencer is asked immediately, no 30 minute wait', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'staff', name: 'Savana Kotas', ageMin: 1 }));
  sb.showingWatcher();
  eq(toProspects(w).length, 0, 'nothing to prospect');
  ok(/^\[NEED EMAIL\] Savana Kotas/.test(toSpencer(w)[0].subject), 'alert subject');
  ok(/Reply to this email with the prospect/.test(toSpencer(w)[0].html), 'alert explains the reply option');
  eq(showings(w).map(r => r.Status), ['NO_MATCH'], 'row');
});
test('the same showing assigned twice produces one alert (Savana Kotas)', (w, sb) => {
  const start = showingStart(3);
  w.messages.push(showingEmail({ mode: 'staff', name: 'Savana Kotas', start }));
  sb.showingWatcher();
  w.messages.push(showingEmail({ mode: 'staff', name: 'Savana Kotas', start }));
  sb.showingWatcher();
  eq(toSpencer(w).length, 1, 'alerts');
  eq(showings(w).length, 1, 'rows');
  eq(w.messages[1].unread, false, 'duplicate marked read');
});
test('Spencer replies with the email: form goes out and the row is updated, not duplicated', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'staff', name: 'Olivia Zlydaszyk' }));
  sb.showingWatcher();
  const alert = toSpencer(w)[0];
  w.messages.push({
    from: 'Spencer Green <spencer@greenpropertymgt.com>', subject: 'Re: ' + alert.subject, date: new Date(),
    plain: 'olivia.z@gmail.com\n\nSpencer Green\nspencer@greenpropertymgt.com\n\nOn Fri, Oct 2, 2026 at 10:28 AM Showing Pre-Screen <automation@greenpropertymgt.com> wrote:\n> A showing was booked'
  });
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['olivia.z@gmail.com'], 'form recipient');
  eq(showings(w).map(r => [r.Status, r.Email]), [['FORM_SENT', 'olivia.z@gmail.com']], 'row');
  ok(/Sent the pre-screen form to olivia\.z@gmail\.com/.test(w.replies[0].text), 'confirmation reply');
  sb.showingWatcher();
  eq(toProspects(w).length, 1, 'not sent twice');
});
test('a reply with no address gets a "try again" reply and sends nothing', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'staff', name: 'Olivia Zlydaszyk' }));
  sb.showingWatcher();
  w.messages.push({ from: 'spencer@greenpropertymgt.com', subject: 'Re: ' + toSpencer(w)[0].subject, date: new Date(), plain: 'will do, thanks' });
  sb.showingWatcher();
  eq(toProspects(w).length, 0, 'nothing sent');
  ok(/couldn't find an email address/.test(w.replies[0].text), 'reply');
});
test('SAFETY: a reply from outside the company is ignored', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'staff', name: 'Olivia Zlydaszyk' }));
  sb.showingWatcher();
  w.messages.push({ from: 'someone@gmail.com', subject: 'Re: ' + toSpencer(w)[0].subject, date: new Date(), plain: 'victim@example.com' });
  sb.showingWatcher();
  eq(toProspects(w).length, 0, 'nothing sent');
  eq(showings(w)[0].Status, 'NO_MATCH', 'row unchanged');
});

console.log('When something goes wrong');
test('form cannot be opened: no email, no replacement form created, retried next minute, Matt alerted', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley' }));
  w.messages.push(guestCard({ name: 'Chelsea Daley', email: 'daleychelsea96@gmail.com' }));
  w.failFormOpen = true;
  sb.showingWatcher();
  eq(toProspects(w).length, 0, 'nothing sent');
  eq(w.created, [], 'nothing created');
  eq([w.props.PRESCREEN_FORM_ID, w.props.PRESCREEN_RESPONSES_SHEET_ID], [FORM_ID, RESP_ID], 'saved IDs untouched');
  eq(w.messages[0].unread, true, 'left for retry');
  eq(toMatt(w).length, 1, 'error alert');
  w.failFormOpen = false;
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['daleychelsea96@gmail.com'], 'sent once the form is back');
});
test('sheet write fails: the form is NOT emailed (so it can never repeat every minute)', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley' }));
  w.messages.push(guestCard({ name: 'Chelsea Daley', email: 'daleychelsea96@gmail.com' }));
  sb.showingWatcher(); // creates the Showings tab header via the first append...
  w.sent.length = 0; w.sheets[RESP_ID].Showings.length = 1; w.messages[0].unread = true;
  w.failAppendOnce = true;
  sb.showingWatcher();
  eq(toProspects(w).length, 0, 'no email while the row could not be written');
  sb.showingWatcher();
  eq(toProspects(w).length, 1, 'exactly one email after recovery');
  sb.showingWatcher();
  eq(toProspects(w).length, 1, 'and never again');
});
test('email send fails: recorded as SEND_FAILED, Spencer told, never retried', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley' }));
  w.messages.push(guestCard({ name: 'Chelsea Daley', email: 'bad@address' + '.com' }));
  w.failSendTo = 'bad@address.com';
  sb.showingWatcher();
  eq(showings(w).map(r => r.Status), ['SEND_FAILED'], 'row');
  ok(/^\[FORM NOT SENT\]/.test(toSpencer(w)[0].subject), 'Spencer told');
  eq(w.messages[0].unread, false, 'not retried');
});
test('one broken showing does not block the next one', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Broken Person', ageMin: 2 }));
  w.messages.push(guestCard({ name: 'Broken Person', email: 'bad@address.com' }));
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley', ageMin: 1, subjectUnit: '100 Commerce Ave SW  - 209', unit: '100 Commerce Ave SW - 209 Grand Rapids, MI 49503' }));
  w.messages.push(guestCard({ name: 'Chelsea Daley', email: 'daleychelsea96@gmail.com' }));
  w.failSendTo = 'bad@address.com';
  sb.showingWatcher();
  eq(toProspects(w).map(s => s.to), ['daleychelsea96@gmail.com'], 'second showing still handled');
});
test('unreadable date: Spencer told once, one error, never retried', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley', badDate: true }));
  sb.showingWatcher(); sb.showingWatcher(); sb.showingWatcher();
  eq(toSpencer(w).map(s => s.subject.slice(0, 15)), ['[NOT PROCESSED]'], 'one alert');
  eq(errors(w).length, 1, 'one error row');
  eq(showings(w).map(r => r.Status), ['UNPARSED'], 'row');
  eq(w.messages[0].unread, false, 'marked read');
});
test('error alerts to Matt stop at 5 a day; the Errors tab keeps everything', (w, sb) => {
  for (let i = 0; i < 8; i++) sb.logPreScreenError_('boom ' + i, null);
  eq(toMatt(w).length, 5, 'alerts');
  ok(/alert 5 of 5/.test(toMatt(w)[4].html), 'last alert says it is the last');
  eq(errors(w).length, 8, 'error rows');
});

console.log('Bounces and reminders');
test('a bounced form email flags Spencer and stops the reminder', (w, sb) => {
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley' }));
  w.messages.push(guestCard({ name: 'Chelsea Daley', email: 'daleychelsea96@gmail.com' }));
  sb.showingWatcher();
  w.messages.push({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', date: new Date(),
    plain: 'Address not found. Your message wasn\'t delivered to daleychelsea96@gmail.com because the address couldn\'t be found.' });
  w.messages.push({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', date: new Date(),
    plain: 'Your message wasn\'t delivered to tenant@example.com' });
  sb.showingWatcher();
  ok(/^\[EMAIL BOUNCED\] Chelsea Daley/.test(toSpencer(w)[0].subject), 'Spencer told');
  eq(showings(w)[0].Status, 'BOUNCED', 'row');
  eq([w.messages[2].unread, w.messages[3].unread], [false, true], 'another automation\'s bounce is left alone');
});
test('reminder goes out once, 2 hours before, even if run every minute', (w, sb) => {
  const start = new Date(Date.now() + 5 * 60 * MIN);
  w.messages.push(showingEmail({ mode: 'self', name: 'Chelsea Daley', start }));
  w.messages.push(guestCard({ name: 'Chelsea Daley', email: 'daleychelsea96@gmail.com' }));
  // showingEmail always says 1:00pm; force the stored start to "90 minutes from now".
  sb.showingWatcher();
  const rows = w.sheets[RESP_ID].Showings;
  rows[1][rows[0].indexOf('ShowingStart')] = new Date(Date.now() + 90 * MIN);
  rows[1][rows[0].indexOf('ReminderSentAt')] = '';
  w.sent.length = 0;
  sb.showingWatcher(); sb.showingWatcher(); sb.showingWatcher();
  eq(toProspects(w).map(s => s.subject.slice(0, 9)), ['Reminder:'], 'one reminder');
  eq(toSpencer(w).filter(s => /NO PRE-SCREEN YET/.test(s.subject)).length, 1, 'one flag');
});

console.log('Scoring a submitted form');
const answers = o => Object.assign({ fullName: 'Matt Bakes', email: 'bakesm@mail.gvsu.edu', property: 'Grand Central Lofts',
  bedroomsLabel: 'Studio', beds: 0, moveInRaw: 'soon', moveIn: new Date(Date.now() + 20 * DAY),
  creditRange: '650 or above', monthlyIncome: 5000, cosigner: 'No' }, o);
test('pass / fail rules', (w, sb) => {
  const v = o => sb.computeScreeningResult_(answers(o)).verdict;
  eq(v({}), 'PASS', 'meets everything');
  eq(v({ creditRange: '625 - 649' }), 'PASS', '625-649');
  eq(v({ creditRange: '600 - 624' }), 'FAIL', '600-624');
  eq(v({ creditRange: 'Below 600', cosigner: 'Yes' }), 'FAIL', 'cosigner does not rescue a low score');
  eq(v({ creditRange: 'NO CREDIT - ALLOWS COSIGNER', cosigner: 'Yes' }), 'PASS', 'no credit + cosigner');
  eq(v({ creditRange: 'NO CREDIT - ALLOWS COSIGNER', cosigner: 'No' }), 'FAIL', 'no credit, no cosigner');
  eq(v({ monthlyIncome: 2999 }), 'FAIL', 'income under 3x $1,000');
  eq(v({ beds: 1, bedroomsLabel: '1 Bedroom', monthlyIncome: 4199 }), 'FAIL', 'income under 3x $1,400');
  eq(v({ moveIn: new Date(Date.now() + 120 * DAY) }), 'FAIL', 'move-in over 90 days');
  eq(v({ beds: 3, bedroomsLabel: '3 Bedrooms' }), 'REVIEW', 'no Requirements row');
});
test('a cosigner covers short income (any amount), but never a low score or a late move-in', (w, sb) => {
  const r = o => sb.computeScreeningResult_(answers(o));
  eq(r({ monthlyIncome: 2999, cosigner: 'Yes' }).verdict, 'PASS', 'short income + Yes');
  eq(r({ monthlyIncome: 0, cosigner: 'If needed' }).verdict, 'PASS', '$0 income + If needed');
  eq(r({ monthlyIncome: 2999, cosigner: 'No' }).verdict, 'FAIL', 'short income, no cosigner');
  eq(r({ monthlyIncome: 2999, cosigner: 'Yes' }).cosignerCovers, ['income'], 'covers income');
  eq(r({ monthlyIncome: 5000, cosigner: 'Yes' }).cosignerCovers, [], 'income met: cosigner not relied on');
  eq(r({ monthlyIncome: 0, cosigner: 'Yes', creditRange: 'NO CREDIT - ALLOWS COSIGNER' }).cosignerCovers, ['credit', 'income'], 'covers both');
  eq(r({ monthlyIncome: 2999, cosigner: 'Yes', creditRange: '600 - 624' }).verdict, 'FAIL', 'low score still fails');
  eq(r({ monthlyIncome: 2999, cosigner: 'Yes', moveIn: new Date(Date.now() + 120 * DAY) }).verdict, 'FAIL', 'late move-in still fails');
  ok(/cosigner required for income/.test(r({ monthlyIncome: 2999, cosigner: 'Yes' }).reason), 'reason names the check');
});
test('confirmation email says a cosigner is required only when one was relied on', (w, sb) => {
  const showing = { Property: 'Grand Central Lofts', Unit: '100 Commerce Ave SW - 207', ShowingStart: showingStart(3) };
  const send = o => { const a = answers(o); sb.sendConfirmationEmail_(showing, a, sb.computeScreeningResult_(a)); return w.sent[w.sent.length - 1].html; };
  ok(!/cosigner/.test(send({})), 'no note when not needed');
  ok(/based on the income you listed, a cosigner will be required/.test(send({ monthlyIncome: 100, cosigner: 'Yes' })), 'income note');
  ok(/credit history on file yet, a cosigner will be required/.test(send({ creditRange: 'NO CREDIT - ALLOWS COSIGNER', cosigner: 'If needed' })), 'credit note');
  ok(/credit history and income you listed, a cosigner will be required/.test(send({ monthlyIncome: 0, creditRange: 'NO CREDIT - ALLOWS COSIGNER', cosigner: 'Yes' })), 'both');
});
test('Wealthy and Sheldon scores from its own rows; a blank rent goes to review', (w, sb) => {
  const v = o => sb.computeScreeningResult_(answers(Object.assign({ property: 'Wealthy and Sheldon' }, o))).verdict;
  eq(v({ monthlyIncome: 3900 }), 'PASS', '3x $1,300');
  eq(v({ monthlyIncome: 3899 }), 'FAIL', 'under 3x $1,300');
  eq(v({ beds: 3, bedroomsLabel: '3 Bedrooms' }), 'REVIEW', 'blank rent row');
  eq(v({ beds: 2, bedroomsLabel: '2 Bedrooms' }), 'REVIEW', 'no row');
});
test('Requirements spreadsheet unreachable: NEEDS REVIEW, nothing created, saved ID untouched', (w, sb) => {
  w.failSheetOpen = UNITS_ID;
  eq(sb.computeScreeningResult_(answers({})).verdict, 'REVIEW', 'verdict');
  eq(w.created, [], 'nothing created');
  eq(w.props.UNITS_SHEET_ID, UNITS_ID, 'saved ID');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
