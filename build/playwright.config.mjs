// Epic 8: Playwright 設定 — WebKit smoke + 5 画面 VRT
// CI（ubuntu）でも開発機（RPi5/Pi等）でも実行可能なように、ローカル静的サーバを spawn する。
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export default defineConfig({
  testDir: resolve(ROOT, 'tests/e2e'),
  // VRT のしきい値（pixelmatch ベース）
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,   // 2% までは許容（フォントレンダ差異等）
      animations: 'disabled',
    },
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  use: {
    baseURL: 'http://127.0.0.1:8181',
    trace: 'on-first-retry',
    viewport: { width: 390, height: 844 }, // iPhone 13 mini 相当
  },
  projects: [
    {
      // L1: WebKit smoke — iOS Safari と同等エンジンでのクリティカルフロー検証
      name: 'webkit-smoke',
      use: { ...devices['iPhone 13'] },
      testMatch: /.*\.smoke\.spec\.mjs$/,
    },
    {
      // VRT: snapshot — Chromium で再現性高く撮影
      name: 'chromium-vrt',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      testMatch: /.*\.vrt\.spec\.mjs$/,
    },
  ],
  webServer: {
    // http-server を使う場合は別 npm script で起動するが、ここでは python の標準モジュールで間に合わせる
    command: 'python3 -m http.server 8181',
    cwd: ROOT,
    port: 8181,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
