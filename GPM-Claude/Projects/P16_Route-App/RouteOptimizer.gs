// ─── RouteOptimizer.gs ────────────────────────────────────────────────────
// One call per To Do bucket: order the stops in that bucket for shortest
// drive time between a fixed origin (the previous anchor — depot, the last
// Urgent stop, or a Scheduled stop) and an optional fixed destination (the
// next Scheduled stop, or none for the final bucket of the day).
//
// Urgent order and Scheduled windows are never solved here — they're fixed
// inputs set by the tech in Build My Day.
//
// Uses the Cloud Route Optimization API with OAuth (ScriptApp.getOAuthToken()),
// NOT a Maps Platform API key — this requires the Apps Script project to be
// switched to a Standard (user-managed) GCP project with the Route
// Optimization API enabled and billing on. See the GCP walkthrough in the
// handoff doc for exact steps.

function checkRouteOptimizationConfigured_() {
  const enabled = getConfig_('RouteOptimizationEnabled');
  const projectId = getConfig_('GcpProjectId');
  if (enabled !== 'Y' || !projectId) {
    throw new Error(
      'Route Optimization isn\'t set up yet. Set GcpProjectId in the Config tab and ' +
      'RouteOptimizationEnabled to Y once the GCP project + API are ready.'
    );
  }
  return projectId;
}

function geocodeAddress_(address) {
  const cache = CacheService.getScriptCache();
  const key = 'geo_' + address;
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const result = Maps.newGeocoder().geocode(address);
  if (result.status !== 'OK' || !result.results.length) {
    throw new Error('Geocode failed for: ' + address);
  }
  const loc = result.results[0].geometry.location;
  const coords = { latitude: loc.lat, longitude: loc.lng };
  cache.put(key, JSON.stringify(coords), 21600); // 6h — addresses don't move
  return coords;
}

function fullAddress_(stop) {
  return stop.address + (stop.unit ? ' Unit ' + stop.unit : '');
}

// stops: [{ woNumber, address, unit }], in any order
// destinationAddress: string, or null/undefined for an open-ended final bucket
// Returns: { orderedStops: [...same shape, in solved order], driveMinutes: [n, n, ...] }
//   driveMinutes has one entry per leg: origin→stop1, stop1→stop2, ..., lastStop→destination (if given)
function optimizeBucket(originAddress, stops, destinationAddress) {
  if (!stops || stops.length === 0) {
    return { orderedStops: [], driveMinutes: [] };
  }
  if (stops.length === 1) {
    return { orderedStops: stops, driveMinutes: [] }; // nothing to sequence
  }

  const projectId = checkRouteOptimizationConfigured_();
  const origin = geocodeAddress_(originAddress);
  const destination = destinationAddress ? geocodeAddress_(destinationAddress) : null;

  const shipments = stops.map((s, i) => {
    const loc = geocodeAddress_(fullAddress_(s));
    return {
      deliveries: [{ arrivalLocation: { latitude: loc.latitude, longitude: loc.longitude } }],
      label: String(i),
    };
  });

  const vehicle = {
    startLocation: { latitude: origin.latitude, longitude: origin.longitude },
  };
  if (destination) {
    vehicle.endLocation = { latitude: destination.latitude, longitude: destination.longitude };
  }

  const body = {
    model: { shipments, vehicles: [vehicle] },
  };

  const url = 'https://routeoptimization.googleapis.com/v1/projects/' + projectId + ':optimizeTours';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  const json = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200) {
    throw new Error('Route Optimization API error: ' + JSON.stringify(json));
  }

  const route = json.routes && json.routes[0];
  const visits = route && route.visits;
  if (!visits || !visits.length) {
    // Fallback: keep the tech's original order rather than fail the whole build.
    return { orderedStops: stops, driveMinutes: stops.map(() => 0) };
  }

  const orderedStops = visits.map(v => stops[parseInt(v.shipmentLabel, 10)]);
  const transitions = route.transitions || [];
  const driveMinutes = transitions.map(t => {
    const seconds = t.travelDuration ? parseInt(String(t.travelDuration).replace('s', ''), 10) : 0;
    return Math.round(seconds / 60);
  });

  return { orderedStops, driveMinutes };
}
