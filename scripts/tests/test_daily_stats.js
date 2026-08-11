/**
 * 2026-07-19: 日別成績ページ (calcDailyStats) の回帰テスト。
 *   boatrace_history の日別集計 (的中率 / 回収率 / 穴予想 / 直近 N 日トリム) を固定。
 *
 *   node scripts/tests/test_daily_stats.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'reporting', 'daily_stats_page.js'), 'utf8');

const ctx = {
  console,
  document: { getElementById: () => null },
  globalThis: null,
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const calcDailyStats = ctx.calcDailyStats;

let pass = 0, fail = 0;
function t(name, f) {
  try { f(); pass++; console.log(`  PASS: ${name}`); }
  catch (e) { fail++; console.log(`  FAIL: ${name} — ${e.message}`); }
}

const H = [
  // 7/17: 2R 判定済 (1 的中 payout3=5000)、1R 未確定 (actual なし → 除外)
  { date: '20260717', actual: [1, 2, 3], trifecta_hit: true, payout3: 5000, exacta_hit: false },
  { date: '20260717', actual: [2, 1, 3], trifecta_hit: false, exacta_hit: true, payout2: 800 },
  { date: '20260717', trifecta_hit: true, payout3: 99999 },   // actual なし → 集計外
  // 7/18: 1R、穴予想 3 点が的中
  { date: '20260718', actual: [4, 5, 6], trifecta_hit: false, exacta_hit: false,
    ana_bets: ['4-5-6', '4-6-5', '5-4-6'], ana_hit: true, ana_payout: 12000 },
];

console.log('[calcDailyStats]');
t('日付ごとに集計され actual 無しは除外', () => {
  const d = calcDailyStats(H, 10, 5, 30);
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d[0].date, '20260717');
  assert.strictEqual(d[0].total, 2);
  assert.strictEqual(d[1].total, 1);
});
t('的中率 (3連単/2連単)', () => {
  const d = calcDailyStats(H, 10, 5, 30);
  assert.strictEqual(d[0].hit3, 1);
  assert.strictEqual(d[0].rate3, 50);
  assert.strictEqual(d[0].hit2, 1);
  assert.strictEqual(d[0].rate2, 50);
});
t('投資と回収率 (betCount3=10, betCount2=5, ¥100)', () => {
  const d = calcDailyStats(H, 10, 5, 30);
  // 7/17: 2R × (10+5)×100 = 3000、回収 5000+800=5800 → 193.33%
  assert.strictEqual(d[0].invest, 3000);
  assert.strictEqual(d[0].payout, 5800);
  assert.ok(Math.abs(d[0].recovery - (5800 / 3000) * 100) < 0.01);
});
t('穴予想の投資/払戻が加算される', () => {
  const d = calcDailyStats(H, 10, 5, 30);
  // 7/18: 通常 1500 + 穴 3 点 300 = 1800、回収 12000
  assert.strictEqual(d[1].invest, 1800);
  assert.strictEqual(d[1].payout, 12000);
  assert.strictEqual(d[1].anaRaces, 1);
  assert.strictEqual(d[1].anaHits, 1);
});
t('maxDays で直近日数にトリムされる (日付昇順)', () => {
  const many = [];
  for (let i = 1; i <= 40; i++) {
    const dd = String(100 + i).slice(1);
    many.push({ date: '202606' + dd, actual: [1], trifecta_hit: false });
  }
  const d = calcDailyStats(many, 10, 5, 30);
  assert.strictEqual(d.length, 30);
  assert.strictEqual(d[0].date, '20260611');
  assert.strictEqual(d[29].date, '20260640');   // 合成日付だが昇順トリムの検証として有効
});
t('payout 未取得の的中は回収 0 で数えられる (silent 加算しない)', () => {
  const d = calcDailyStats([{ date: '20260719', actual: [1], trifecta_hit: true }], 10, 5, 30);
  assert.strictEqual(d[0].hit3, 1);
  assert.strictEqual(d[0].payout, 0);
});
// --- FA-8 (2026-08-11): 投資額は「実際に推奨した点数」で数える ----------------
// 旧実装は現在の設定 betCount3/2 を全過去レースに適用しており、的中判定
// (trifecta_hit は h.trifecta_bets との突合で決まる) と分母が食い違っていた。
// 設定の点数を変えるだけで過去の回収率が遡って変わる状態でもあった。
t('FA-8: 保存済 bets があれば設定点数ではなく実点数で投資額を数える', () => {
  const h = [{
    date: '20260801', actual: [1, 2, 3],
    trifecta_bets: ['1-2-3', '1-3-2', '2-1-3'],   // 実 3 点
    exacta_bets: ['1-2'],                          // 実 1 点
    trifecta_hit: true, payout3: 1000,
  }];
  const d = calcDailyStats(h, 10, 5, 30);
  assert.strictEqual(d[0].invest, 400, '設定点数 (10+5)×100=1500 で数えている');
});
t('FA-8: 設定点数を変えても保存済 bets のあるレースの投資額は変わらない', () => {
  const h = [{
    date: '20260801', actual: [1, 2, 3],
    trifecta_bets: ['1-2-3', '1-3-2'], exacta_bets: ['1-2'],
    trifecta_hit: false,
  }];
  assert.strictEqual(calcDailyStats(h, 10, 5, 30)[0].invest,
    calcDailyStats(h, 30, 20, 30)[0].invest, '設定変更で過去の投資額が遡って変わる');
});
t('FA-8: bets 未保存の旧エントリは設定点数にフォールバックする', () => {
  const h = [{ date: '20260801', actual: [1, 2, 3], trifecta_hit: false }];
  assert.strictEqual(calcDailyStats(h, 10, 5, 30)[0].invest, 1500);
});
t('FA-8: EV フィルタで 0 点になったレースは投資 0', () => {
  const h = [{
    date: '20260801', actual: [1, 2, 3],
    trifecta_bets: [], exacta_bets: [], trifecta_hit: false,
  }];
  assert.strictEqual(calcDailyStats(h, 10, 5, 30)[0].invest, 0,
    '買っていないレースに投資額を計上している');
});

t('空 history は空配列', () => {
  // vm 別レルムの Array と deepStrictEqual の prototype 比較を避け length で検証
  assert.strictEqual(calcDailyStats([], 10, 5, 30).length, 0);
  assert.strictEqual(calcDailyStats(null, 10, 5, 30).length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
