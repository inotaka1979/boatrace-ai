// Manual screenshot capture for usage guide
// Run: node docs/manual/capture.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'images');
const BASE = process.env.MANUAL_BASE || 'http://127.0.0.1:8765/index.html';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();

async function shot(name, opts = {}) {
  const path = resolve(OUT, name + '.png');
  await page.screenshot({ path, fullPage: opts.full !== false, ...opts });
  console.log('[shot]', name, '->', path);
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// PWA 起動 — load 後の data fetch も少し待つ
await page.waitForTimeout(4000);

// 1) TOP
await shot('01-top');

// 2) Race list (scroll into one stadium)
const cards = await page.locator('.stadium-card').all();
if (cards.length > 0) {
  await cards[0].click();
  await page.waitForTimeout(2500);
  await shot('02-races');

  // 3) Race detail (open first race) — race rows are <tr data-action="openRace">
  const raceRow = page.locator('tr[data-action="openRace"]').first();
  if (await raceRow.count() > 0) {
    await raceRow.click();
    await page.waitForTimeout(3000);
    await shot('03-detail-lineup');

    // 4) AI tab
    const aiBtn = page.locator('[data-detail-tab="ai"]');
    if (await aiBtn.count() > 0) {
      await aiBtn.click();
      await page.waitForTimeout(1200);
      await shot('04-detail-ai');
    }

    // 5) Odds tab
    const oddsBtn = page.locator('[data-detail-tab="odds"]');
    if (await oddsBtn.count() > 0) {
      await oddsBtn.click();
      await page.waitForTimeout(1200);
      await shot('05-detail-odds');
    }
  } else {
    console.log('[skip] no race row found');
  }
}

// Back to top, then go through each bottom-nav page
async function bottomNav(action) {
  await page.evaluate((a) => {
    const btn = document.querySelector(`[data-action="${a}"]`);
    if (btn) btn.click();
  }, action);
  await page.waitForTimeout(1500);
}

// Stats
await page.evaluate(() => {
  const btn = document.querySelector('[data-action="showPage"][data-arg-page="stats"]');
  if (btn) btn.click();
});
await page.waitForTimeout(2500);
await shot('06-stats');

// Backtest
await page.evaluate(() => {
  const btn = document.querySelector('[data-action="showPage"][data-arg-page="backtest"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
await shot('07-backtest');

// Settings
await page.evaluate(() => {
  const btn = document.querySelector('[data-action="showPage"][data-arg-page="settings"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
await shot('08-settings');

// Bottom nav close-up
await page.evaluate(() => {
  const btn = document.querySelector('[data-action="showPage"][data-arg-page="top"]');
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
const nav = page.locator('nav.tab-bar, .tab-bar, nav[role="navigation"]').first();
if (await nav.count() > 0) {
  await nav.screenshot({ path: resolve(OUT, '09-bottom-nav.png') });
  console.log('[shot] 09-bottom-nav');
}

await browser.close();
console.log('done');
