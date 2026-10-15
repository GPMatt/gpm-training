// GPM Lead Responder — live vacancies from AppFolio's public listings pages
//
// Nothing here is typed into the sheet: every lead email is built from what
// is posted to the website at that moment, so links never go stale. Each
// AppFolio account has its own public page.

// hilltoprealtymanagement (Jefferson) is deliberately left out of this project.
var LISTING_ACCOUNTS = ['greenproperty11', 'greenproperty', 'greenproperty7', 'greenproperty9'];
var LISTINGS_CACHE_SECONDS = 10 * 60;
var SLOTS_CACHE_SECONDS = 60 * 60;
var SLOT_LOOKAHEAD_DAYS = 14; // AppFolio returns 4 days per request

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

// Bookable showing times in the next SLOT_LOOKAHEAD_DAYS, keyed by uid:
// -1 = showings are turned off for the listing, 0 = calendar has no times.
function showingSlots_(listings) {
  var cache = CacheService.getScriptCache();
  var result = {};
  var todo = listings.filter(function (l) {
    var hit = cache.get('slots_' + l.uid);
    if (hit !== null) { result[l.uid] = Number(hit); return false; }
    return true;
  });
  if (!todo.length) return result;

  var requests = [], owners = [];
  var today = new Date();
  todo.forEach(function (l) {
    for (var d = 0; d < SLOT_LOOKAHEAD_DAYS; d += 4) {
      var start = Utilities.formatDate(new Date(today.getTime() + d * 864e5), 'America/Detroit', 'MM/dd/yyyy');
      requests.push({
        url: listingsBase_(l.account) + '/api/listings/' + l.uid + '/availabilities?startDate=' + encodeURIComponent(start),
        headers: { Accept: 'application/json' }, muteHttpExceptions: true
      });
      owners.push(l.uid);
    }
  });
  var counts = {};
  UrlFetchApp.fetchAll(requests).forEach(function (res, i) {
    var uid = owners[i];
    if (counts[uid] === -1) return;
    if (res.getResponseCode() !== 200) { counts[uid] = -1; return; }
    var days = (JSON.parse(res.getContentText()).availabilities_by_date || []);
    counts[uid] = (counts[uid] || 0) + days.reduce(function (n, day) { return n + (day.timeslots || []).length; }, 0);
  });
  Object.keys(counts).forEach(function (uid) {
    result[uid] = counts[uid];
    cache.put('slots_' + uid, String(counts[uid]), SLOTS_CACHE_SECONDS);
  });
  return result;
}

function cleanText_(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
