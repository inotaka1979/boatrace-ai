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
  if (fails.length === 0 && cached.length === 0) {
    banner.style.display = 'none';
    return;
  }
  const parts = [];
  if (fails.length) parts.push('API取得失敗: ' + fails.join('/'));
  if (cached.length) parts.push('キャッシュ使用中: ' + cached.join('/'));
  msg.textContent = parts.join(' / ') + ' — 表示が古い可能性があります';
  banner.style.display = 'block';
}

// rt-fix P0-1 (2026-06-04): 鮮度バッジの意味論を修正。
//   旧: 「📡 X分前」= データ世代(updated_at, 約30分間隔) を表示 →
//       正常稼働でも常に「10〜30分前」と古く見え「更新されない」と誤認させていた。
//   新: 「📡 X分前」= 最終 fetch 成功時刻(_lastFetchOkAt) を表示 →
//       アプリが今もデータを取りに行けていることを正直に示す。
//       加えて、データ世代(updated_at) が著しく古い場合のみ「(更新待ち)」を併記し、
//       実際のデータ停止も隠さず可視化する（honest staleness）。
function _renderFreshness() {
  const el = document.getElementById('dataFreshness');
  if (!el) return;
  const now = Date.now();
  const fetchAt = _g._lastFetchOkAt || 0; // 最終 fetch 成功時刻
  const dataGen = Math.max(_g._dataLatestUpdatedAt || 0, _g._dataTodayConfirmedAt || 0); // データ世代

  if (!fetchAt && !dataGen) {
    el.textContent = '';
    return;
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

  // 主表示 = 最終 fetch 成功からの経過（アプリの生存）
  function _ago(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec < 60) return sec + '秒前';
    if (sec < 3600) return Math.floor(sec / 60) + '分前';
    return Math.floor(sec / 3600) + '時間前';
  }

  let label;
  let color;
  if (fetchAt) {
    const fsec = Math.floor((now - fetchAt) / 1000);
    label = '📡 ' + _ago(now - fetchAt);
    // fetch が新しいほど緑。polling は 90 秒間隔なので 180s 超で黄、600s 超で赤。
    color = fsec < 180 ? '#A5D6A7' : fsec < 600 ? '#FFCC80' : '#FF8A80';
  } else {
    // _lastFetchOkAt 未設定（初回描画前）はデータ世代で代替表示
    label = '📡 ' + _ago(now - dataGen);
    color = '#A5D6A7';
  }

  // 正直なデータ世代表示: データソースの更新が 40 分以上停止していたら併記。
  let note = '';
  if (dataGen) {
    const genMin = Math.floor((now - dataGen) / 60000);
    if (genMin >= 40) {
      note =
        '<span style="color:#FFCC80;font-size:0.85em"> ・データ更新待ち(' +
        (genMin < 120 ? genMin + '分' : Math.floor(genMin / 60) + '時間') +
        ')</span>';
    }
  }

  el.innerHTML = '<span style="color:' + color + '">' + label + '</span>' + note;
}

// globalThis export — 冒頭の _g 経由で Window インタフェースに整合
_g._renderApiHealthBanner = _renderApiHealthBanner;
_g._renderFreshness = _renderFreshness;
