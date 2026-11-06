# GPM Turns: Spencer's scheduling assistant (P03 MVP)

Apps Script web app, clasp-linked (owner automation@). Data in the Executive Dash Supabase project.

- Script: https://script.google.com/d/10S_Dzwrz4wg-8LLSLzS7Q1wUs7APfay1k6D-eSuGyyX_l8HWQ8o2_hm4/edit
- Web app (domain only): https://script.google.com/a/macros/greenpropertymgt.com/s/AKfycbxSZWNz1j-XJGdB8AIuU9dopXVzlDAKZQKDZkXdVGO0Cu6tK73o3zL5hrmlplaXS0KZWA/exec
- Deploy: `clasp push -f && clasp deploy -i AKfycbxSZWNz1j-XJGdB8AIuU9dopXVzlDAKZQKDZkXdVGO0Cu6tK73o3zL5hrmlplaXS0KZWA -d "..."`
  (`clasp push` alone does NOT update the /exec URL). Careful: `clasp create` overwrites appsscript.json.

## One-time setup (Matt)
1. Supabase SQL Editor (Executive Dash): run `../db/001_turn_app.sql`.
2. Script Properties: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (same values as the warehouse pipeline).
3. In the editor run `checkSetup` (Code.js) once: authorizes the script and confirms the tables.

## Files
- `Code.js` server: Supabase calls (`apiBoot`, `apiSaveTurn`, `apiProperties`, `apiUnits`, settings).
- `Engine.html` scheduling rules (business days, Fed holidays, locked order, Appliances+Tech share,
  tub cure, pins, rent ready). Tested by `../app-test/engine.test.js` (`node app-test/engine.test.js`).
- `Config.html` defaults (durations, vendors, message template, cookie-cutter list) + the THREE FORM
  DRAFTS (`FORMS`). Form answers are stored as JSON, so changing fields needs no migration.
- `App.html` UI. `Index.html` shell + theme.
- Local preview with fake data: `node app-test/build-preview.js /tmp/x.html`, open in a browser.
