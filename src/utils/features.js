// P1-B1 (Epic 12): 特徴量パイプライン
//
// L2 ロジスティック回帰の 12 次元特徴量を「宣言的 spec の配列」として一箇所に集約。
// 旧: assets/app.js の getL2Features 内に inline で散在（拡張・テスト困難）
// 新: src/utils/features.js に FEATURE_PIPELINE として spec を列挙、build.mjs で bundle 注入
//
// 特徴量を追加する場合:
//   1) FEATURE_PIPELINE に {name, fn(ctx)} を append
//   2) FEATURE_VERSION を bump（既存 L2 重みは migration が必要になる）
//   3) FEATURE_DIM 定数も同期
//
// 設計原則:
//   - 各 fn は副作用なし、戻り値は数値（NaN は 0 として扱われる前提）
//   - ctx は買い目共通の事前計算済みヘルパ（pf / racerCWR 等）を保持
//   - 順序は L2 重み配列のインデックスと厳密に対応するため変更厳禁

'use strict';

const FEATURE_VERSION = 1; // spec を変更したら bump
const FEATURE_DIM_FEATURES = 12; // FEATURE_PIPELINE.length と一致

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

// ── 特徴量 spec（順序厳守）──────────────────────────────
const FEATURE_PIPELINE = Object.freeze([
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
]);

// ── 主エントリ: 旧 getL2Features と同一出力 ─────────────────
//   helpers 引数で global 依存（pf / getRacerCourseWinRate 等）を受け取り、
//   ピュア性を保ちつつテスト可能に。
function buildL2Features(boat, preview, weather, etRank, stRank, sid, helpers) {
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
  const tilt = pf(myPv.racer_tilt_adjustment);
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
globalThis.getL2Features = function (boat, preview, weather, etRank, stRank, sid) {
  return buildL2Features(boat, preview, weather, etRank, stRank, sid, {
    pf: typeof globalThis.pf === 'function' ? globalThis.pf : null,
    getRacerCourseWinRate: globalThis.getRacerCourseWinRate,
    getStadiumCourseWinRate: globalThis.getStadiumCourseWinRate,
    getRacerForm: globalThis.getRacerForm,
  });
};
