// Books one real test reservation through the live web app, the way a resident would.
// Usage: node submit-test.mjs [webAppUrl]
// Leaves one "UI TEST" row in the Sheet; remove it with deleteTestRows() in Test.js.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';

const APP_URL = process.argv[2] ||
  'https://script.google.com/macros/s/AKfycbwOW7zCuPp8MqTzEoKYzFAqorDrTIZmKC52a_8wpgEPRo7pykqsMRi2NtCpwu6iOoling/exec';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (ok, name, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);

// GAS serves the page inside nested iframes; find the one that holds our markup.
async function appFrame(page) {
  for (let i = 0; i < 60; i++) {
    for (const f of page.frames()) {
      if (await f.$('#grid .day:not(.blank)').catch(() => null)) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Booking page never rendered its calendar');
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } }); // phone-ish width
try {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  let f = await appFrame(page);
  check(true, 'Page loads and calendar renders');

  // Go 5 months out so the test never collides with a real near-term booking.
  for (let i = 0; i < 5; i++) await f.click('#next');
  const month = await f.textContent('#monthLabel');

  // First fully open weekday in that month.
  const days = await f.$$('#grid button.day:not(.off):not(.partial):not(.holiday)');
  check(days.length > 0, 'Open dates available', `${days.length} in ${month}`);
  const dayNum = (await days[0].textContent()).trim();
  await days[0].click();
  await f.waitForSelector('#slotCard:not(.hidden)');
  const slotDate = await f.textContent('#slotDate');
  const slotCount = await f.$$eval('#slots .slot:not([disabled])', els => els.length);
  check(slotCount === 3, 'Three open slots on a normal day', String(slotCount));

  // Evening half.
  await f.click('#slots .slot:nth-child(2)');
  await f.waitForSelector('#payCard:not(.hidden)');
  const total = (await f.textContent('#totAmt')).trim();
  check(total === '$225', 'Evening half total = $25 fee + $200 deposit', total);

  // Empty submit must be blocked client-side.
  await f.click('#submit');
  const emptyErr = (await f.textContent('#err')).trim();
  check(/Please add/.test(emptyErr), 'Empty form blocked', emptyErr.slice(0, 80));

  await f.fill('#name', 'UI TEST Resident');
  await f.fill('#address', '1 Test Lane');
  await f.fill('#cell', '616-555-0100');
  await f.fill('#email', 'matt@greenpropertymgt.com');

  await f.check('input[name=alcohol][value=Yes]');
  const addendumShown = await f.isVisible('#alcoholBlock');
  check(addendumShown, 'Alcohol Yes shows the addendum');

  await f.check('#agree');
  await f.fill('#agreeSignature', 'UI TEST Resident');
  // Addendum not signed yet -> must be blocked.
  await f.click('#submit');
  const addErr = (await f.textContent('#err')).trim();
  check(/Alcohol Addendum/.test(addErr), 'Unsigned addendum blocked', addErr.slice(0, 80));

  await f.check('#alcoholAgree');
  await f.fill('#alcoholSignature', 'UI TEST Resident');
  await page.screenshot({ path: SHOTS + '1-filled.png', fullPage: true });
  await f.click('#submit');

  await f.waitForSelector('#done:not(.hidden)', { timeout: 60000 });
  const done = (await f.textContent('#doneText')).trim();
  check(/Booking ID PW-/.test(done), 'Booking confirmed on screen', done);
  await page.screenshot({ path: SHOTS + '2-done.png', fullPage: true });

  // Reload: same date's evening slot must now be taken, morning still open.
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  f = await appFrame(page);
  for (let i = 0; i < 5; i++) await f.click('#next');
  const btn = await f.$(`#grid button.day >> text=/^${dayNum}$/`);
  const cls = await btn.getAttribute('class');
  check(/partial/.test(cls), `${slotDate} now shows half-taken`, cls);
  await btn.click();
  await f.waitForSelector('#slotCard:not(.hidden)');
  const states = await f.$$eval('#slots .slot', els => els.map(e => (e.disabled ? 'X ' : 'ok ') + e.querySelector('b').textContent));
  check(states.join('|') === 'ok Morning half day|X Evening half day|X Full day',
    'Evening + Full now unavailable, Morning still open', states.join(' | '));
  await page.screenshot({ path: SHOTS + '3-after-reload.png', fullPage: true });
} catch (e) {
  check(false, 'Run aborted', e.message);
  await page.screenshot({ path: SHOTS + 'error.png', fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  console.log(results.join('\n'));
  console.log(`Screenshots: ${SHOTS}`);
}
