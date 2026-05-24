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

// 型付き globalThis ハンドル (Phase 4: JSDoc strict 整合用)
/** @type {BoatRaceGlobalAPI & typeof globalThis} */
const _g = /** @type {any} */ (globalThis);

/**
 * "YYYYMMDD" 文字列 → JST 想定の Date オブジェクト。
 * @param {string | null | undefined} yyyymmdd
 * @returns {Date | null}
 */
function _btParseDate(yyyymmdd) {
  if (!yyyymmdd || typeof yyyymmdd !== 'string' || yyyymmdd.length !== 8) return null;
  return new Date(
    parseInt(yyyymmdd.slice(0, 4), 10),
    parseInt(yyyymmdd.slice(4, 6), 10) - 1,
    parseInt(yyyymmdd.slice(6, 8), 10)
  );
}

/**
 * boatrace_history を「もし trifecta_bets / exacta_bets を 100 円ずつ均等買いしていたら」の前提で
 * 後付け集計し、ROI / 的中率 / 投資総額 / 払戻総額 / drawdown / シャープレシオを返す。
 *
 * @param {Array<any>} history  - boatrace_history の配列。actual / *_bets / payout3 / payout2 を持つ要素のみ集計対象。
 * @param {{ periodDays?: number; stakePerBet?: number }} [opt]
 *   periodDays=0 で全件、>0 で「直近 N 日」のみフィルタ。stakePerBet 既定 100 円。
 * @returns {{
 *   samples: number;
 *   totalBets: number;
 *   totalStake: number;
 *   totalPayout: number;
 *   netProfit: number;
 *   roi: number;
 *   hitRate3: number;
 *   hitRate2: number;
 *   maxDrawdown: number;
 *   sharpe: number;
 *   byType: Record<string, { n: number; hits: number; payout: number }>;
 *   byStadium: Record<number, { sid: number; name: string; n: number; hits3: number; hits2: number; stake: number; payout: number; payout3: number; roi?: number; roiCI?: { lo: number; hi: number; n: number } | null; races?: Array<{ stake: number; payout: number }> }>;
 *   dailyROI: Record<string, { stake: number; payout: number; n: number }>;
 *   period: number;
 *   logLoss: number;
 *   brier: number;
 *   ece: number;
 *   calibratedSamples: number;
 *   leakageNote: string;
 * }}
 */
function runBacktestEngine(history, opt) {
  opt = opt || {};
  const periodDays = opt.periodDays != null ? opt.periodDays : 14;
  const stakePerBet = opt.stakePerBet || 100;
  /** @type {Array<any>} */
  const ledger = [];

  // 期間フィルタ
  let cutoff = null;
  if (periodDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() - periodDays);
    cutoff = d;
  }
  history.forEach(function (h) {
    if (!h.actual) return;
    if (cutoff) {
      const hd = _btParseDate(h.date);
      if (!hd || hd < cutoff) return;
    }
    ledger.push(h);
  });

  // 集計
  let totalBets = 0,
    totalStake = 0,
    totalPayout = 0;
  let hits3 = 0,
    hits2 = 0;
  /** @type {Record<string, { stake: number; payout: number; n: number }>} */
  const dailyROI = {};
  let maxDD = 0,
    currentLoss = 0;
  // 旧 balance 変数は drawdown 計算には不要 (currentLoss だけで判定可能) のため削除
  /** @type {Record<string, { n: number; hits: number; payout: number }>} */
  const byType = {
    honmei: { n: 0, hits: 0, payout: 0 },
    middle: { n: 0, hits: 0, payout: 0 },
    ana: { n: 0, hits: 0, payout: 0 },
  };
  // B17 (2026-05-17): 場別集計を追加。回収率順で表示可能なよう sid -> 集計の dict を構築
  /** @type {Record<number, { sid: number; name: string; n: number; hits3: number; hits2: number; stake: number; payout: number; payout3: number; roi?: number; roiCI?: { lo: number; hi: number; n: number } | null; races?: Array<{ stake: number; payout: number }> }>} */
  const byStadium = {};

  ledger.sort(function (/** @type {any} */ a, /** @type {any} */ b) {
    return (a.date || '').localeCompare(b.date || '');
  });
  ledger.forEach(function (/** @type {any} */ h) {
    const bets3n = (h.trifecta_bets || []).length;
    const bets2n = (h.exacta_bets || []).length;
    const stake = (bets3n + bets2n) * stakePerBet;
    const payout = (h.payout3 || 0) + (h.payout2 || 0);
    totalBets += bets3n + bets2n;
    totalStake += stake;
    totalPayout += payout;
    if (h.trifecta_hit) hits3++;
    if (h.exacta_hit) hits2++;
    const rt = h.raceType || 'middle';
    if (byType[rt]) {
      byType[rt].n++;
      if (h.trifecta_hit) byType[rt].hits++;
      byType[rt].payout += h.payout3 || 0;
    }
    // B17: 場別集計
    const sid = parseInt(h.stadium);
    if (sid && sid >= 1 && sid <= 24) {
      if (!byStadium[sid])
        byStadium[sid] = {
          sid: sid,
          name: (typeof _g.STADIUMS === 'object' && _g.STADIUMS[sid]) || '場' + sid,
          n: 0,
          hits3: 0,
          hits2: 0,
          stake: 0,
          payout: 0,
          payout3: 0,
          // Tier 2 (2026-05-24): Bootstrap CI 用に per-race (stake, payout) を保持
          races: [],
        };
      const ss = byStadium[sid];
      ss.n++;
      ss.stake += stake;
      ss.payout += payout;
      ss.payout3 += h.payout3 || 0;
      if (ss.races) ss.races.push({ stake: stake, payout: payout });
      if (h.trifecta_hit) ss.hits3++;
      if (h.exacta_hit) ss.hits2++;
    }
    const net = payout - stake;
    if (net < 0) {
      currentLoss += -net;
      maxDD = Math.max(maxDD, currentLoss);
    } else {
      currentLoss = 0;
    }
    const d = h.date || 'unknown';
    if (!dailyROI[d]) dailyROI[d] = { stake: 0, payout: 0, n: 0 };
    dailyROI[d].stake += stake;
    dailyROI[d].payout += payout;
    dailyROI[d].n++;
  });

  const roi = totalStake > 0 ? totalPayout / totalStake : 0;
  const hitRate3 = ledger.length > 0 ? hits3 / ledger.length : 0;
  const hitRate2 = ledger.length > 0 ? hits2 / ledger.length : 0;

  // シャープレシオ（日次 net return / std）
  const dailyReturns = Object.keys(dailyROI).map(function (d) {
    const s = dailyROI[d].stake;
    return s > 0 ? (dailyROI[d].payout - s) / s : 0;
  });
  const meanR =
    dailyReturns.length > 0
      ? dailyReturns.reduce(function (a, b) {
          return a + b;
        }, 0) / dailyReturns.length
      : 0;
  const varR =
    dailyReturns.length > 1
      ? dailyReturns.reduce(function (a, r) {
          return a + (r - meanR) * (r - meanR);
        }, 0) /
        (dailyReturns.length - 1)
      : 0;
  const stdR = Math.sqrt(varR);
  const sharpe = stdR > 0 ? meanR / stdR : 0;

  // PB-10: log loss / Brier / ECE（mark_probs を保存している履歴のみ）
  const calibration = _computeCalibrationMetrics(ledger);

  // Tier 2 (2026-05-24): 場別 ROI の Bootstrap 95% CI。
  //   ROI = payout/stake は 1 回の高配当で大きく振れるため通常の平均±SE では
  //   信頼区間が歪む (歪度が大きい)。Bootstrap (1000 リサンプリング) で実 ROI
  //   分布から 2.5 / 97.5 パーセンタイルを取り、「avoid (CI 完全 < 1.0)」 /
  //   「favor (CI 完全 > 1.0)」 / 「未確定 (CI が 1.0 を跨ぐ)」を判別可能に。
  //   サンプル < 10 件は CI 幅が広すぎるため CI=null (UI 側で「N 不足」表示)。
  for (const sid in byStadium) {
    const ss = byStadium[sid];
    ss.roi = ss.stake > 0 ? ss.payout / ss.stake : 0;
    ss.roiCI = _bootstrapROICI(ss.races || [], 1000);
    // races 配列は CI 計算後は不要、payload 軽量化のため削除
    delete ss.races;
  }

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
    leakageNote:
      'NOTE: 既存履歴は予想時点で既に L2 学習が反映済みのため look-ahead leakage の可能性あり。完全な forward-chain 評価には runForwardChainBacktest() を使用',
  };
}

// PB-3: Forward-chaining backtest（現状は履歴の logloss/brier/ece を時系列順で集計）
/**
 * 時系列順で warmup 後のレースのみを評価するキャリブレーション。
 * 完全な forward-chain 再学習にはレース時点の features 保存が必要なため、
 * 暫定的に「保存済 mark_probs を時系列順で評価」する形で leakage を最小化。
 * @param {Array<any>} history
 * @param {{ warmupRaces?: number }} [opt]
 * @returns {{ totalSamples: number; warmupSkipped: number; evaluatedSamples: number; logLoss: number; brier: number; ece: number; note: string }}
 */
function runForwardChainBacktest(history, opt) {
  opt = opt || {};
  const warmup = opt.warmupRaces != null ? opt.warmupRaces : 30;
  const sorted = (history || []).slice().filter(function (/** @type {any} */ h) {
    return h.actual && h.actual.length > 0 && Array.isArray(h.mark_probs);
  });
  sorted.sort(function (/** @type {any} */ a, /** @type {any} */ b) {
    const d = (a.date || '').localeCompare(b.date || '');
    if (d !== 0) return d;
    return (a.stadium || 0) - (b.stadium || 0) || (a.race || 0) - (b.race || 0);
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
/**
 * 各エントリの mark_probs と actual から calibration metrics を計算。
 * log loss / Brier (6 艇 multi-class) / ECE (10 分位 bin) を返す。
 * @param {Array<any>} entries
 * @returns {{ logLoss: number; brier: number; ece: number; n: number }}
 */
/**
 * Tier 2: 場別 ROI の Bootstrap 95% CI 計算 (1000 リサンプリング既定)。
 *
 * @param {Array<{stake: number; payout: number}>} races - 場内の (stake, payout) ペア
 * @param {number} [nResamples=1000] - bootstrap 回数
 * @returns {{lo: number; hi: number; n: number} | null}
 *   サンプル < 10 件は CI 幅が広すぎ意味が無いため null を返す。
 */
function _bootstrapROICI(races, nResamples) {
  nResamples = nResamples || 1000;
  if (!Array.isArray(races) || races.length < 10) return null;
  const n = races.length;
  /** @type {number[]} */
  const rois = new Array(nResamples);
  // 簡易 LCG seed (Date.now ベースで session 毎に異なる、ただし同一 session 内で再現性あり)
  let seed = (Date.now() >>> 0) | 1;
  const _rand = function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let r = 0; r < nResamples; r++) {
    let sumStake = 0;
    let sumPayout = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(_rand() * n);
      sumStake += races[idx].stake;
      sumPayout += races[idx].payout;
    }
    rois[r] = sumStake > 0 ? sumPayout / sumStake : 0;
  }
  rois.sort(function (a, b) { return a - b; });
  const loIdx = Math.floor(nResamples * 0.025);
  const hiIdx = Math.ceil(nResamples * 0.975) - 1;
  return { lo: rois[loIdx], hi: rois[hiIdx], n: n };
}

/**
 * Tier 2: Reliability diagram (calibration plot) 用の bin 詳細を返す。
 * 既存の _computeCalibrationMetrics と並列に、UI 描画用の per-bin 数値を出す。
 *
 * @param {Array<any>} entries - boatrace_history (mark_probs を持つもののみ)
 * @returns {Array<{binStart: number; binEnd: number; avgP: number; actRate: number; n: number}>}
 *   binStart..binEnd は予測確率の範囲 (0..0.1, 0.1..0.2, ..., 0.9..1.0)
 *   avgP = bin 内予測確率平均、actRate = bin 内実 1 着率
 */
function _computeReliabilityBins(entries) {
  /** @type {Array<{ sum: number; hit: number; n: number }>} */
  const bins = [];
  for (let i = 0; i < 10; i++) bins.push({ sum: 0, hit: 0, n: 0 });
  entries.forEach(function (h) {
    if (!h.actual || !h.actual.length || !Array.isArray(h.mark_probs)) return;
    const winner = h.actual[0];
    /** @type {Record<number, number>} */
    const probs = {};
    h.mark_probs.forEach(function (mp) { probs[mp.boat] = mp.prob; });
    // 各 6 艇それぞれを bin に振り分け、勝者かどうかで hit 判定
    for (let b = 1; b <= 6; b++) {
      const p = probs[b];
      if (!Number.isFinite(p) || p <= 0 || p >= 1) continue;
      const binIdx = Math.min(9, Math.floor(p * 10));
      bins[binIdx].sum += p;
      bins[binIdx].n += 1;
      if (b === winner) bins[binIdx].hit += 1;
    }
  });
  return bins.map(function (b, i) {
    return {
      binStart: i / 10,
      binEnd: (i + 1) / 10,
      avgP: b.n > 0 ? b.sum / b.n : 0,
      actRate: b.n > 0 ? b.hit / b.n : 0,
      n: b.n,
    };
  });
}

function _computeCalibrationMetrics(entries) {
  let logLossSum = 0,
    brierSum = 0,
    n = 0;
  /** @type {Array<{ sum: number; hit: number; n: number }>} */
  const bins = [];
  for (let i = 0; i < 10; i++) bins.push({ sum: 0, hit: 0, n: 0 });
  entries.forEach(function (/** @type {any} */ h) {
    if (!h.actual || !h.actual.length || !Array.isArray(h.mark_probs)) return;
    const winner = h.actual[0];
    /** @type {Record<number, number>} */
    const probs = {};
    h.mark_probs.forEach(function (/** @type {any} */ mp) {
      probs[mp.boat] = mp.prob;
    });
    const pWin = probs[winner];
    if (!Number.isFinite(pWin) || pWin <= 0 || pWin >= 1) return;
    logLossSum += -Math.log(pWin);
    // Brier: Σ(p_i - y_i)^2 （6 艇 multi-class）
    for (let b = 1; b <= 6; b++) {
      const p = probs[b] || 0;
      const y = b === winner ? 1 : 0;
      brierSum += (p - y) * (p - y);
    }
    // ECE: 1 着確率 vs 1 着率を 10 分位 bin で
    const binIdx = Math.min(9, Math.floor(pWin * 10));
    bins[binIdx].sum += pWin;
    bins[binIdx].hit += 1;
    bins[binIdx].n += 1;
    n++;
  });
  const logLoss = n > 0 ? logLossSum / n : 0;
  const brier = n > 0 ? brierSum / n : 0;
  let ece = 0;
  bins.forEach(function (b) {
    if (b.n === 0) return;
    const avgP = b.sum / b.n;
    const actRate = b.hit / b.n;
    ece += (b.n / Math.max(1, n)) * Math.abs(avgP - actRate);
  });
  return { logLoss: logLoss, brier: brier, ece: ece, n: n };
}

// 注: _plackettLuceTrifectaProb / _plackettLuceExactaProb は src/utils/math.js が
//     既に提供している（BUILD:MATH bundle 経由）。analysis 側では参照のみ。

// globalThis export — 冒頭の _g 経由で Window インタフェースに整合
_g._btParseDate = _btParseDate;
_g.runBacktestEngine = runBacktestEngine;
_g.runForwardChainBacktest = runForwardChainBacktest;
_g._computeCalibrationMetrics = _computeCalibrationMetrics;
// Tier 2 (2026-05-24) UI 駆動関数
_g._bootstrapROICI = _bootstrapROICI;
_g._computeReliabilityBins = _computeReliabilityBins;
