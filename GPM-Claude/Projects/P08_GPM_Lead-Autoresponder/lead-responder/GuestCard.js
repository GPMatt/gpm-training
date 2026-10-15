// GPM Lead Responder — read an AppFolio guest-card email and match it to a
// property row and to the live listings it is about.
//
// Guest cards name the place three ways, and most name only the building:
//   headline       "New Lead for 1966 Burton St SE, Apt 25" / "New Lead for Victory on Leonard"
//   Interested in  "Indian Village Apartments - 1966 IVA25" / "Victory on Leonard - 406"
//   footer link    https://greenproperty.appfolio.com/users/390/edit → which AppFolio account
// So the match is: account → property row (MatchPhrases) → that building's
// listings → the exact unit when the card names one that is still posted.

function parseGuestCard_(subject, html) {
  var text = htmlToText_(html);
  var line = function (re) { var m = text.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
  var head = text.match(/New (Lead|Interest) for ([^\n]+)/i);
  var contact = (text.split(/CONTACT INFO/i)[1] || '').split('\n').map(function (s) { return s.trim(); }).filter(String);
  var email = (String(html).match(/mailto:([^"'?\s>]+)/i) || [])[1] || '';
  var comments = (text.match(/COMMENTS\s*\n([\s\S]*?)\n\s*(?:Reply|LEAD INFO|INTEREST INFO)\b/i) || [])[1] || line(/Message:\s*([\s\S]*?)\n\s*\n/i);

  return {
    kind: head ? head[1].charAt(0).toUpperCase() + head[1].slice(1).toLowerCase() : '',
    headline: head ? head[2].trim() : '',
    interestedIn: line(/Interested in:[ \t]*([^\n]*)/i),
    account: (String(html).match(/https?:\/\/([a-z0-9-]+)\.appfolio\.com\/users\//i) || [])[1] || '',
    name: contact[0] || '',
    email: email.toLowerCase(),
    phone: line(/(\(\d{3}\)\s*\d{3}-\d{4})/),
    comments: String(comments).replace(/\s+/g, ' ').trim(),
    source: line(/Source:\s*([^\n]+)/i),
    subject: subject
  };
}

// "900 Leonard St NW, Unit 419, Grand Rapids, MI 49504" → {num:'900', street:'leonard', unit:'419'}
// Returns null when the text has no "number street" in it.
function addressParts_(s) {
  s = String(s || '').toLowerCase()
    .replace(/,\s*[a-z .]+,?\s*(?:mi\s*)?\d{5}(?:-\d{4})?\s*$/, '') // city, state zip
    .replace(/\s+/g, ' ');
  var re = /(?:^|[^a-z0-9])(\d+)\s+([a-z0-9]+)/g, m;
  while ((m = re.exec(s))) {
    if (/^[a-z]+\d+$/.test(m[2])) continue; // "1966 iva14" is a unit name, not a street
    return { num: m[1], street: m[2], unit: unitFrom_(s.slice(m.index + m[0].length), m[1]) };
  }
  return null;
}

function unitFrom_(rest, num) {
  var explicit = rest.match(/(?:apt|unit|ste|suite|#)\s*#?\s*([a-z0-9]+)(?!.*(?:apt|unit|ste|suite|#)\s*#?\s*[a-z0-9])/);
  var unit = explicit ? explicit[1] : '';
  if (!unit) {
    var digits = rest.match(/[a-z]*\d+[a-z]?/g) || [];
    unit = digits.length ? digits[digits.length - 1].replace(/^[a-z]+/, '') : '';
  }
  unit = unit.replace(/^0+(?=.)/, '');
  return unit === num ? '' : unit;
}

// Unit named without a street, e.g. "Victory on Leonard - 406",
// "Eaglebrook Apartments - 6009D", "Indian Village Apartments - 1966 IVA25".
function unitHint_(s) {
  var tail = String(s || '').split(/\s+-\s+/).slice(1).join(' - ').toLowerCase().trim();
  if (!tail) return null;
  var a = addressParts_(tail);
  if (a) return a;
  var m;
  if ((m = tail.match(/^(\d+)([a-z])$/))) return { num: m[1], unit: m[2] };
  if ((m = tail.match(/(\d+)\s*-?\s*[a-z]+\s*(\d+)/))) return { num: m[1], unit: m[2].replace(/^0+(?=.)/, '') };
  var digits = tail.match(/\d+[a-z]?/g);
  return digits ? { unit: digits[digits.length - 1].replace(/^0+(?=.)/, '') } : null;
}

function phraseList_(p) {
  return String(p.MatchPhrases || '').toLowerCase().split(';').map(function (s) { return s.trim(); }).filter(String);
}

// Whole-word match: "33 lafayette" must not match "1033 lafayette".
function containsPhrase_(text, phrase) {
  var esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])').test(String(text).toLowerCase().replace(/\s*&\s*/g, ' & '));
}

// → {profile, unit, building, outcome, reason}
//   outcome: UNIT (exact unit still posted) | BUILDING (building's posted units)
//            | NO_VACANCY (our property, nothing posted) | NO_PROFILE | AMBIGUOUS
function matchCard_(card, listings, profiles) {
  var texts = [card.headline, card.interestedIn].filter(String);
  var pool = card.account ? listings.filter(function (l) { return l.account === card.account; }) : listings;

  var hits = profiles.filter(function (p) {
    return phraseList_(p).some(function (ph) {
      return texts.concat([card.subject || '']).some(function (t) { return containsPhrase_(t, ph); });
    });
  });
  if (hits.length > 1) return { outcome: 'AMBIGUOUS', building: [], reason: 'Matches rows: ' + hits.map(function (p) { return p.Property; }).join(', ') };
  var profile = hits[0] || null;

  var buildings = texts.map(addressParts_).filter(Boolean);
  var building = pool.filter(function (l) {
    var a = addressParts_(l.address);
    if (!a) return false;
    if (buildings.some(function (b) { return b.num === a.num && b.street === a.street; })) return true;
    return profile && phraseList_(profile).some(function (ph) { return /^\d/.test(ph) && containsPhrase_(l.address, ph); });
  });

  if (!profile) {
    return { outcome: 'NO_PROFILE', building: building, reason: building.length ? 'Not in the sheet (' + building.length + ' posted units found by address)' : 'Not in the sheet' };
  }

  // Exact unit: from a full address in the card, else a bare unit name.
  var hints = buildings.filter(function (b) { return b.unit; });
  texts.forEach(function (t) { var h = unitHint_(t); if (h && h.unit) hints.push(h); });
  var unit = null;
  for (var i = 0; i < hints.length && !unit; i++) {
    var h = hints[i];
    var found = building.filter(function (l) {
      var a = addressParts_(l.address);
      return a.unit === h.unit && (!h.num || h.num === a.num) && (!h.street || h.street === a.street);
    });
    if (found.length === 1) unit = found[0];
  }

  if (unit) return { profile: profile, unit: unit, building: building, outcome: 'UNIT', reason: 'Unit still posted' };
  if (building.length) return { profile: profile, unit: null, building: building, outcome: 'BUILDING',
    reason: hints.length ? 'Unit ' + hints[0].unit + ' not posted; showing the building' : 'Card names the building only' };
  return { profile: profile, unit: null, building: [], outcome: 'NO_VACANCY', reason: 'Nothing posted for this property' };
}

function htmlToText_(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|h\d|tr|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t\r]+/g, ' ')
    .replace(/ *\n */g, '\n');
}
