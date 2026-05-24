// P1-B1 (Epic 12): 特徴量パイプライン
//
// L2 ロジスティック回帰の特徴量を「宣言的 spec の配列」として一箇所に集約。
// 旧: assets/app.js の getL2Features 内に inline で散在（拡張・テスト困難）
// 新: src/utils/features.js に FEATURE_PIPELINE として spec を列挙、build.mjs で bundle 注入
//
// 2026-05-24 (v2): 12 → 24 次元に拡張 (Tier 1 改善)。
//   追加: 当地勝率 / 体重 / 年齢 / 調整重 / 生 tilt / 波×course / 潮汐×course /
//         pairwise H2H / class 分散 / motor 順位 / 直近 form / 当地2連率
//   既存 12 weights は MIGRATIONS[3] で 24 にゼロパディング、追加 12 weights=0 開始。
//
// 特徴量を追加する場合:
//   1) FEATURE_PIPELINE に {name, fn(ctx)} を append
//   2) FEATURE_VERSION を bump（既存 L2 重みは migration が必要になる）
//   3) FEATURE_DIM 定数も同期 (safe_storage.js, assets/app.js, assets/worker_predictor.js)
//
// 設計原則:
//   - 各 fn は副作用なし、戻り値は数値（NaN は 0 として扱われる前提）
//   - ctx は買い目共通の事前計算済みヘルパ（pf / racerCWR 等）を保持
//   - 順序は L2 重み配列のインデックスと厳密に対応するため変更厳禁

'use strict';

const FEATURE_VERSION = 2; // spec を変更したら bump
const FEATURE_DIM_FEATURES = 24; // FEATURE_PIPELINE.length と一致

// ── 内部ヘルパ（spec から呼ばれる）──────────────────────────
function _windCourse(ctx) {
  if (!ctx.weather) return 0;
  const ws = ctx.weather.wind_speed || ctx.weather.race_wind || 0;
  const wd = ctx.weather.wind_direction || ctx.weather.race_wind_direction_number || 0;
  const isHead = wd >= 7 && wd <= 11;
  if (isHead && ctx.course === 1) return -ws / 10;
  if (isHead && ctx.course >= 4) return ws / 20;
  return 0;
}

function _etComp(ctx) {
  if (ctx.etRank <= 1 && ctx.st > 0 && ctx.st <= 0.1) return 1;
  if (ctx.etRank >= 4 && ctx.st >= 0.15) return -1;
  return 0;
}

function _formScore(ctx) {
  // ctx.form は呼出側で getRacerForm から取得する（global 関数依存）
  return ctx.form ? ctx.form.score / 10 : 0;
}

function _tiltAlign(ctx) {
  const c = ctx.course,
    t = ctx.tilt;
  if (c <= 2 && t <= -0.5) return 1;
  if (c >= 4 && t >= 0.5) return 1;
  if ((c <= 2 && t >= 0.5) || (c >= 4 && t <= -0.5)) return -1;
  return 0;
}

// ── v2 追加: 波 × course (内 1 号艇は不利、外 4-6 号艇は相対的に有利)
function _waveCourse(ctx) {
  if (!ctx.weather) return 0;
  const wh = ctx.weather.wave_height || ctx.weather.race_wave || 0;
  if (ctx.course === 1) return -wh / 10;
  if (ctx.course >= 4) return wh / 20;
  return 0;
}

// ── v2 追加: 潮汐 × course (海水場のみ、phase により傾向あり)
//   TIDE_PHASE_COURSE_BIAS: high/low/rising/falling × 1..6
//   既存 TIDE_COURSE_BIAS と独立した重み学習を可能に
const TIDE_PHASE_COURSE_BIAS = Object.freeze({
  high:    [0, +0.1, +0.05, 0, -0.05, -0.1, -0.1],
  low:     [0, -0.1, -0.05, 0, +0.05, +0.1, +0.1],
  rising:  [0, +0.05, 0, 0, 0, -0.05, -0.05],
  falling: [0, -0.05, 0, 0, 0, +0.05, +0.05],
});
function _tidePhaseCourse(ctx) {
  const extras = ctx.extras;
  if (!extras) return 0;
  const helpers = ctx.helpers || {};
  const classify = helpers.classifyTidePhase || globalThis.classifyTidePhase;
  const tideData = helpers.tideData || globalThis.tideData;
  if (typeof classify !== 'function' || !tideData || !tideData.stadiums) return 0;
  const entry = tideData.stadiums[String(ctx.sid)];
  if (!entry || entry.type !== 'saltwater') return 0;
  const hour = extras.raceHour;
  if (hour == null) return 0;
  const phase = classify(entry, hour);
  if (!phase) return 0;
  const row = TIDE_PHASE_COURSE_BIAS[phase];
  return (row && row[ctx.course]) || 0;
}

// ── v2 追加: pairwise H2H (このレース内 5 艇との対戦成績)
function _pairwiseH2H(ctx) {
  const extras = ctx.extras;
  if (!extras || !Array.isArray(extras.allBoats)) return 0;
  const helpers = ctx.helpers || {};
  const pwScore = helpers.pairwiseScore || globalThis.pairwiseScore;
  if (typeof pwScore !== 'function') return 0;
  const oppRids = [];
  for (let i = 0; i < extras.allBoats.length; i++) {
    const ob = extras.allBoats[i];
    const orid = ob && ob.racer_number;
    if (orid && orid !== ctx.rid) oppRids.push(orid);
  }
  if (oppRids.length === 0) return 0;
  const r = pwScore(ctx.rid, ctx.sid, oppRids);
  // r.score は ±2 にクリップ済 → /2 で ±1 に
  return (r && Number.isFinite(r.score)) ? r.score / 2 : 0;
}

// ── v2 追加: class 分散 (混戦度、レース内で大きいほど波乱)
function _classFieldSpread(ctx) {
  const extras = ctx.extras;
  if (!extras || !Array.isArray(extras.allBoats) || extras.allBoats.length < 2) return 0;
  const classes = [];
  for (let i = 0; i < extras.allBoats.length; i++) {
    const cn = extras.allBoats[i] && extras.allBoats[i].racer_class_number;
    if (cn != null) classes.push(cn);
  }
  if (classes.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < classes.length; i++) sum += classes[i];
  const mean = sum / classes.length;
  let varSum = 0;
  for (let i = 0; i < classes.length; i++) varSum += (classes[i] - mean) ** 2;
  return Math.sqrt(varSum / classes.length) / 2; // ±1 程度に正規化
}

// ── v2 追加: motor 順位 (このボートのモーター top2 % がレース内何位か / 6)
function _motorFieldRank(ctx) {
  const extras = ctx.extras;
  if (!extras || !Array.isArray(extras.allBoats) || extras.allBoats.length < 2) return 0.5;
  const myMotor = ctx.pf(ctx.boat.racer_assigned_motor_top_2_percent);
  if (!Number.isFinite(myMotor) || myMotor === 0) return 0.5;
  let rank = 1;
  for (let i = 0; i < extras.allBoats.length; i++) {
    const om = ctx.pf(extras.allBoats[i].racer_assigned_motor_top_2_percent);
    if (Number.isFinite(om) && om > myMotor) rank++;
  }
  return rank / 6;
}

// ── v2 追加: 直近 10 走の 1 着率 (form.score より粒度高い情報)
function _recentWinRate(ctx) {
  const helpers = ctx.helpers || {};
  const racerDB = helpers.racerDB || globalThis.racerDB;
  if (!racerDB || !racerDB[ctx.rid]) return 0;
  const recent = racerDB[ctx.rid].recentResults;
  if (!Array.isArray(recent) || recent.length < 5) return 0;
  const slice = recent.slice(-10);
  let wins = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 1) wins++;
  }
  return wins / slice.length;
}

// ── 特徴量 spec（順序厳守）──────────────────────────────
const FEATURE_PIPELINE = Object.freeze([
  // v1 (index 0..11) — 既存重み互換のため順序維持
  { name: 'natWinPct', fn: (ctx) => ctx.pf(ctx.boat.racer_national_top_1_percent) / 10 },
  { name: 'motorRate', fn: (ctx) => ctx.pf(ctx.boat.racer_assigned_motor_top_2_percent) / 100 },
  { name: 'etRankNorm', fn: (ctx) => (ctx.etRank + 1) / 6 },
  { name: 'courseNorm', fn: (ctx) => ctx.course / 6 },
  { name: 'classNorm', fn: (ctx) => (ctx.boat.racer_class_number || 3) / 4 },
  { name: 'windCourse', fn: _windCourse },
  { name: 'racerCWR', fn: (ctx) => ctx.racerCWR || ctx.pf(ctx.boat.racer_national_top_1_percent) / 100 },
  { name: 'stRankNorm', fn: (ctx) => (ctx.stRank + 1) / 6 },
  { name: 'etComp', fn: _etComp },
  { name: 'formScore', fn: _formScore },
  { name: 'tiltAlign', fn: _tiltAlign },
  { name: 'stadCWR', fn: (ctx) => ctx.stadCWR },
  // v2 (index 12..23) — 当初 weights=0 から学習開始
  { name: 'localWinPct', fn: (ctx) => ctx.pf(ctx.boat.racer_local_top_1_percent) / 10 },
  { name: 'localTop2Pct', fn: (ctx) => ctx.pf(ctx.boat.racer_local_top_2_percent) / 100 },
  { name: 'weightZ', fn: (ctx) => {
    const w = ctx.pf(ctx.boat.racer_weight);
    if (!w) return 0;
    return Math.max(-3, Math.min(3, (w - 52) / 2));
  } },
  { name: 'ageNorm', fn: (ctx) => {
    const a = ctx.pf(ctx.boat.racer_age);
    if (!a) return 0.5;
    return Math.max(0, Math.min(1, a / 60));
  } },
  { name: 'weightAdjust', fn: (ctx) => {
    const myPv = ctx.myPv || {};
    return ctx.pf(myPv.racer_weight_adjustment) / 5;
  } },
  { name: 'tiltRaw', fn: (ctx) => ctx.tilt }, // ctx.tilt は既に pf 済
  { name: 'waveCourse', fn: _waveCourse },
  { name: 'tidePhaseCourse', fn: _tidePhaseCourse },
  { name: 'pairwiseH2H', fn: _pairwiseH2H },
  { name: 'classFieldSpread', fn: _classFieldSpread },
  { name: 'motorFieldRank', fn: _motorFieldRank },
  { name: 'recentWinRate', fn: _recentWinRate },
]);

// ── 主エントリ: 旧 getL2Features と同一出力 (+ v2 特徴量) ─────
//   helpers 引数で global 依存（pf / getRacerCourseWinRate 等）を受け取り、
//   ピュア性を保ちつつテスト可能に。
//   extras 引数: { allBoats, raceHour } を渡すと v2 特徴量 (pairwise / 場内 rank /
//   tide×course) が有効になる。欠落時は 0 fallback。
function buildL2Features(boat, preview, weather, etRank, stRank, sid, helpers, extras) {
  const h = helpers || {};
  const pf = h.pf || ((v) => parseFloat(v) || 0);
  const course =
    preview && preview.racer_course_number != null
      ? preview.racer_course_number
      : preview
        ? preview.racer_boat_number
        : boat.racer_boat_number;
  const rid = boat.racer_number || 0;
  const racerCWR = h.getRacerCourseWinRate ? h.getRacerCourseWinRate(rid, course) : null;
  const stadCWR = h.getStadiumCourseWinRate ? h.getStadiumCourseWinRate(String(sid), course) : 0;
  const myPv = preview || {};
  const st = myPv.racer_start_timing != null ? pf(myPv.racer_start_timing) : 99;
  // v1 は racer_tilt_adjustment、v2 fixture は racer_tilt → 両対応
  const tilt = myPv.racer_tilt_adjustment != null
    ? pf(myPv.racer_tilt_adjustment)
    : pf(myPv.racer_tilt);
  const form = h.getRacerForm ? h.getRacerForm(rid) : null;

  const ctx = {
    boat,
    preview,
    weather,
    etRank,
    stRank,
    sid,
    course,
    rid,
    racerCWR,
    stadCWR,
    myPv,
    st,
    tilt,
    form,
    pf,
    helpers: h,
    extras: extras || null,
  };
  const out = new Array(FEATURE_PIPELINE.length);
  for (let i = 0; i < FEATURE_PIPELINE.length; i++) {
    const v = FEATURE_PIPELINE[i].fn(ctx);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

// ── globalThis export（IIFE bundle 後にレガシ getL2Features を上書き）─
globalThis.FEATURE_VERSION = FEATURE_VERSION;
globalThis.FEATURE_DIM_FEATURES = FEATURE_DIM_FEATURES;
globalThis.FEATURE_PIPELINE = FEATURE_PIPELINE;
globalThis.buildL2Features = buildL2Features;

// 後方互換: 既存 getL2Features をパイプライン経由に切替
//   helpers 引数がない呼出（既存 app.js から）は global の関数を自動 lookup
//   extras 引数 (7th) は新規 — 呼出元が allBoats / raceHour を渡せば v2 特徴量が有効
globalThis.getL2Features = function (boat, preview, weather, etRank, stRank, sid, extras) {
  return buildL2Features(boat, preview, weather, etRank, stRank, sid, {
    pf: typeof globalThis.pf === 'function' ? globalThis.pf : null,
    getRacerCourseWinRate: globalThis.getRacerCourseWinRate,
    getStadiumCourseWinRate: globalThis.getStadiumCourseWinRate,
    getRacerForm: globalThis.getRacerForm,
    pairwiseScore: globalThis.pairwiseScore,
    classifyTidePhase: globalThis.classifyTidePhase,
    tideData: globalThis.tideData,
    racerDB: globalThis.racerDB,
  }, extras);
};
