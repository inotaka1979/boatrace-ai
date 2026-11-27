/**
 * オッズ鮮度と EV / 風向と穴判定 / 推奨買い目の過去成績（2026-11-20）
 *
 *   - _raceOddsAgeMin: このレースの live 取得 (_live_at) と bulk updated_at の新しい方で分を返す
 *   - EV モードは ODDS_STALE_EV_MIN (10) 分より古いオッズでは使わない（確率順に落とし、その旨を出す）
 *   - 詳細画面: オッズの取得からの経過、EV で選んだ買い目が最新オッズで EV<1 なら「妙味消失」
 *   - 穴判定: 追い風なら風速では穴にしない（score_boat は追い風をイン有利として加点しており矛盾していた）
 *
 *   node scripts/tests/test_odds_staleness_wind.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'golden', n + '.json'), 'utf8'));

function setup(ctx, fx, oddsData, settings, preview) {
  Object.assign(ctx, {
    programData: { [fx.sid]: { [fx.rno]: fx.program } },
    previewData: { [fx.sid]: { [fx.rno]: preview || fx.preview } },
    oddsData, racerDB: {}, stadiumDB: {}, l2trainStep: 0,
    settings: Object.assign({ betCount3: '10', betCount2: '5', betMethod: 'auto', evMode: true, kpiMode: 'off', evMin: '0.5' }, settings),
  });
}

console.log('[オッズの鮮度]');
t('_raceOddsAgeMin: live と bulk の新しい方、どちらも無ければ null', () => {
  const ctx = makeCtx();
  const now = Date.parse('2026-11-20T12:00:00Z');
  ctx.oddsData = { updated_at: '2026-11-20T11:30:00Z' };
  assert.strictEqual(ctx._raceOddsAgeMin({}, now), 30);
  assert.strictEqual(ctx._raceOddsAgeMin({ _live_at: now - 3 * 60000 }, now), 3, 'live が新しい');
  assert.strictEqual(ctx._raceOddsAgeMin({ _live_at: now - 90 * 60000 }, now), 30, 'bulk が新しい');
  ctx.oddsData = {};
  assert.strictEqual(ctx._raceOddsAgeMin({}, now), null);
});
t('EV モード: 新しいオッズなら EV、10 分超・時刻不明なら確率順に落として明示', () => {
  const fx = load('race_konsen');
  const ctx = makeCtx();
  setup(ctx, fx, { odds: [fx.odds], updated_at: new Date().toISOString() });
  let b = ctx.predictRace(fx.sid, fx.rno);
  assert.strictEqual(b.evApplied, true);
  assert.strictEqual(b.evSkippedStale, false);
  setup(ctx, fx, { odds: [fx.odds], updated_at: new Date(Date.now() - 25 * 60000).toISOString() });
  b = ctx.predictRace(fx.sid, fx.rno);
  assert.strictEqual(b.evApplied, false, '25 分前のオッズで EV を使った');
  assert.strictEqual(b.evSkippedStale, true);
  assert.strictEqual(b.oddsAgeMin, 25);
  setup(ctx, fx, { odds: [fx.odds] });
  b = ctx.predictRace(fx.sid, fx.rno);
  assert.strictEqual(b.evApplied, false, '時刻不明のオッズで EV を使った');
});
t('live 取得 (_live_at) が新しければ bulk が古くても EV を使う', () => {
  const fx = load('race_konsen');
  const ctx = makeCtx();
  const live = Object.assign({}, fx.odds, { _live_at: Date.now() - 60000 });
  setup(ctx, fx, { odds: [live], updated_at: new Date(Date.now() - 3 * 3600000).toISOString() });
  assert.strictEqual(ctx.predictRace(fx.sid, fx.rno).evApplied, true);
});
t('詳細画面: 取得からの経過と、古い時の警告・妙味消失の表示がある', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'reporting', 'race_detail_bets.js'), 'utf8');
  assert.ok(src.includes("' 分前に取得'"));
  assert.ok(src.includes('古いオッズの EV は過大に出ます'));
  assert.ok(src.includes('妙味消失'));
  assert.ok(src.includes('確率順で選んでいます'));
  assert.ok(/回収率 '\s*\+\s*'<b style="color:var\(--danger\)">75%<\/b>/.test(src), '推奨買い目に過去の回収率が無い');
});

console.log('[風と穴判定]');
function withWind(fx, ws, wd) {
  const pv = JSON.parse(JSON.stringify(fx.preview));
  pv.weather = Object.assign({}, pv.weather || {}, { wind_speed: ws, wind_direction: wd, wave_height: 1 });
  return pv;
}
t('追い風 6m なら風速では穴にしない、向かい風 6m なら穴（混戦レース。本命判定は風より先）', () => {
  const fx = load('race_konsen');
  const ctx = makeCtx();
  // 風向の番号は公式ページの矢印: 5 = 右向き = 追い風、13 = 左向き = 向かい風
  const tailDir = 5, headDir = 13;
  assert.ok(ctx.TAIL_WIND_DIRS.indexOf(tailDir) >= 0 && ctx.HEAD_WIND_DIRS.indexOf(headDir) >= 0);
  setup(ctx, fx, { odds: [] }, { evMode: false, betMethod: 'prob' }, withWind(fx, 6, tailDir));
  const tb = ctx.predictRace(fx.sid, fx.rno);
  assert.notStrictEqual(tb.raceType, 'ana', '追い風で穴になった');
  setup(ctx, fx, { odds: [] }, { evMode: false, betMethod: 'prob' }, withWind(fx, 6, headDir));
  const hb = ctx.predictRace(fx.sid, fx.rno);
  assert.strictEqual(hb.raceType, 'ana', '向かい風 6m で穴にならない (' + hb.raceType + ')');
  // 横風（上向きの矢印 = 1）は追い風ではないので、従来どおり穴
  setup(ctx, fx, { odds: [] }, { evMode: false, betMethod: 'prob' }, withWind(fx, 6, 1));
  assert.strictEqual(ctx.predictRace(fx.sid, fx.rno).raceType, 'ana', '横風 6m で穴にならない');
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);
