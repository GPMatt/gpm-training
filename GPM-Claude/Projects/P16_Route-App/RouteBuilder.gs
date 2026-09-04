// ─── RouteBuilder.gs ──────────────────────────────────────────────────────
// Orchestrates both phases of the workflow:
//   1. Build My Day  — pool query, scheduled-flagging, draft skeleton saves
//   2. Build Route   — assembles the skeleton into a real ordered route
//   3. Review & Go   — live edits to an already-built route (reorder,
//      complete, remove, add) — always warn-not-block on feasibility.
//
// DayPlan JSON shape (one row per tech per date in the DayPlan sheet):
// {
//   status: 'building' | 'built',
//   urgent: [woNumber, ...],                              // tech-ranked order
//   scheduled: [{woNumber, windowStart, windowEnd}, ...],  // ordered by windowStart
//   buckets: [[woNumber,...], ...],                        // length = scheduled.length + 1
//   route: [{woNumber, type: 'urgent'|'scheduled'|'todo', complete, windowStart?, windowEnd?}, ...]
// }

const MIN_WORK_ORDERS = 2;

// TEMP DIAGNOSTIC — run this manually from the script editor (select it in
// the function dropdown, click Run), then check View > Executions for the
// logged output. Remove once the empty-pool issue is resolved.
function debugPool() {
  const sheet = getSheet_('WorkOrders');
  const raw = sheet.getDataRange().getValues();
  Logger.log('Raw row count (incl header): ' + raw.length);
  Logger.log('Header row: ' + JSON.stringify(raw[0]));
  if (raw.length > 1) Logger.log('First data row: ' + JSON.stringify(raw[1]));
  const open = getOpenWorkOrders();
  Logger.log('getOpenWorkOrders() returned: ' + open.length + ' rows');
  Logger.log(JSON.stringify(open));
}

// ── Phase 1: Build My Day ───────────────────────────────────────────────────

function getTechListForUI() {
  return getTechList();
}

// filters: { myProperties: bool, scheduledOnly: bool, assignedToMe: bool }
// sort: 'newest' | 'oldest'
function loadOpenWorkOrderPool(techName, filters, sort) {
  let wos = getOpenWorkOrders();

  if (filters && filters.myProperties) {
    const prefixes = getTechPropertyPrefixes(techName);
    wos = wos.filter(w => prefixes.some(p => w.address && w.address.indexOf(p) === 0));
  }
  if (filters && filters.scheduledOnly) {
    wos = wos.filter(w => !!w.appFolioApptText || w.isScheduledToday);
  }
  if (filters && filters.assignedToMe) {
    wos = wos.filter(w => w.assignedUser && w.assignedUser.split(',').some(n => n.trim() === techName));
  }

  wos.sort((a, b) => {
    const da = new Date(a.createdAt).getTime() || 0;
    const db = new Date(b.createdAt).getTime() || 0;
    return sort === 'oldest' ? da - db : db - da;
  });

  return wos;
}

function flagAsScheduled(woNumber, windowStart, windowEnd) {
  return flagWorkOrderScheduled(woNumber, windowStart, windowEnd);
}

function unflagAsScheduled(woNumber) {
  return unflagWorkOrderScheduled(woNumber);
}

function saveDraftPlan(techName, dateStr, draft) {
  draft.status = 'building';
  return saveDayPlan(techName, dateStr, draft);
}

function loadPlan(techName, dateStr) {
  return loadDayPlan(techName, dateStr);
}

// ── Phase 2: Build Route ────────────────────────────────────────────────────

function woLookup_() {
  const map = {};
  getOpenWorkOrders().forEach(w => { map[w.woNumber] = w; });
  return map;
}

function toStop_(wo) {
  return { woNumber: wo.woNumber, address: wo.address, unit: wo.unit };
}

// urgent: [woNumber,...]  scheduled: [{woNumber,windowStart,windowEnd},...]  buckets: [[woNumber,...],...]
function buildRoute(techName, dateStr, urgent, scheduled, buckets) {
  if (buckets.length !== scheduled.length + 1) {
    throw new Error('Bucket count must be scheduled.length + 1 — got ' + buckets.length + ' buckets for ' + scheduled.length + ' scheduled stops.');
  }
  const total = urgent.length + scheduled.length + buckets.reduce((n, b) => n + b.length, 0);
  if (total < MIN_WORK_ORDERS) {
    throw new Error('Add at least ' + MIN_WORK_ORDERS + ' work orders before building a route.');
  }

  const lookup = woLookup_();
  const depotAddress = getConfig_('DepotAddress');
  const route = [];

  urgent.forEach(woNumber => {
    route.push({ woNumber, type: 'urgent', complete: false });
  });

  let originAddress = urgent.length
    ? lookup[urgent[urgent.length - 1]].address
    : depotAddress;

  for (let i = 0; i < buckets.length; i++) {
    const bucketStops = buckets[i].map(n => toStop_(lookup[n]));
    const nextScheduled = scheduled[i]; // undefined for the last bucket
    const destinationAddress = nextScheduled ? lookup[nextScheduled.woNumber].address : null;

    const { orderedStops } = optimizeBucket(originAddress, bucketStops, destinationAddress);
    orderedStops.forEach(s => route.push({ woNumber: s.woNumber, type: 'todo', complete: false }));

    if (nextScheduled) {
      route.push({
        woNumber: nextScheduled.woNumber,
        type: 'scheduled',
        complete: false,
        windowStart: nextScheduled.windowStart,
        windowEnd: nextScheduled.windowEnd,
      });
      originAddress = lookup[nextScheduled.woNumber].address;
    }
  }

  const plan = { status: 'built', urgent, scheduled, buckets, route };
  return saveDayPlan(techName, dateStr, plan);
}

// ── Phase 3: Review & Go — live edits ───────────────────────────────────────

function estimateDriveMinutes_(addrA, addrB) {
  const cache = CacheService.getScriptCache();
  const key = 'drive_' + addrA + '__' + addrB;
  const cached = cache.get(key);
  if (cached !== null) return Number(cached);

  try {
    const result = Maps.newDirectionFinder().setOrigin(addrA).setDestination(addrB).getDirections();
    const seconds = result.routes && result.routes[0] ? result.routes[0].legs[0].duration.value : 0;
    const minutes = Math.round(seconds / 60);
    cache.put(key, String(minutes), 21600);
    return minutes;
  } catch (e) {
    return 0; // never block the UI on a Maps quota/network hiccup
  }
}

// Walks the route from the depot at "now", summing estimated drive minutes
// (no job-duration modeling, per design) and flags any Scheduled stop whose
// running arrival estimate lands after its window end. Warn-only, never blocks.
function checkRouteFeasibility_(route) {
  const lookup = woLookup_();
  const depotAddress = getConfig_('DepotAddress');
  const warnings = [];

  let prevAddress = depotAddress;
  let clock = new Date();

  for (const stop of route) {
    if (stop.complete) continue; // already done, doesn't affect what's ahead
    const wo = lookup[stop.woNumber];
    if (!wo) continue;

    const driveMin = estimateDriveMinutes_(prevAddress, wo.address);
    clock = new Date(clock.getTime() + driveMin * 60000);

    if (stop.type === 'scheduled' && stop.windowEnd) {
      const [h, m] = stop.windowEnd.split(':').map(Number);
      const windowEnd = new Date(clock);
      windowEnd.setHours(h, m, 0, 0);
      if (clock.getTime() > windowEnd.getTime()) {
        warnings.push(wo.woNumber + ' (' + wo.address + ') may miss its ' + stop.windowStart + '–' + stop.windowEnd + ' window at this pace.');
      }
    }
    prevAddress = wo.address;
  }
  return warnings;
}

function reorderRoute(techName, dateStr, orderedWoNumbers) {
  const plan = loadDayPlan(techName, dateStr);
  if (!plan) throw new Error('No route found for ' + techName + ' on ' + dateStr);

  const byWo = {};
  plan.route.forEach(s => { byWo[s.woNumber] = s; });
  plan.route = orderedWoNumbers.map(n => byWo[n]).filter(Boolean);

  const warnings = checkRouteFeasibility_(plan.route);
  saveDayPlan(techName, dateStr, plan);
  return { plan, warnings };
}

function markStopComplete(techName, dateStr, woNumber, complete) {
  const plan = loadDayPlan(techName, dateStr);
  if (!plan) throw new Error('No route found for ' + techName + ' on ' + dateStr);
  const stop = plan.route.find(s => s.woNumber === woNumber);
  if (stop) stop.complete = complete;
  return saveDayPlan(techName, dateStr, plan);
}

function removeStopFromRoute(techName, dateStr, woNumber) {
  const plan = loadDayPlan(techName, dateStr);
  if (!plan) throw new Error('No route found for ' + techName + ' on ' + dateStr);
  plan.route = plan.route.filter(s => s.woNumber !== woNumber);
  return saveDayPlan(techName, dateStr, plan);
}

// Geocoded lat/lng for every stop in today's route, in route order — lets
// the client fit the map to this specific route's spread instead of a
// one-size-fits-all zoom. Reuses the same cached geocoder as route
// optimization, so this costs nothing extra once a route's been built.
function getRouteStopCoords(techName, dateStr) {
  const plan = loadDayPlan(techName, dateStr);
  if (!plan || !plan.route) return [];
  const lookup = woLookup_();
  return plan.route.map(stop => {
    const wo = lookup[stop.woNumber];
    if (!wo || !wo.address) return null;
    try {
      const loc = geocodeAddress_(fullAddress_(wo));
      return { woNumber: stop.woNumber, lat: loc.latitude, lng: loc.longitude };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

function getDayStats(techName, dateStr) {
  const plan = loadDayPlan(techName, dateStr);
  if (!plan || !plan.route) return null;

  const lookup = woLookup_();
  const depotAddress = getConfig_('DepotAddress');
  const remaining = plan.route.filter(s => !s.complete);

  let driveMinutes = 0;
  let prevAddress = depotAddress;
  const routeSoFar = plan.route; // walk the whole route so "remaining" drive time reflects current position
  for (const stop of routeSoFar) {
    const wo = lookup[stop.woNumber];
    if (!wo) continue;
    if (!stop.complete) {
      driveMinutes += estimateDriveMinutes_(prevAddress, wo.address);
    }
    prevAddress = wo.address;
  }

  const nextScheduled = remaining.find(s => s.type === 'scheduled');

  return {
    stopsTotal: plan.route.length,
    stopsDone: plan.route.length - remaining.length,
    driveMinutesRemaining: driveMinutes,
    nextScheduled: nextScheduled
      ? { woNumber: nextScheduled.woNumber, windowStart: nextScheduled.windowStart, windowEnd: nextScheduled.windowEnd }
      : null,
  };
}

// insertAfterWoNumber: null/empty inserts at the end
function addStopToRoute(techName, dateStr, woNumber, insertAfterWoNumber) {
  const plan = loadDayPlan(techName, dateStr);
  if (!plan) throw new Error('No route found for ' + techName + ' on ' + dateStr);

  const newStop = { woNumber, type: 'todo', complete: false };
  const idx = insertAfterWoNumber ? plan.route.findIndex(s => s.woNumber === insertAfterWoNumber) : -1;
  if (idx === -1) {
    plan.route.push(newStop);
  } else {
    plan.route.splice(idx + 1, 0, newStop);
  }

  const warnings = checkRouteFeasibility_(plan.route);
  saveDayPlan(techName, dateStr, plan);
  return { plan, warnings };
}
