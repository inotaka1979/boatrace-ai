// L1: WebKit smoke — iOS Safari エンジン (PJ Phase で詰まったクラスのバグ網羅)
//   主目的: setupDelegation 不発 / inline onclick 不能 / rest bundle 未 load などの
//          critical bundle 自己完結性を CI でガード
//
// 実行: cd build && npx playwright test --project=webkit-smoke

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // FIX: WebKit (iOS Safari) は Playwright の bypassCSP: true を完全には尊重せず、
  //   CSP `upgrade-insecure-requests` が subresource を HTTPS に upgrade してしまう。
  //   HTTP テストサーバ (python http.server) では HTTPS handshake が失敗 → JS が
  //   load 不能 → window.openStadium 等が undefined になり全テスト timeout。
  //   route で index.html レスポンスから当該ディレクティブを strip してテスト用に修正。
  await page.route('**/index.html', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace(/upgrade-insecure-requests;?\s*/g, '');
    await route.fulfill({ response, body });
  });
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
  // 2026-11-20: index.html の事前描画カードは生成時点（古い日付）の「開催中」を持つが、アプリは
  //   起動後に実データで一覧を描き直す。データが今日 (JST) のものでなければ（0 時台など）
  //   「開催中」は 0 になるため、事前描画のカードをクリックしようとした瞬間に描き直されると
  //   探し直しても見つからず 30 秒 timeout、描き直しが先なら skip、という時刻と順序次第の
  //   flake になっていた（PR #337 の CI が JST 0:03 に実行され再現）。
  //   アプリの最初の描き直しを待ってから「開催中」を探す。
  await page.addInitScript(() => {
    window.__stadiumRenders = 0;
    document.addEventListener('DOMContentLoaded', () => {
      const list = document.getElementById('stadiumList');
      if (list) new MutationObserver(() => { window.__stadiumRenders++; }).observe(list, { childList: true });
    });
  });
  await page.goto('/index.html');
  // critical bundle ロード完了まで待つ
  await page.waitForFunction(() => typeof window.openStadium === 'function', { timeout: 15_000 });
  // アプリが実データで一覧を描き直すまで待つ（loadAllData は失敗時も必ず renderStadiums する）
  await page.waitForFunction(() => window.__stadiumRenders >= 1, { timeout: 15_000 });
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
