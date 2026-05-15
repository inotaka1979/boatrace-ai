// VRT: 視覚回帰テスト — データ非依存な静的UI要素にスコープを絞る
//   差分は build/playwright-report/ で確認、baseline は tests/e2e/__screenshots__/ に commit
//   UI 変更時の更新: cd build && npm run test:vrt:update
//
// 設計原則:
//   - 動的データ (programs / results / API) に依存しない要素のみテスト
//   - Date.now / 時刻 / カウンタ等は固定 or マスクして flake 抑制
//   - mobile viewport (390x844 = iPhone 13) で撮影、PWA 想定

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Date.now を固定し、時刻依存の表示を安定化
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
  await page.waitForLoadState('domcontentloaded');
  // animation 抑制で flake 抑止
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
  });
});

test('top: 開催場グリッド (prerender + static layout)', async ({ page }) => {
  // prerender HTML が即時表示されるので data 不要
  await page.waitForSelector('.stadium-card', { timeout: 5000 });
  await expect(page.locator('header.header')).toHaveScreenshot('top-header.png', {
    mask: [page.locator('#headerDate'), page.locator('#dataFreshness')],
  });
});

test('detail-tabs: 3タブ レイアウト (P0-4)', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const detail = document.getElementById('pageDetail');
    if (detail) detail.classList.add('active');
  });
  const tabs = page.locator('.detail-tabs');
  await expect(tabs).toBeVisible();
  await expect(tabs).toHaveScreenshot('detail-tabs.png');
});

test('settings: KPI モード dropdown が描画される (P0-3)', async ({ page }) => {
  // showPage('settings') が rest bundle に依存するため、直接 page activate で要素のみ確認
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const s = document.getElementById('pageSettings');
    if (s) s.classList.add('active');
  });
  const kpi = page.locator('#setKpiMode');
  await expect(kpi).toBeAttached();
  // dropdown の親 row だけスナップショット（dbInfo 等の dynamic 部はマスク）
  await expect(kpi).toHaveScreenshot('settings-kpi-mode.png');
});

test('nav: 5ボタン bottom navigation', async ({ page }) => {
  const nav = page.locator('nav.nav');
  await expect(nav).toBeVisible();
  await expect(nav).toHaveScreenshot('bottom-nav.png');
});

test('api health banner: 障害時表示 (P0-7)', async ({ page }) => {
  // 2026-05-16: _renderApiHealthBanner が loadAllData 完了時に発火し、
  //   テストが直前に設定した display:block を再度 display:none に戻すレース。
  //   networkidle を待って初期 fetch を完了させ、_renderApiHealthBanner を
  //   no-op に置換してから DOM 状態を作る。
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => {
    // 後続の renderer 呼出で display が戻されないようにスタブ化
    try { globalThis._renderApiHealthBanner = function(){}; } catch (_) {}
    const b = document.getElementById('apiHealthBanner');
    if (b) {
      b.style.display = 'block';
      const m = document.getElementById('apiHealthMsg');
      if (m) m.textContent = 'API取得失敗: programs — 表示が古い可能性があります';
    }
  });
  const banner = page.locator('#apiHealthBanner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveScreenshot('api-health-banner.png');
});

// Epic 26: VRT 5→10 画面拡張

test('races page: レース一覧 page wrapper layout', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const r = document.getElementById('pageRaces');
    if (r) {
      r.classList.add('active');
      // 静的レイアウトのみテストするため内容を空に
      const t = document.getElementById('racesTitle');
      if (t) t.textContent = '桐生 1R';
      const list = document.getElementById('racesList');
      if (list) list.innerHTML = '<div class="card">レース一覧 (placeholder)</div>';
    }
  });
  const races = page.locator('#pageRaces.active');
  await expect(races).toBeVisible();
  await expect(races).toHaveScreenshot('races-page-wrapper.png', {
    mask: [page.locator('#headerDate'), page.locator('#dataFreshness')],
  });
});

test('detail page: 詳細画面 wrapper + tabs visible', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const d = document.getElementById('pageDetail');
    if (d) {
      d.classList.add('active');
      const t = document.getElementById('detailTitle');
      if (t) t.textContent = '桐生 1R 締切 12:00';
    }
  });
  const detail = page.locator('#pageDetail.active');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveScreenshot('detail-page-wrapper.png', {
    mask: [page.locator('#headerDate'), page.locator('#dataFreshness')],
  });
});

test('backtest page: 設定パネル', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const b = document.getElementById('pageBacktest');
    if (b) b.classList.add('active');
  });
  const bt = page.locator('#pageBacktest.active');
  await expect(bt).toBeVisible();
  await expect(bt).toHaveScreenshot('backtest-page.png', {
    mask: [page.locator('#headerDate'), page.locator('#dataFreshness')],
  });
});

test('language dropdown: 3言語選択 (Epic 22+25)', async ({ page }) => {
  await page.evaluate(() => {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const s = document.getElementById('pageSettings');
    if (s) s.classList.add('active');
  });
  const sel = page.locator('#setLocale');
  await expect(sel).toBeAttached();
  // 3つのオプションが含まれているか
  const options = await sel.locator('option').count();
  expect(options).toBe(3);
  await expect(sel).toHaveScreenshot('locale-dropdown.png');
});

test('header: API banner 非表示時のヘッダレイアウト', async ({ page }) => {
  // banner が非表示の通常状態
  await page.evaluate(() => {
    const b = document.getElementById('apiHealthBanner');
    if (b) b.style.display = 'none';
  });
  const header = page.locator('header.header');
  await expect(header).toBeVisible();
  await expect(header).toHaveScreenshot('header-normal.png', {
    mask: [page.locator('#headerDate'), page.locator('#dataFreshness')],
  });
});
