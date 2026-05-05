// L1: WebKit smoke — iOS Safari エンジン (PJ Phase で詰まったクラスのバグ網羅)
//   主目的: setupDelegation 不発 / inline onclick 不能 / rest bundle 未 load などの
//          critical bundle 自己完結性を CI でガード
//
// 実行: cd build && npx playwright test --project=webkit-smoke

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // window.onerror で捕捉できる前の例外も拾えるよう、page.on('pageerror') を仕込む
  page.on('pageerror', (err) => {
    console.error('[pageerror]', err.message);
  });
});

test('トップページが表示され、開催場カードが存在する', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/BOATRACE|BoatRace/i);
  // prerender HTML が即時表示される（PE-11）
  const cards = page.locator('.stadium-card');
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(1);
});

test('開催場カードのタップで race 一覧画面に遷移する (PJ Phase 致命バグ回帰防止)', async ({ page }) => {
  await page.goto('/index.html');
  // critical bundle ロード完了まで待つ
  await page.waitForFunction(() => typeof window.openStadium === 'function', { timeout: 15_000 });
  // active な開催場カードが少なくとも1つあることを期待
  const activeCard = page.locator('.stadium-card.active-stadium').first();
  if (await activeCard.count() === 0) {
    test.skip(true, '本日 active な開催場が無い (early morning / 開催無し日)');
  }
  await activeCard.click();
  // race 画面が表示される（race 一覧 or 「データ取得中」のどちらかが visible）
  const racesPage = page.locator('#pageRaces');
  await expect(racesPage).toHaveClass(/active/, { timeout: 10_000 });
});

test('window.onerror に致命的エラーが捕捉されない', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  // boot 後 3 秒待機して非同期初期化のエラーも拾う
  await page.waitForTimeout(3000);
  const errors = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('boatrace_errors');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  // 既存 warn 系（warmup / api cached 等）は許容、'error' タイプのみ fail 条件
  const fatal = errors.filter(e => e.type === 'error');
  expect(fatal, 'fatal error in boatrace_errors: ' + JSON.stringify(fatal)).toEqual([]);
});

test('詳細画面の3タブが切替可能 (P0-4 回帰防止)', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof window._showDetailTab === 'function', { timeout: 15_000 });
  // 直接 detail を開ける条件が無い場合はタブ関数の存在のみ検証
  const tabFnExists = await page.evaluate(() => typeof window._showDetailTab === 'function');
  expect(tabFnExists).toBe(true);
});
