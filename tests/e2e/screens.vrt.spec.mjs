// VRT: 5 画面スナップショット差分検出
//   差分は build/playwright-report/ で確認、baseline は tests/e2e/__screenshots__/ に commit
//   UI 変更時の更新: cd build && npx playwright test --project=chromium-vrt --update-snapshots

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // 動的データ（時刻・残り時間等）の差分でフレークしないよう、Date.now を固定する
  await page.addInitScript(() => {
    const FIXED = new Date('2026-05-05T12:00:00+09:00').getTime();
    const RealDate = Date;
    Date = class extends RealDate {
      constructor(...args) {
        return args.length === 0 ? new RealDate(FIXED) : new RealDate(...args);
      }
      static now() { return FIXED; }
    };
  });
  await page.goto('/index.html');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  // CSS animation を抑制（Q9 が未対応の環境でも安定化）
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
  });
});

test('top: 開催場グリッド', async ({ page }) => {
  await expect(page).toHaveScreenshot('top.png', {
    fullPage: false,
    mask: [page.locator('#headerDate'), page.locator('#dataFreshness')],
  });
});

test('settings: 設定一覧', async ({ page }) => {
  await page.evaluate(() => window.showPage && window.showPage('settings'));
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot('settings.png', {
    fullPage: false,
    mask: [page.locator('#dbInfo')],   // localStorage 容量はマシン依存
  });
});

test('stats: 成績トラッカー', async ({ page }) => {
  await page.evaluate(() => window.showPage && window.showPage('stats'));
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot('stats.png', {
    fullPage: false,
    mask: [page.locator('#statSummary'), page.locator('#statRecovery')],
  });
});

test('detail tab buttons (P0-4): 3タブ存在の見た目固定', async ({ page }) => {
  // 詳細を開かなくてもタブHTMLは静的に存在 → DOM を直接表示して取る
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const detail = document.getElementById('pageDetail');
    if (detail) detail.classList.add('active');
  });
  const tabs = page.locator('.detail-tabs');
  await expect(tabs).toBeVisible();
  await expect(tabs).toHaveScreenshot('detail-tabs.png');
});

test('api health banner (P0-7): 障害バナーの見た目固定', async ({ page }) => {
  await page.evaluate(() => {
    if (typeof window._setApiHealth === 'function') {
      window._setApiHealth('/programs/', 'fail');
    }
  });
  const banner = page.locator('#apiHealthBanner');
  await expect(banner).toBeVisible({ timeout: 3000 });
  await expect(banner).toHaveScreenshot('api-health-banner.png');
});
