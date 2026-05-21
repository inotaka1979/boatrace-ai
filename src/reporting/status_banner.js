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

function _renderApiHealthBanner(){
  const banner = document.getElementById('apiHealthBanner');
  const msg = document.getElementById('apiHealthMsg');
  if(!banner || !msg) return;
  const health = globalThis._apiHealth || {};
  const fails = [];
  const cached = [];
  for(const k in health){
    if(health[k] === 'fail') fails.push(k);
    else if(health[k] === 'cached') cached.push(k);
  }
  if(fails.length === 0 && cached.length === 0){
    banner.style.display = 'none';
    return;
  }
  const parts = [];
  if(fails.length)  parts.push('API取得失敗: ' + fails.join('/'));
  if(cached.length) parts.push('キャッシュ使用中: ' + cached.join('/'));
  msg.textContent = parts.join(' / ') + ' — 表示が古い可能性があります';
  banner.style.display = 'block';
}

function _renderFreshness(){
  const el = document.getElementById('dataFreshness');
  if(!el) return;
  // updated_at と race_date 両方の最新を比較（GitHub Pages 反映遅延対策）
  const latest = Math.max(
    globalThis._dataLatestUpdatedAt || 0,
    globalThis._dataTodayConfirmedAt || 0
  );
  if(!latest){ el.textContent = ''; return; }
  // データが今日 (JST) のものでなければ「待機中」表示（cron が本日まだ走っていない等）
  const todayJst = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const dataDate = new Date(latest+9*3600000).toISOString().slice(0,10);
  if(dataDate !== todayJst){
    el.innerHTML = '<span style="color:#BDBDBD">💤 本日データ取得待ち</span>';
    return;
  }
  const sec = Math.max(0, Math.floor((Date.now() - latest)/1000));
  let label;
  if(sec < 60)         label = sec + '秒前';
  else if(sec < 3600)  label = Math.floor(sec/60) + '分前';
  else                 label = Math.floor(sec/3600) + '時間前';
  // PE-2: header 背景 (#1A3A5C) で AA 適合な明色で表示
  const color = sec < 180 ? '#A5D6A7' : sec < 600 ? '#FFCC80' : '#FF8A80';
  el.innerHTML = '<span style="color:'+color+'">📡 '+label+'</span>';
}

// globalThis export
globalThis._renderApiHealthBanner = _renderApiHealthBanner;
globalThis._renderFreshness = _renderFreshness;
