// GPM Lead Responder — live vacancies from AppFolio's public listings pages
//
// Nothing here is typed into the sheet: every lead email is built from what
// is posted to the website at that moment, so links never go stale. Each
// AppFolio account has its own public page.

// hilltoprealtymanagement (Jefferson) is deliberately left out of this project.
var LISTING_ACCOUNTS = ['greenproperty11', 'greenproperty', 'greenproperty7', 'greenproperty9'];
var LISTINGS_CACHE_SECONDS = 10 * 60;
// The showing button can change minute to minute; re-check at most every 10 min.
var SLOTS_CACHE_SECONDS = 10 * 60;

function listingsBase_(account) {
  return 'https://' + account + '.appfolio.com/listings';
}

// [{account, uid, address, title, rent, bedBath, available, applyUrl, showingUrl, detailUrl}]
function fetchAllListings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('listings_v1');
  if (hit) return JSON.parse(hit);

  var responses = UrlFetchApp.fetchAll(LISTING_ACCOUNTS.map(function (a) {
    return { url: listingsBase_(a), muteHttpExceptions: true };
  }));
  var all = [];
  responses.forEach(function (res, i) {
    if (res.getResponseCode() !== 200) throw new Error('Listings page ' + LISTING_ACCOUNTS[i] + ' returned ' + res.getResponseCode());
    all = all.concat(parseListingsPage_(LISTING_ACCOUNTS[i], res.getContentText()));
  });
  cache.put('listings_v1', JSON.stringify(all), LISTINGS_CACHE_SECONDS);
  return all;
}

function parseListingsPage_(account, html) {
  var base = listingsBase_(account);
  var cards = String(html).split(/(?=<div[^>]*class="[^"]*listing-item[ "])/).slice(1);
  var out = [];
  cards.forEach(function (c) {
    var uid = (c.match(/listable_uid=([0-9a-f-]{36})/) || c.match(/\/listings\/detail\/([0-9a-f-]{36})/) || [])[1];
    if (!uid) return;
    var pick = function (re) { var m = c.match(re); return m ? cleanText_(m[1]) : ''; };
    out.push({
      account: account,
      uid: uid,
      address: pick(/js-listing-address[^>]*>([\s\S]*?)</),
      title: pick(/js-listing-title[^>]*>([\s\S]*?)<\//),
      rent: pick(/RENT<\/[^>]+>\s*<[^>]*>([\s\S]*?)</),
      bedBath: pick(/js-listing-blurb-bed-bath[^>]*>([\s\S]*?)</),
      available: pick(/detail-box__value js-listing-available[^>]*>([\s\S]*?)</),
      applyUrl: base + '/rental_applications/new?listable_uid=' + uid + '&source=Website',
      showingUrl: base + '/showings/new?listable_uid=' + uid + '&source=Website',
      detailUrl: base + '/detail/' + uid
    });
  });
  return out;
}

// Does the listing's public page show the blue "Schedule Showing" button?
// keyed by uid: 1 = yes, 0 = no, -1 = check failed (treated as no).
function showingSlots_(listings) {
  var full = showingCheck_(listings, false), out = {};
  Object.keys(full).forEach(function (uid) { out[uid] = full[uid].v; });
  return out;
}

// → {uid: {v: 1|0|-1, why: text, first: 'YYYY-MM-DD'|''}}
// Mirrors AppFolio exactly, in two steps:
//  1. The detail page HTML must contain the button (class js-schedule-showing).
//     Accounts/listings with online showings off (e.g. Oakwood, greenproperty9)
//     never render it, even though their calendar API still returns dates.
//  2. AppFolio's schedule_showing_button.js then calls
//     availabilities?find_first_available_date=true and un-hides the button
//     only when first_available_date is non-null.
// force = true skips the cache (the 10-minute Showing Links refresh).
function showingCheck_(listings, force) {
  var cache = CacheService.getScriptCache();
  var result = {};
  var todo = listings.filter(function (l) {
    var hit = force ? null : cache.get('showbtn3_' + l.uid);
    if (hit !== null) { result[l.uid] = JSON.parse(hit); return false; }
    return true;
  });
  if (!todo.length) return result;

  var requests = [];
  todo.forEach(function (l) {
    requests.push({ url: l.detailUrl, muteHttpExceptions: true });
    requests.push({
      url: listingsBase_(l.account) + '/api/listings/' + l.uid + '/availabilities?find_first_available_date=true',
      headers: { Accept: 'application/json' }, muteHttpExceptions: true
    });
  });
  var res = UrlFetchApp.fetchAll(requests);
  todo.forEach(function (l, i) {
    var page = res[2 * i], api = res[2 * i + 1];
    var r = { v: -1, why: '', first: '' };
    if (page.getResponseCode() !== 200) {
      r.why = 'Listing page returned ' + page.getResponseCode();
    } else if (page.getContentText().indexOf('js-schedule-showing') === -1) {
      r.v = 0; r.why = 'Online showings are off for this listing in AppFolio';
    } else if (api.getResponseCode() === 422) {
      r.v = 0; r.why = 'Online showings are off for this listing in AppFolio';
    } else if (api.getResponseCode() !== 200) {
      r.why = 'Calendar check returned ' + api.getResponseCode();
    } else {
      try {
        var d = JSON.parse(api.getContentText());
        var anySlot = (d.availabilities_by_date || []).some(function (day) { return (day.timeslots || []).length > 0; });
        r.first = d.first_available_date || '';
        r.v = (r.first || anySlot) ? 1 : 0;
        r.why = r.v ? 'Open showing times on the calendar' : 'No open showing times on the calendar';
      } catch (e) { r.why = 'Calendar check gave an unreadable answer'; }
    }
    result[l.uid] = r;
    cache.put('showbtn3_' + l.uid, JSON.stringify(r), SLOTS_CACHE_SECONDS);
  });
  return result;
}

function cleanText_(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
