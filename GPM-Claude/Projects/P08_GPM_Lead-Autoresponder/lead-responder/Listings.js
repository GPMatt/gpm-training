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
// keyed by uid: 1 = yes, 0 = no open times, -1 = showings off / check failed.
// This is the same check AppFolio's own button script runs
// (schedule_showing_button.js): it asks availabilities with
// find_first_available_date=true and shows the button only when
// first_available_date comes back non-null. The plain call only looks 4 days
// ahead, which hid VoL's button when its first time was weeks out.
function showingSlots_(listings) {
  var cache = CacheService.getScriptCache();
  var result = {};
  var todo = listings.filter(function (l) {
    var hit = cache.get('showbtn_' + l.uid);
    if (hit !== null) { result[l.uid] = Number(hit); return false; }
    return true;
  });
  if (!todo.length) return result;

  var responses = UrlFetchApp.fetchAll(todo.map(function (l) {
    return {
      url: listingsBase_(l.account) + '/api/listings/' + l.uid + '/availabilities?find_first_available_date=true',
      headers: { Accept: 'application/json' }, muteHttpExceptions: true
    };
  }));
  responses.forEach(function (res, i) {
    var uid = todo[i].uid, v = -1;
    if (res.getResponseCode() === 200) {
      try {
        var d = JSON.parse(res.getContentText());
        var anySlot = (d.availabilities_by_date || []).some(function (day) { return (day.timeslots || []).length > 0; });
        v = (d.first_available_date || anySlot) ? 1 : 0;
      } catch (e) { v = -1; }
    }
    result[uid] = v;
    cache.put('showbtn_' + uid, String(v), SLOTS_CACHE_SECONDS);
  });
  return result;
}

function cleanText_(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
