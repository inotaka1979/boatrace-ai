#!/usr/bin/env node
/**
 * PR-11 (2026-07-26): オフライン履歴バックテスト CLI。
 *
 * 現行の runBacktestEngine は localStorage の自己予測ログ (新規端末では 0 件) を
 * 入力にするため「1 号艇ベタ買いより強いのか」に答えられない (A-02)。本 CLI は
 * 過去の番組表 + 展示 + 結果 + オッズを流し込み、predictRace を forward-chain で
 * 回して ROI / logLoss / Brier / ECE をベースライン 3 種と比較する。
 *
 * 使い方:
 *   node scripts/backtest_offline.mjs --from 20260401 --to 20260630 \
 *        --archive data/archive --out build/backtest.json
 *   make backtest FROM=20260401 TO=20260630
 *
 * 入力 (1 日 1 ディレクトリ):
 *   <archive>/<YYYYMMDD>/programs.json  { programs: [{race_stadium_number, race_number,
 *       race_grade_number, boats:[{racer_boat_number, racer_number, racer_class_number,
 *       racer_national_top_1_percent, racer_local_top_2_percent,
 *       racer_assigned_motor_top_2_percent, racer_assigned_boat_top_2_percent,
 *       racer_flying_count, racer_late_count}]}] }
 *   <archive>/<YYYYMMDD>/previews.json  { previews: [{race_stadium_number, race_number,
 *       weather:{wind_speed,wind_direction,wave_height,water_temperature},
 *       boats:[{racer_boat_number, racer_course_number, racer_exhibition_time,
 *       racer_start_timing}]}] }   (省略可: 番組のみで予測)
 *   <archive>/<YYYYMMDD>/odds.json      { odds: [{stadium, race, trifecta:{combo:odds},
 *       win:{boat:odds}}] }
 *   <archive>/<YYYYMMDD>/results.json   { results: [{race_stadium_number, race_number,
 *       boats:[{racer_boat_number, racer_place_number, racer_course_number}],
 *       payouts:{trifecta:[{combination,amount}], win:[{combination,amount}]}}] }
 *
 * ★リーク防止★ racerDB / stadiumDB は「その日より前の結果のみ」で構築する
 *   (foldResultsIntoDB を予測の後に呼ぶ)。--leak を付けると当日結果を先に畳み込み、
 *   未来情報リークで ROI が跳ねることを実証できる (テスト用)。
 *
 * ★オッズ★ 「締切直前の最終オッズ」を使うため、実際にはこの価格で買えない。
 *   ROI は楽観側にバイアスする (oddsNote に明記)。
 *
 * ★L2★ 本 CLI は L2 オンライン学習を再現しない (l2trainStep=0 のまま = alpha≈1,
 *   L1 単独)。これも modelNote に明記する。
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { makeCtx } = require('./tests/_vm_harness.js');

// ---------- args ----------
function parseArgs(argv) {
  const a = { archive: 'data/archive', out: null, leak: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--from') a.from = argv[++i];
    else if (t === '--to') a.to = argv[++i];
    else if (t === '--archive') a.archive = argv[++i];
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--leak') a.leak = true;
  }
  return a;
}

function datesInRange(from, to) {
  // YYYYMMDD 文字列を昇順に列挙 (Date は使うが CLI なので許容)
  const out = [];
  const d = new Date(Number(from.slice(0, 4)), Number(from.slice(4, 6)) - 1, Number(from.slice(6, 8)));
  const end = new Date(Number(to.slice(0, 4)), Number(to.slice(4, 6)) - 1, Number(to.slice(6, 8)));
  while (d <= end) {
    out.push('' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function loadDay(archive, date) {
  // 2 レイアウトを許容:
  //   subdir : <archive>/<date>/{programs,previews,odds,results}.json
  //   flat   : <archive>/<domain>/<date>.json  (archive_daily.py 出力 = data/)
  const sub = path.join(archive, date);
  let programs, previews, odds, results;
  if (fs.existsSync(sub)) {
    programs = loadJson(path.join(sub, 'programs.json'));
    results = loadJson(path.join(sub, 'results.json'));
    previews = loadJson(path.join(sub, 'previews.json'));
    odds = loadJson(path.join(sub, 'odds.json'));
  } else {
    programs = loadJson(path.join(archive, 'programs', date + '.json'));
    results = loadJson(path.join(archive, 'results', date + '.json'));
    previews = loadJson(path.join(archive, 'previews', date + '.json'));
    odds = loadJson(path.join(archive, 'odds', date + '.json'));
  }
  if (!programs || !results) return null;
  return {
    date,
    programs: programs.programs || [],
    // previews は today.json スキーマだと "races" キー (省略可・番組予想に fallback)
    previews: (previews && (previews.previews || previews.races)) || [],
    odds: (odds && odds.odds) || [],
    results: results.results || [],
  };
}

// ---------- state builders ----------
function buildState(day) {
  const programData = {};
  day.programs.forEach((p) => {
    var sid = p.race_stadium_number, rno = p.race_number;
    if (sid == null || rno == null) return;
    (programData[sid] = programData[sid] || {})[rno] = {
      boats: p.boats || [],
      race_grade_number: p.race_grade_number || 0,
      race_closed_at: p.race_closed_at || '',
    };
  });
  const previewData = {};
  day.previews.forEach((p) => {
    var sid = p.race_stadium_number, rno = p.race_number;
    if (sid == null || rno == null) return;
    var boats = {};
    (p.boats || []).forEach((b) => { if (b && b.racer_boat_number) boats[String(b.racer_boat_number)] = b; });
    (previewData[sid] = previewData[sid] || {})[rno] = { weather: p.weather || {}, boats: boats };
  });
  const oddsData = { odds: day.odds || [] };
  return { programData, previewData, oddsData };
}

function progIndex(day) {
  // (sid,rno,boat) -> racer_number
  const idx = {};
  day.programs.forEach((p) => {
    (p.boats || []).forEach((b) => {
      if (b && b.racer_boat_number != null && b.racer_number != null) {
        idx[p.race_stadium_number + '|' + p.race_number + '|' + b.racer_boat_number] = b.racer_number;
      }
    });
  });
  return idx;
}

// 当日結果を racerDB.recentResults / stadiumDB へ畳み込む (forward-chain)
function foldResultsIntoDB(day, racerDB, stadiumDB) {
  const idx = progIndex(day);
  day.results.forEach((r) => {
    const boats = r.boats || [];
    if (!boats.length) return;
    const sid = r.race_stadium_number, rno = r.race_number;
    boats.forEach((b) => {
      const place = b.racer_place_number, course = b.racer_course_number, bn = b.racer_boat_number;
      if (Number.isInteger(course) && course >= 1 && course <= 6) {
        const sd = (stadiumDB[sid] = stadiumDB[sid] || { courseWinRate: {}, _c: {} });
        const cc = (sd._c[course] = sd._c[course] || { races: 0, wins: 0 });
        cc.races++; if (place === 1) cc.wins++;
        sd.courseWinRate[course] = { races: cc.races, win: cc.wins };
      }
      if (Number.isInteger(place) && place >= 1 && place <= 6) {
        const rn = idx[sid + '|' + rno + '|' + bn];
        if (rn != null) {
          const key = String(rn);
          if (!racerDB[key]) racerDB[key] = { courseStats: {}, courseStyle: {}, recentResults: [], lastUpdated: '' };
          racerDB[key].recentResults.push(place);
          if (racerDB[key].recentResults.length > 20) racerDB[key].recentResults.shift();
        }
      }
    });
  });
}

// ---------- scoring helpers ----------
function actualOrder(result) {
  return (result.boats || [])
    .filter((b) => Number.isInteger(b.racer_place_number))
    .sort((a, b) => a.racer_place_number - b.racer_place_number)
    .map((b) => b.racer_boat_number);
}
function payoutMap(list) {
  const m = {};
  (list || []).forEach((x) => { if (x && x.combination != null) m[String(x.combination)] = x.amount; });
  return m;
}
function favoriteBoat(oddsWin) {
  let best = null, bestOdds = Infinity;
  for (let b = 1; b <= 6; b++) {
    const o = oddsWin && oddsWin[String(b)];
    if (o != null && o < bestOdds) { bestOdds = o; best = b; }
  }
  return best;
}

// ---------- metrics ----------
function summarize(rec) {
  // rec: { stake, payout, races, hits, netPerRace: [] }
  const roi = rec.stake > 0 ? rec.payout / rec.stake : 0;
  const hitRate = rec.races > 0 ? rec.hits / rec.races : 0;
  return { races: rec.races, bets: rec.bets, stake: rec.stake, payout: rec.payout,
    roi: round4(roi), hitRate: round4(hitRate) };
}
function round4(n) { return Math.round(n * 1e4) / 1e4; }

// bootstrap 95% CI on per-race ROI (payout/stake per race)
function bootstrapRoiCI(perRace, iters) {
  const n = perRace.length;
  if (n === 0) return { lo: 0, hi: 0 };
  const rois = [];
  for (let it = 0; it < iters; it++) {
    let pay = 0, stk = 0;
    for (let k = 0; k < n; k++) {
      const s = perRace[(Math.random() * n) | 0];
      pay += s.payout; stk += s.stake;
    }
    rois.push(stk > 0 ? pay / stk : 0);
  }
  rois.sort((a, b) => a - b);
  return { lo: round4(rois[Math.floor(iters * 0.025)]), hi: round4(rois[Math.floor(iters * 0.975)]) };
}

// model の確率分布 (marks) から logLoss / Brier を actual winner に対して計算
function calibChunk(marks, winnerBoat) {
  const p = {};
  let tot = 0;
  marks.forEach((m) => { p[m.boat] = Math.max(1e-9, Math.min(1 - 1e-9, m.prob)); tot += p[m.boat]; });
  for (const k in p) p[k] /= tot || 1;
  const pw = p[winnerBoat] || 1e-9;
  const logLoss = -Math.log(pw);
  let brier = 0;
  for (let b = 1; b <= 6; b++) { const y = b === winnerBoat ? 1 : 0; const pb = p[b] || 0; brier += (pb - y) * (pb - y); }
  return { logLoss, brier, topProb: p[marks[0].boat] || 0, winnerProb: pw };
}

// ---------- main ----------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.from || !args.to) {
    console.error('usage: node scripts/backtest_offline.mjs --from YYYYMMDD --to YYYYMMDD [--archive dir] [--out file] [--leak]');
    process.exit(2);
  }
  const ctx = makeCtx();
  ctx.settings = { betCount3: 10, betCount2: 5, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'off', evMin: 1.15, bankroll: 10000 };
  ctx.racerDB = {};
  ctx.stadiumDB = {};
  ctx.l2trainStep = 0;

  const STRAT = ['model_prob', 'model_ev', 'baseline_inner', 'baseline_fav', 'baseline_pop3'];
  const acc = {};
  STRAT.forEach((s) => { acc[s] = { races: 0, bets: 0, stake: 0, payout: 0, hits: 0, perRace: [] }; });
  const calib = []; // {logLoss, brier, topProb, correct}
  let daysUsed = 0, racesScored = 0;

  const dates = datesInRange(args.from, args.to);
  for (const date of dates) {
    const day = loadDay(args.archive, date);
    if (!day) continue;
    daysUsed++;

    if (args.leak) foldResultsIntoDB(day, ctx.racerDB, ctx.stadiumDB); // ← リーク: 予測前に当日結果を混入

    const state = buildState(day);
    ctx.programData = state.programData;
    ctx.previewData = state.previewData;
    ctx.oddsData = state.oddsData;

    day.results.forEach((res) => {
      const order = actualOrder(res);
      if (order.length < 3) return; // 未確定
      const sid = res.race_stadium_number, rno = res.race_number;
      const bets = ctx.predictRace(sid, rno);
      if (!bets || !bets.marks) return;
      racesScored++;
      const winner = order[0];
      const triCombo = order.slice(0, 3).join('-');
      const triPay = payoutMap(res.payouts && res.payouts.trifecta);
      const winPay = payoutMap(res.payouts && res.payouts.win);
      const raceOdds = (state.oddsData.odds || []).find((o) => o.stadium === sid && o.race === rno);

      // --- calibration (model 分布) ---
      calib.push(Object.assign(calibChunk(bets.marks, winner), { correct: bets.marks[0].boat === winner }));

      // --- model_prob: 確率順 top-N 三連単、各 ¥100 ---
      scoreTrifectaBets(acc.model_prob, (bets.trifecta || []).map((t) => t.combo), triCombo, triPay);

      // --- model_ev: EV モード (オッズ必須) ---
      if (raceOdds && raceOdds.trifecta) {
        const evBets = ctx.generateBetsV2(bets.marks, 'ev', 10, 5, raceOdds, { evMin: 1.15, maxBets: 10, bankroll: 10000 });
        scoreTrifectaBets(acc.model_ev, (evBets.trifecta || []).map((t) => t.combo), triCombo, triPay);
      } else {
        acc.model_ev.races++;
      }

      // --- baseline_inner: 1 号艇 単勝 ¥100 ---
      scoreWinBet(acc.baseline_inner, 1, winner, winPay);

      // --- baseline_fav: 単勝 1 番人気 ¥100 ---
      const fav = raceOdds ? favoriteBoat(raceOdds.win) : null;
      if (fav != null) scoreWinBet(acc.baseline_fav, fav, winner, winPay);
      else acc.baseline_fav.races++;

      // --- baseline_pop3: 三連単 人気順(オッズ昇順) 上位 10 点 ---
      if (raceOdds && raceOdds.trifecta) {
        const pop = Object.keys(raceOdds.trifecta)
          .filter((c) => raceOdds.trifecta[c] != null && raceOdds.trifecta[c] > 0)
          .sort((a, b) => raceOdds.trifecta[a] - raceOdds.trifecta[b])
          .slice(0, 10);
        scoreTrifectaBets(acc.baseline_pop3, pop, triCombo, triPay);
      } else {
        acc.baseline_pop3.races++;
      }
    });

    if (!args.leak) foldResultsIntoDB(day, ctx.racerDB, ctx.stadiumDB); // ← 正常: 予測の後に畳み込む
  }

  // ---- calibration 集計 (ECE 10 bin) ----
  const cal = computeECE(calib);

  const strategies = {};
  STRAT.forEach((s) => {
    strategies[s] = Object.assign(summarize(acc[s]), { roiCI: bootstrapRoiCI(acc[s].perRace, 2000) });
  });

  const out = {
    range: { from: args.from, to: args.to },
    daysUsed, racesScored,
    leak: args.leak,
    strategies,
    modelCalibration: cal,
    leakageNote: args.leak
      ? 'LEAK MODE: 当日結果を予測前に DB へ畳み込んでいる。ROI は無効 (未来情報リーク)。'
      : 'racerDB/stadiumDB は前日以前の結果のみで構築 (forward-chain)。L2 オンライン学習は未再現 (l2trainStep=0, alpha≈1 = L1 単独)。',
    oddsNote: '締切直前の最終オッズを使用。実際にはこの価格で買えないため ROI は楽観側にバイアスする。',
    verdict: verdict(strategies),
  };

  const json = JSON.stringify(out, null, 2);
  if (args.out) { fs.mkdirSync(path.dirname(args.out), { recursive: true }); fs.writeFileSync(args.out, json + '\n'); }
  printSummary(out);
  if (daysUsed === 0) { console.error('\n[backtest] no archive days found in ' + args.archive + ' for range'); process.exit(3); }
  return out;
}

function scoreTrifectaBets(rec, combos, actualCombo, triPay) {
  rec.races++;
  const stake = combos.length * 100;
  const hit = combos.indexOf(actualCombo) >= 0;
  const pay = hit ? (triPay[actualCombo] || 0) : 0;
  rec.bets += combos.length; rec.stake += stake; rec.payout += pay; if (hit) rec.hits++;
  if (stake > 0) rec.perRace.push({ stake, payout: pay });
}
function scoreWinBet(rec, boat, winner, winPay) {
  rec.races++;
  const stake = 100;
  const hit = boat === winner;
  const pay = hit ? (winPay[String(boat)] || 0) : 0;
  rec.bets += 1; rec.stake += stake; rec.payout += pay; if (hit) rec.hits++;
  rec.perRace.push({ stake, payout: pay });
}

function computeECE(calib) {
  if (!calib.length) return { logLoss: null, brier: null, ece: null, n: 0 };
  let ll = 0, br = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, acc: 0 }));
  calib.forEach((c) => {
    ll += c.logLoss; br += c.brier;
    const bi = Math.min(9, Math.floor(c.topProb * 10));
    bins[bi].n++; bins[bi].conf += c.topProb; bins[bi].acc += c.correct ? 1 : 0;
  });
  let ece = 0;
  bins.forEach((b) => { if (b.n) ece += (b.n / calib.length) * Math.abs(b.conf / b.n - b.acc / b.n); });
  return { logLoss: round4(ll / calib.length), brier: round4(br / calib.length), ece: round4(ece), n: calib.length };
}

function verdict(s) {
  // model_ev の ROI 95%CI 下限 > baseline_fav の ROI を満たさない限り edge を主張しない
  const ev = s.model_ev, fav = s.baseline_fav;
  if (!ev || !fav || ev.races === 0) return 'insufficient data';
  return ev.roiCI.lo > fav.roi
    ? `EDGE: model_ev roiCI.lo ${ev.roiCI.lo} > baseline_fav roi ${fav.roi}`
    : `NO EDGE: model_ev roiCI.lo ${ev.roiCI.lo} <= baseline_fav roi ${fav.roi} (控除率 ~25% の競技で当然の初期結果)`;
}

function printSummary(out) {
  console.log(`\n=== Offline backtest ${out.range.from}..${out.range.to} — ${out.daysUsed} days, ${out.racesScored} races ===`);
  console.log('strategy         races   roi     hitRate  roiCI');
  for (const k of Object.keys(out.strategies)) {
    const s = out.strategies[k];
    console.log(
      k.padEnd(16) + ' ' + String(s.races).padStart(5) + '   ' +
      String(s.roi).padStart(6) + '  ' + String(s.hitRate).padStart(6) + '   [' +
      s.roiCI.lo + ', ' + s.roiCI.hi + ']');
  }
  const c = out.modelCalibration;
  console.log(`model calibration: logLoss=${c.logLoss} brier=${c.brier} ece=${c.ece} (n=${c.n})`);
  console.log('leakageNote:', out.leakageNote);
  console.log('oddsNote:', out.oddsNote);
  console.log('verdict:', out.verdict);
}

// ESM: main を実行 (テストは import して個別関数を叩く)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
  // app.js を vm に読むと host の setInterval が生き残りプロセスが終了しないため明示 exit
  process.exit(0);
}

export { parseArgs, datesInRange, buildState, progIndex, foldResultsIntoDB, actualOrder, favoriteBoat, calibChunk, computeECE, bootstrapRoiCI, scoreTrifectaBets, scoreWinBet, verdict, loadDay, main };
