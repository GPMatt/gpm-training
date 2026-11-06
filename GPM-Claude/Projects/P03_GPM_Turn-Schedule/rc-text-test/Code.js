/**
 * RingCentral turn-text TEST (P03). File: Code.gs
 *
 * Secrets live in Script Properties (Project Settings > Script Properties), never in this code:
 *   RC_SERVER, RC_CLIENT_ID, RC_CLIENT_SECRET, RC_JWT, RC_FROM_NUMBER, TEST_TO_NUMBER
 *
 * Run in this order from the editor:
 *   1. listMyNumbers     -> shows your numbers and which can text (SmsSender)
 *   2. sendTestText      -> texts TEST_TO_NUMBER only
 *   3. reply from your phone ("1", "DONE", a photo, or "STOP"), then run checkReplies
 *   4. installPollTrigger -> checkReplies every 5 min (removePollTrigger to stop)
 *
 * Safety: this test can ONLY text TEST_TO_NUMBER. Opted-out numbers are never texted.
 */

const STOP_WORDS = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'];
const START_WORDS = ['START', 'SUBSCRIBE', 'RESUME', 'CONTINUE', 'UNSTOP'];

function props_() { return PropertiesService.getScriptProperties(); }

function cfg_(key) {
  const v = props_().getProperty(key);
  if (!v) throw new Error('Missing Script Property: ' + key);
  return v.trim();
}

function server_() { return (props_().getProperty('RC_SERVER') || 'https://platform.ringcentral.com').trim(); }

/** Exchange the JWT credential for an access token (cached ~50 min). */
function rcToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('rc_token');
  if (hit) return hit;
  const basic = Utilities.base64Encode(cfg_('RC_CLIENT_ID') + ':' + cfg_('RC_CLIENT_SECRET'));
  const res = UrlFetchApp.fetch(server_() + '/restapi/oauth/token', {
    method: 'post',
    headers: { Authorization: 'Basic ' + basic },
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: cfg_('RC_JWT')
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Login failed (' + res.getResponseCode() + '): ' + res.getContentText());
  }
  const tok = JSON.parse(res.getContentText()).access_token;
  cache.put('rc_token', tok, 3000);
  return tok;
}

function rc_(method, path, body) {
  const opts = {
    method: method,
    headers: { Authorization: 'Bearer ' + rcToken_() },
    muteHttpExceptions: true
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(server_() + path, opts);
  const code = res.getResponseCode();
  if (code === 429) throw new Error('Rate limited, wait a minute and retry.');
  if (code >= 300) throw new Error(method.toUpperCase() + ' ' + path + ' failed (' + code + '): ' + res.getContentText());
  return JSON.parse(res.getContentText() || '{}');
}

function normalize_(n) { return String(n || '').replace(/[^\d+]/g, ''); }

/** Step 1: list your numbers. "CAN TEXT" = the number has the SmsSender feature. */
function listMyNumbers() {
  const data = rc_('get', '/restapi/v1.0/account/~/extension/~/phone-number?perPage=100');
  if (!data.records || !data.records.length) { Logger.log('This user owns no phone numbers.'); return; }
  data.records.forEach(function (r) {
    const feats = r.features || [];
    Logger.log('%s | %s | %s | features: %s',
      r.phoneNumber, r.usageType, feats.indexOf('SmsSender') >= 0 ? 'CAN TEXT' : 'no texting',
      feats.join(', '));
  });
}

/** Step 2: one test text to TEST_TO_NUMBER. */
function sendTestText() {
  const from = normalize_(cfg_('RC_FROM_NUMBER'));
  const to = normalize_(cfg_('TEST_TO_NUMBER'));
  if (isOptedOut_(to)) { Logger.log('%s replied STOP earlier. Not texting. Text START to re-enable.', to); return; }

  const mine = rc_('get', '/restapi/v1.0/account/~/extension/~/phone-number?perPage=100').records || [];
  const rec = mine.filter(function (r) { return normalize_(r.phoneNumber) === from; })[0];
  if (!rec) throw new Error(from + ' is not assigned to your RingCentral user. Run listMyNumbers.');
  if ((rec.features || []).indexOf('SmsSender') < 0) throw new Error(from + ' does not have texting (SmsSender) enabled.');

  const msg = rc_('post', '/restapi/v1.0/account/~/extension/~/sms', {
    from: { phoneNumber: from },
    to: [{ phoneNumber: to }],
    text: 'GPM turn test: Unit TEST is booked for you tomorrow. Reply 1 to confirm, DONE (add a photo) when finished, STOP to opt out.'
  });
  Logger.log('Sent. Message id %s, status %s', String(msg.id), msg.messageStatus);
  Utilities.sleep(3000);
  const st = rc_('get', '/restapi/v1.0/account/~/extension/~/message-store/' + msg.id);
  Logger.log('Status after 3s: %s', st.messageStatus);
}

/** Step 3: read inbound texts since the last check; classify 1 / DONE / STOP / START. */
function checkReplies() {
  const p = props_();
  const since = p.getProperty('LAST_CHECK') || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();
  const data = rc_('get', '/restapi/v1.0/account/~/extension/~/message-store' +
    '?messageType=SMS&direction=Inbound&perPage=100&dateFrom=' + encodeURIComponent(since));
  // API returns newest first; process oldest first so the LAST STOP/START wins.
  const recs = (data.records || []).sort(function (x, y) {
    return new Date(x.creationTime) - new Date(y.creationTime);
  });
  if (!recs.length) Logger.log('No new replies since %s', since);
  recs.forEach(function (m) {
    const fromNum = normalize_(m.from && m.from.phoneNumber);
    const text = (m.subject || '').trim();
    const word = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const photos = (m.attachments || []).filter(function (a) { return /^image\//.test(a.contentType || ''); });
    let kind = 'OTHER (flag for a person)';
    if (STOP_WORDS.indexOf(word) >= 0) { setOptOut_(fromNum, true); kind = 'OPT-OUT'; }
    else if (START_WORDS.indexOf(word) >= 0) { setOptOut_(fromNum, false); kind = 'OPT-IN'; }
    else if (word === '1') kind = 'CONFIRMED';
    else if (word.indexOf('DONE') === 0) kind = 'DONE';
    Logger.log('%s | %s | "%s" | %s photo(s) | %s', m.creationTime, fromNum, text, photos.length, kind);
  });
  p.setProperty('LAST_CHECK', now);
}

function optOuts_() { return JSON.parse(props_().getProperty('OPTED_OUT') || '[]'); }
function isOptedOut_(n) { return optOuts_().indexOf(normalize_(n)) >= 0; }
function setOptOut_(n, out) {
  const list = optOuts_().filter(function (x) { return x !== n; });
  if (out) list.push(n);
  props_().setProperty('OPTED_OUT', JSON.stringify(list));
}

/** Step 4: run checkReplies every 5 minutes. */
function installPollTrigger() {
  removePollTrigger();
  ScriptApp.newTrigger('checkReplies').timeBased().everyMinutes(5).create();
  Logger.log('checkReplies will run every 5 minutes.');
}

function removePollTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkReplies') ScriptApp.deleteTrigger(t);
  });
}
