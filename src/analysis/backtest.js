// Phase 2c (Clearwing patterns): src/analysis/backtest.js
//
// Analysis 層: 副作用ありの計算・予測。バックテスト集計・キャリブレーション指標・
// Plackett-Luce 三連単 / 二連単確率モデル。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:ANALYSIS_BACKTEST:START */ ... /* BUILD:ANALYSIS_BACKTEST:END */
// に注入する。
//
// 依存:
//   - globalThis.STADIUMS (context 層、後 Phase で正式分離予定)
//
// Public (globalThis に export):
//   _btParseDate / runBacktestEngine / runForwardChainBacktest
//   _computeCalibrationMetrics
//
// Plackett-Luce 確率関数は src/utils/math.js が既に提供（重複させない）。
//
// 注: runBacktest（UI 駆動）/ runForwardChainNow（UI 駆動）は reporting 寄りのため
//     app.js に残置。本 module は純粋な計算ロジックのみ。

'use strict';

function _btParseDate(yyyymmdd){
  if(!yyyymmdd || typeof yyyymmdd !== 'string' || yyyymmdd.length !== 8) return null;
  return new Date(
    parseInt(yyyymmdd.slice(0,4),10),
    parseInt(yyyymmdd.slice(4,6),10) - 1,
    parseInt(yyyymmdd.slice(6,8),10)
  );
}

function runBacktestEngine(history, opt){
  opt = opt || {};
  const periodDays = opt.periodDays != null ? opt.periodDays : 14;
  const stakePerBet = opt.stakePerBet || 100;
  const ledger = [];

  // 期間フィルタ
  let cutoff = null;
  if(periodDays > 0){
    const d = new Date();
    d.setDate(d.getDate() - periodDays);
    cutoff = d;
  }
  history.forEach(function(h){
    if(!h.actual) return;
    if(cutoff){
      const hd = _btParseDate(h.date);
      if(!hd || hd < cutoff) return;
    }
    ledger.push(h);
  });

  // 集計
  let totalBets = 0, totalStake = 0, totalPayout = 0;
  let hits3 = 0, hits2 = 0;
  const dailyROI = {};
  let maxDD = 0, currentLoss = 0, balance = 0;
  const byType = { honmei: {n:0, hits:0, payout:0}, middle: {n:0, hits:0, payout:0}, ana: {n:0, hits:0, payout:0} };
  // B17 (2026-05-17): 場別集計を追加。回収率順で表示可能なよう sid -> 集計の dict を構築
  const byStadium = {};

  ledger.sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
  ledger.forEach(function(h){
    const bets3n = (h.trifecta_bets || []).length;
    const bets2n = (h.exacta_bets || []).length;
    const stake = (bets3n + bets2n) * stakePerBet;
    const payout = (h.payout3 || 0) + (h.payout2 || 0);
    totalBets += bets3n + bets2n;
    totalStake += stake;
    totalPayout += payout;
    if(h.trifecta_hit) hits3++;
    if(h.exacta_hit) hits2++;
    const rt = h.raceType || 'middle';
    if(byType[rt]){
      byType[rt].n++;
      if(h.trifecta_hit) byType[rt].hits++;
      byType[rt].payout += (h.payout3 || 0);
    }
    // B17: 場別集計
    const sid = parseInt(h.stadium);
    if(sid && sid >= 1 && sid <= 24){
      if(!byStadium[sid]) byStadium[sid] = {
        sid: sid,
        name: (typeof globalThis.STADIUMS === 'object' && globalThis.STADIUMS[sid]) || ('場'+sid),
        n: 0, hits3: 0, hits2: 0, stake: 0, payout: 0, payout3: 0,
      };
      const ss = byStadium[sid];
      ss.n++;
      ss.stake += stake;
      ss.payout += payout;
      ss.payout3 += (h.payout3 || 0);
      if(h.trifecta_hit) ss.hits3++;
      if(h.exacta_hit) ss.hits2++;
    }
    const net = payout - stake;
    balance += net;
    if(net < 0){
      currentLoss += -net;
      maxDD = Math.max(maxDD, currentLoss);
    } else {
      currentLoss = 0;
    }
    const d = h.date || 'unknown';
    if(!dailyROI[d]) dailyROI[d] = { stake: 0, payout: 0, n: 0 };
    dailyROI[d].stake += stake;
    dailyROI[d].payout += payout;
    dailyROI[d].n++;
  });

  const roi = totalStake > 0 ? totalPayout / totalStake : 0;
  const hitRate3 = ledger.length > 0 ? hits3 / ledger.length : 0;
  const hitRate2 = ledger.length > 0 ? hits2 / ledger.length : 0;

  // シャープレシオ（日次 net return / std）
  const dailyReturns = Object.keys(dailyROI).map(function(d){
    const s = dailyROI[d].stake;
    return s > 0 ? (dailyROI[d].payout - s) / s : 0;
  });
  const meanR = dailyReturns.length > 0 ? dailyReturns.reduce(function(a,b){ return a+b; }, 0) / dailyReturns.length : 0;
  const varR = dailyReturns.length > 1
    ? dailyReturns.reduce(function(a,r){ return a + (r-meanR)*(r-meanR); }, 0) / (dailyReturns.length - 1)
    : 0;
  const stdR = Math.sqrt(varR);
  const sharpe = stdR > 0 ? meanR / stdR : 0;

  // PB-10: log loss / Brier / ECE（mark_probs を保存している履歴のみ）
  const calibration = _computeCalibrationMetrics(ledger);

  return {
    samples: ledger.length,
    totalBets: totalBets,
    totalStake: totalStake,
    totalPayout: totalPayout,
    netProfit: totalPayout - totalStake,
    roi: roi,
    hitRate3: hitRate3,
    hitRate2: hitRate2,
    maxDrawdown: maxDD,
    sharpe: sharpe,
    byType: byType,
    byStadium: byStadium,
    dailyROI: dailyROI,
    period: periodDays,
    logLoss: calibration.logLoss,
    brier: calibration.brier,
    ece: calibration.ece,
    calibratedSamples: calibration.n,
    leakageNote: 'NOTE: 既存履歴は予想時点で既に L2 学習が反映済みのため look-ahead leakage の可能性あり。完全な forward-chain 評価には runForwardChainBacktest() を使用',
  };
}

// PB-3: Forward-chaining backtest（現状は履歴の logloss/brier/ece を時系列順で集計）
function runForwardChainBacktest(history, opt){
  opt = opt || {};
  const warmup = opt.warmupRaces != null ? opt.warmupRaces : 30;
  const sorted = (history||[]).slice().filter(function(h){
    return h.actual && h.actual.length>0 && Array.isArray(h.mark_probs);
  });
  sorted.sort(function(a,b){
    const d = (a.date||'').localeCompare(b.date||'');
    if(d !== 0) return d;
    return ((a.stadium||0) - (b.stadium||0)) || ((a.race||0) - (b.race||0));
  });
  const evalSet = sorted.slice(warmup);
  const cal = _computeCalibrationMetrics(evalSet);
  return {
    totalSamples: sorted.length,
    warmupSkipped: Math.min(warmup, sorted.length),
    evaluatedSamples: evalSet.length,
    logLoss: cal.logLoss,
    brier: cal.brier,
    ece: cal.ece,
    note: '時系列順で warmup 後のレースのみ評価。完全な forward-chain 再学習にはレース時点の features 保存が必要',
  };
}

// PB-10 ヘルパ: 各エントリの mark_probs と actual から calibration metrics を計算
function _computeCalibrationMetrics(entries){
  let logLossSum = 0, brierSum = 0, n = 0;
  const bins = []; for(let i=0; i<10; i++) bins.push({sum:0, hit:0, n:0});
  entries.forEach(function(h){
    if(!h.actual || !h.actual.length || !Array.isArray(h.mark_probs)) return;
    const winner = h.actual[0];
    const probs = {};
    h.mark_probs.forEach(function(mp){ probs[mp.boat] = mp.prob; });
    const pWin = probs[winner];
    if(!Number.isFinite(pWin) || pWin <= 0 || pWin >= 1) return;
    logLossSum += -Math.log(pWin);
    // Brier: Σ(p_i - y_i)^2 （6 艇 multi-class）
    for(let b=1; b<=6; b++){
      const p = probs[b] || 0; const y = (b === winner) ? 1 : 0;
      brierSum += (p-y) * (p-y);
    }
    // ECE: 1 着確率 vs 1 着率を 10 分位 bin で
    const binIdx = Math.min(9, Math.floor(pWin*10));
    bins[binIdx].sum += pWin;
    bins[binIdx].hit += 1;
    bins[binIdx].n   += 1;
    n++;
  });
  const logLoss = n > 0 ? logLossSum / n : 0;
  const brier   = n > 0 ? brierSum / n : 0;
  let ece = 0;
  bins.forEach(function(b){
    if(b.n === 0) return;
    const avgP = b.sum / b.n; const actRate = b.hit / b.n;
    ece += (b.n / Math.max(1, n)) * Math.abs(avgP - actRate);
  });
  return { logLoss: logLoss, brier: brier, ece: ece, n: n };
}

// 注: _plackettLuceTrifectaProb / _plackettLuceExactaProb は src/utils/math.js が
//     既に提供している（BUILD:MATH bundle 経由）。analysis 側では参照のみ。

// globalThis export
globalThis._btParseDate = _btParseDate;
globalThis.runBacktestEngine = runBacktestEngine;
globalThis.runForwardChainBacktest = runForwardChainBacktest;
globalThis._computeCalibrationMetrics = _computeCalibrationMetrics;
