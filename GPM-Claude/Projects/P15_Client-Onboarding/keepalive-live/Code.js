// P15 Client Onboarding — Supabase keep-alive
//
// This project has no other automation writing to it yet (no Jotform
// webhook, no app UI) — everything anyone does to it is manual table-editor
// clicks — so it has zero organic traffic and is the highest pause risk of
// GPM's Supabase projects. This script's only job is to stop that.
//
// Before running setup(): open Project Settings in the Apps Script editor
// and add two Script Properties — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// — using the values from Supabase (Project Settings -> API). Never put the
// service_role key anywhere client-side; this script is the only place it
// belongs.
//
// Uses a daily WRITE (upsert), not a read — a read-only ping already proved
// insufficient to reliably block Supabase's free-tier auto-pause on another
// GPM project (gpm-warehouse-pipeline), which paused despite a daily
// read-only ping running clean the day before.

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pingSupabaseKeepAlive')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('pingSupabaseKeepAlive')
    .timeBased().everyDays(1).atHour(3).inTimezone('America/Detroit').create();
}

function sbConfig() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY script properties.');
  return { url: url.replace(/\/$/, ''), key };
}

// Supabase's newer secret-key format refuses to work over a browser-looking
// request (an anti-leak protection) — Apps Script's UrlFetchApp sends a
// browser-like User-Agent by default, which trips it. Override it with
// something clearly server-side.
const SB_USER_AGENT = 'GPM-P15-KeepAlive/1.0 (Google Apps Script)';

function pingSupabaseKeepAlive() {
  try {
    const { url, key } = sbConfig();
    UrlFetchApp.fetch(`${url}/rest/v1/keepalive_heartbeat?on_conflict=id`, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
        'User-Agent': SB_USER_AGENT,
      },
      payload: JSON.stringify([{ id: 1, pinged_at: new Date().toISOString() }]),
      muteHttpExceptions: true,
    });
  } catch (e) { /* a failed ping isn't worth alerting on */ }
}
