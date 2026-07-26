/**
 * PR-1: 黄金レース回帰テスト。
 *
 * 3 つの合成レース (本命 / 混戦 / 荒天) で predictRace を走らせ、出力を snapshot
 * 固定する。以後の全チューニングの副作用が diff で見えるようにする安全網。
 *
 *   node scripts/tests/test_golden_races.js                      # 検証
 *   UPDATE_SNAPSHOTS=1 node scripts/tests/test_golden_races.js   # 期待更新
 *
 * fixture は racerDB / stadiumDB を空にして自己完結させる（日次 DB 更新で
 * snapshot が壊れないように）。l2trainStep=0 なので融合比 α=1（L1 単独）。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
const FIX_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden');
const SNAP_DIR = path.join(ROOT, 'tests', 'snapshots');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });

const r6 = (n) => (typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n);

function runGolden(name) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, name + '.json'), 'utf8'));
  const ctx = makeCtx();
  ctx.programData = { [fx.sid]: { [fx.rno]: fx.program } };
  ctx.previewData = { [fx.sid]: { [fx.rno]: fx.preview } };
  ctx.oddsData = { odds: [fx.odds] };
  ctx.racerDB = {};
  ctx.stadiumDB = {};
  ctx.l2trainStep = 0;
  ctx.settings = {
    betCount3: 10, betCount2: 5, betCountAna: 3,
    betMethod: 'prob', evMode: false, kpiMode: 'balanced',
  };
  const bets = ctx.predictRace(fx.sid, fx.rno);
  return {
    raceType: bets.raceType,
    typeLabel: bets.typeLabel,
    method: bets.method,
    confidence: bets.confidence,
    confStars: bets.confStars,
    confLift: r6(bets.confLift),
    marks: bets.marks.map((m) => ({ boat: m.boat, mark: m.mark, course: m.course, prob: r6(m.prob) })),
    trifectaSum: r6(bets.trifecta.reduce((a, t) => a + t.prob, 0)),
    trifectaTop5: bets.trifecta.slice(0, 5).map((t) => ({ combo: t.combo, prob: r6(t.prob) })),
    exactaTop3: bets.exacta.slice(0, 3).map((t) => ({ combo: t.combo, prob: r6(t.prob) })),
    ana: bets.ana,
    scenarios: bets.scenarios
      ? Object.keys(bets.scenarios).reduce((o, k) => { o[k] = r6(bets.scenarios[k]); return o; }, {})
      : null,
  };
}

let pass = 0, fail = 0, updated = 0;
function snapshot(name, actual) {
  const file = path.join(SNAP_DIR, name + '.json');
  const serialized = JSON.stringify(actual, null, 2) + '\n';
  if (UPDATE || !fs.existsSync(file)) {
    fs.writeFileSync(file, serialized);
    console.log((UPDATE ? '  UPDATE: ' : '  CREATE: ') + name);
    updated++;
    return;
  }
  try {
    assert.strictEqual(serialized, fs.readFileSync(file, 'utf8'));
    console.log('  PASS:', name);
    pass++;
  } catch (_) {
    console.log('  FAIL:', name, '— snapshot mismatch (UPDATE_SNAPSHOTS=1 if intended)');
    fail++;
  }
}

const CASES = ['race_honmei', 'race_konsen', 'race_arare'];

// 決定性チェック: 2 回実行して一致すること
console.log('[determinism]');
CASES.forEach((n) => {
  const a = JSON.stringify(runGolden(n));
  const b = JSON.stringify(runGolden(n));
  if (a === b) { console.log('  PASS: deterministic ' + n); pass++; }
  else { console.log('  FAIL: non-deterministic ' + n); fail++; }
});

// S-02 の証跡: 3連単全体の Σ が 1.0 であること (旧実装なら 0.82〜3.33)
console.log('[S-02 evidence: trifecta Σ ≈ 1 across race shapes]');
CASES.forEach((n) => {
  const ctx = makeCtx();
  const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, n + '.json'), 'utf8'));
  ctx.programData = { [fx.sid]: { [fx.rno]: fx.program } };
  ctx.previewData = { [fx.sid]: { [fx.rno]: fx.preview } };
  ctx.oddsData = { odds: [fx.odds] };
  ctx.racerDB = {}; ctx.stadiumDB = {}; ctx.l2trainStep = 0;
  ctx.settings = { betCount3: 120, betCount2: 30, betCountAna: 3, betMethod: 'prob', evMode: false, kpiMode: 'balanced' };
  const bets = ctx.predictRace(fx.sid, fx.rno);
  const s = bets.trifecta.reduce((a, t) => a + t.prob, 0);
  if (Math.abs(s - 1) < 1e-6) { console.log('  PASS: ' + n + ' Σ=' + s.toFixed(6)); pass++; }
  else { console.log('  FAIL: ' + n + ' Σ=' + s); fail++; }
});

console.log('[golden snapshots]');
CASES.forEach((n) => snapshot('golden_' + n, runGolden(n)));

console.log(`\n=== Result: ${pass} passed, ${fail} failed, ${updated} updated ===`);
process.exit(fail);
