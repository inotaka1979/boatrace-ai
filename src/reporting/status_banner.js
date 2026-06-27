// Phase 2d (Clearwing patterns): src/reporting/status_banner.js
//
// Reporting 層: 出力・記録（DOM 更新が主体）。
// 本モジュールは「データ鮮度バッジ」「API ヘルス警告バナー」の 2 つの UI 状態描画を担う。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:REPORTING_STATUS_BANNER:START */ ... /* BUILD:REPORTING_STATUS_BANNER:END */
// に注入する。
//
// 依存（globalThis 経由）:
//   - _apiHealth (discovery 層で管理する API 状態 dict)
//   - _dataLatestUpdatedAt / _dataTodayConfirmedAt (app.js 内 state)
//
// Public:
//   _renderApiHealthBanner / _renderFreshness

'use strict';

// 型付き globalThis ハンドル (Phase 4: JSDoc strict 整合用)
/** @type {BoatRaceGlobalAPI & typeof globalThis} */
const _g = /** @type {any} */ (globalThis);

function _renderApiHealthBanner() {
  const banner = document.getElementById('apiHealthBanner');
  const msg = document.getElementById('apiHealthMsg');
  if (!banner || !msg) return;
  const health = _g._apiHealth || {};
  const fails = [];
  const cached = [];
  for (const k in health) {
    if (health[k] === 'fail') fails.push(k);
    else if (health[k] === 'cached') cached.push(k);
  }
  // rt-fix3 P0-6: Worker 死活（/health?strict=1）の結果も併せて表示する。
  const workerDown = _g._workerHealthy === false;
  if (fails.length === 0 && cached.length === 0 && !workerDown) {
    banner.style.display = 'none';
    return;
  }
  const parts = [];
  if (workerDown) parts.push('リアルタイム配信が停止中 — 直接取得に切替済み');
  if (fails.length) parts.push('API取得失敗: ' + fails.join('/'));
  if (cached.length) parts.push('キャッシュ使用中: ' + cached.join('/'));
  msg.textContent = parts.join(' / ') + ' — 表示が古い可能性があります';
  banner.style.display = 'block';
}

// rt-fix3 (2026-06-27): 鮮度バッジを「データ世代」基準に戻す（最重要修正）。
//   rt-fix P0-1 (2026-06-04) は主表示を _lastFetchOkAt（fetch 成功時刻）にしたが、
//   Worker が stale な KV を 200 で返すケースでは「fetch 成功＝緑」のまま中身は
//   数十分〜数時間古い、という「緑なのに古い」誤認を生み、ユーザーの「更新されない」
//   体感の主因になっていた。新仕様:
//     - 主表示 = データ世代(updated_at) の経過時間（＝データの新しさの真値）。
//       色も世代基準（緑<15分 / 黄<40分 / 赤≥40分、上流 openapi ~30分間隔に較正）。
//     - _lastFetchOkAt は「接続が生きているか」の副次インジケータに降格。
//   回帰防止: scripts/tests/test_status_banner_freshness.js が stale 隠蔽を禁止する。
function _renderFreshness() {
  const el = document.getElementById('dataFreshness');
  if (!el) return;
  const now = Date.now();
  const fetchAt = _g._lastFetchOkAt || 0; // 最終 fetch 成功時刻（接続生存）
  // rt-fix3 fix: データ世代は updated_at(=_dataLatestUpdatedAt) のみ。
  //   旧実装は Math.max(_dataLatestUpdatedAt, _dataTodayConfirmedAt) としていたが、
  //   _dataTodayConfirmedAt は「今日のデータを確認した壁時計時刻(=ほぼ now)」のため
  //   常に「0秒前」になり、stale を隠すという当初の不具合を再発させていた。
  const dataGen = _g._dataLatestUpdatedAt || 0; // 真のデータ世代 (updated_at)

  if (!fetchAt && !dataGen) {
    el.textContent = '';
    return;
  }

  function _ago(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return sec + '秒前';
    if (sec < 3600) return Math.floor(sec / 60) + '分前';
    return Math.floor(sec / 3600) + '時間前';
  }

  // データ世代が今日 (JST) でなければ「本日データ取得待ち」（cron 未実行 / 開催前）
  const todayJst = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  if (dataGen) {
    const dataDate = new Date(dataGen + 9 * 3600000).toISOString().slice(0, 10);
    if (dataDate !== todayJst) {
      el.innerHTML = '<span style="color:#BDBDBD">💤 本日データ取得待ち</span>';
      return;
    }
  }

  // 主表示 = データ世代の経過時間（＝実際のデータの新しさ。これを偽らない）
  let label;
  let color;
  if (dataGen) {
    const genMin = Math.floor((now - dataGen) / 60000);
    label = '🕒 ' + _ago(now - dataGen);
    color = genMin < 15 ? '#A5D6A7' : genMin < 40 ? '#FFCC80' : '#FF8A80';
  } else {
    label = '🕒 取得中';
    color = '#BDBDBD';
  }

  // 副次 = 接続状態（アプリが今もデータを取りに行けているか）
  let conn = '';
  if (fetchAt) {
    const fsec = Math.floor((now - fetchAt) / 1000);
    conn =
      fsec < 300
        ? '<span style="color:#81C784;font-size:0.85em"> ・📡接続OK</span>'
        : '<span style="color:#FF8A80;font-size:0.85em"> ・📡接続不調(' + _ago(now - fetchAt) + ')</span>';
  } else {
    conn = '<span style="color:#FFCC80;font-size:0.85em"> ・📡未接続</span>';
  }

  el.innerHTML = '<span style="color:' + color + '">' + label + '</span>' + conn;
}

// globalThis export — 冒頭の _g 経由で Window インタフェースに整合
_g._renderApiHealthBanner = _renderApiHealthBanner;
_g._renderFreshness = _renderFreshness;
