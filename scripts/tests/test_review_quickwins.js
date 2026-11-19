/**
 * 2026-11-20 多視点評価の「すぐ直せる」指摘の回帰テスト
 *
 *   - 学習を DB 更新より先に行う / DB 適用済みのレースは学習しない（当該レースの着順が特徴量に混ざるリーク）
 *   - EV モードの KPI プリセットがユーザーの点数（0 点含む）と EV 閾値を緩めない
 *   - Kelly「0（均等配分）」が既定 0.25 に化けない / 設定画面の既定表示が実際の既定と一致
 *   - 🔥穴の買い目は EV≥1.0 の主候補だけ（EV<1 の代わり候補を買い目・履歴に入れない）
 *   - BOX が全組数に満たないときは表示名でそれと分かる
 *   - 払戻の頭が「¥」（従来はバックスラッシュ）・組番を escape
 *   - escText が引用符も変換し、main と worker で同一
 *   - TOP に回収率（100% 未満は赤）と事後生成件数
 *   - navigator.language で英語に自動切替しない（日英が混ざっていた）
 *
 *   node scripts/tests/test_review_quickwins.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  const run = async () => {
    try { await fn(); console.log('  PASS:', name); pass++; }
    catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
  };
  pending.push(run);
}

const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'golden', 'race_konsen.json'), 'utf8'));
function predictWith(ctx, settings) {
  Object.assign(ctx, {
    programData: { [fx.sid]: { [fx.rno]: fx.program } },
    previewData: { [fx.sid]: { [fx.rno]: fx.preview } },
    oddsData: { odds: [fx.odds] }, racerDB: {}, stadiumDB: {}, l2trainStep: 0,
    settings: Object.assign({ betCount3: '10', betCount2: '5', betCountAna: '3', betMethod: 'auto', evMode: true, kpiMode: 'balanced' }, settings),
  });
  return ctx.predictRace(fx.sid, fx.rno);
}

// ---------------------------------------------------------------------------
console.log('[学習のリーク防止]');
t('_applyResultsRaw: 学習 → DB 更新の順', async () => {
  const ctx = makeCtx();
  const order = [];
  ctx.programData = {};
  ctx.indexResults = () => ({});
  ctx._mergeResultIndex = (a, b) => b;
  ctx._noteUpdatedAt = () => {};
  ctx._noteTodayDataFromRaw = () => {};
  ctx.learnFromResults = async () => { order.push('learn'); };
  ctx.updateDBFromResults = () => { order.push('db'); };
  ctx.updateHistoryWithResults = () => {};
  await ctx._applyResultsRaw({ results: [] });
  assert.deepStrictEqual(order, ['learn', 'db']);
});
t('loadDeferredData: DB 更新は learnFromResults の後（ソース上の順序）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
  const i = src.indexOf('await learnFromResults();              // PE-9');
  assert.ok(i > 0);
  const before = src.slice(src.lastIndexOf('// PE-8 + PE-9', i), i);
  assert.ok(!/updateDBFromResults\(/.test(before), '学習の前に DB 更新が残っている');
  assert.ok(/updateDBFromResults\(resultData, programData\)/.test(src.slice(i, i + 400)), '学習の後に DB 更新が無い');
});
t('learnFromResults (main): DB 適用済みのレースは学習しない', async () => {
  const ctx = makeCtx();
  const prog = { race_date: '2026-11-19', boats: fx.program.boats };
  ctx.programData = { 1: { 1: prog, 2: prog } };
  ctx.previewData = {};
  const fin = { isFinished: true, results: fx.program.boats.map((b, i) => ({ place: i + 1, racer_boat_number: b.racer_boat_number })) };
  ctx.resultData = { 1: { 1: fin, 2: fin } };
  ctx._getAppWorker = () => null;
  ctx._yieldToMain = async () => {};
  ctx.l2learnedKeys = {};
  ctx.globalThis._dbAppliedKeys = { '20261119_1_1': 1 };
  await ctx.learnFromResults();
  const keys = Object.keys(ctx.l2learnedKeys);
  assert.deepStrictEqual(keys, ['20261119_1_2'], 'learned: ' + keys.join(','));
});
t('learnFromResults (worker): DB 適用済みのキーを worker に渡し、worker も飛ばす', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'analysis', 'learning.js'), 'utf8');
  assert.ok(/dbAppliedKeys: globalThis\._dbAppliedKeys/.test(src), 'main が送っていない');
  const w = fs.readFileSync(path.join(ROOT, 'assets', 'worker_predictor.js'), 'utf8');
  assert.ok(/if\(dbApplied\[key\]\) continue;/.test(w), 'worker が飛ばしていない');
});

// ---------------------------------------------------------------------------
console.log('[EV モードの設定]');
t('EV モードでも 3連単 0 点なら買い目なし（従来は KPI プリセットで 1〜8 点に化けた）', () => {
  const b = predictWith(makeCtx(), { betCount3: '0' });
  assert.strictEqual(b.evApplied, true, 'EV モードが効いていない（fixture 前提）');
  assert.strictEqual(b.trifecta.length, 0, b.trifecta.length + ' 点');
});
t('EV モードの点数は KPI プリセットと設定の小さい方', () => {
  const b = predictWith(makeCtx(), { betCount3: '2' });
  assert.ok(b.trifecta.length <= 2, b.trifecta.length + ' 点');
});
t('EV 閾値はユーザー設定より緩めない（本命 fixture の 1-3-2 は EV 1.21）', () => {
  const hon = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'golden', 'race_honmei.json'), 'utf8'));
  const ctx = makeCtx();
  const run = (evMin) => {
    Object.assign(ctx, {
      programData: { [hon.sid]: { [hon.rno]: hon.program } }, previewData: { [hon.sid]: { [hon.rno]: hon.preview } },
      oddsData: { odds: [hon.odds] }, racerDB: {}, stadiumDB: {}, l2trainStep: 0,
      settings: { betCount3: '10', betCount2: '5', betMethod: 'auto', evMode: true, kpiMode: 'balanced', evMin },
    });
    return ctx.predictRace(hon.sid, hon.rno).trifecta.map((x) => x.combo);
  };
  assert.deepStrictEqual(run(undefined), ['1-3-2'], 'プリセット (本命 1.10) では出る');
  assert.deepStrictEqual(run('1.30'), [], 'EV 閾値 1.30 なのに EV 1.21 が出た');
});
t('Kelly 0（均等配分）は 0 のまま generateBetsV2 に渡る（従来は 0.25 に化けた）', () => {
  const ctx = makeCtx();
  let seen = null;
  const orig = ctx.generateBetsV2;
  ctx.generateBetsV2 = (m, method, c3, c2, odds, opt) => { seen = opt; return orig(m, method, c3, c2, odds, opt); };
  predictWith(ctx, { kellyFrac: '0' });
  assert.ok(seen, 'generateBetsV2 が呼ばれていない');
  assert.strictEqual(seen.kellyFrac, 0);
  predictWith(ctx, {});
  assert.strictEqual(seen.kellyFrac, 0.25, '未設定は既定 0.25');
});
t('設定画面の Kelly 既定表示は 0.25（実際の既定）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sel = /<select id="setKellyFrac"[\s\S]*?<\/select>/.exec(html)[0];
  assert.ok(/<option value="0.25" selected>/.test(sel));
  assert.ok(!/<option value="0.5" selected>/.test(sel));
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
  assert.ok(/settings\.kellyFrac != null \? settings\.kellyFrac : 0\.25\)/.test(src));
});

// ---------------------------------------------------------------------------
console.log('[穴・BOX]');
t('🔥穴の買い目は EV≥1.0 の主候補だけ', () => {
  const ctx = makeCtx();
  const b = predictWith(ctx, { evMode: false, betMethod: 'prob' });
  const tri = fx.odds.trifecta;
  const dist = ctx.buildTrifectaProbDist(b.marks);
  b.ana.forEach((c) => assert.ok(dist[c] * tri[c] >= 1.0 - 1e-9, c + ' EV ' + (dist[c] * tri[c]).toFixed(2)));
});
t('BOX の点数が全組数に満たなければ「上位N点」と表示', () => {
  const ctx = makeCtx();
  const marks = [1, 2, 3, 4, 5, 6].map((boat, i) => ({ boat, prob: [0.4, 0.2, 0.15, 0.1, 0.1, 0.05][i] }));
  assert.strictEqual(ctx.generateBetsV2(marks, 'box', 10, 5, null, {}).methodLabel, 'BOX(4艇)から上位10点');
  assert.strictEqual(ctx.generateBetsV2(marks, 'box', 6, 5, null, {}).methodLabel, 'BOX(3艇)');
});

// ---------------------------------------------------------------------------
console.log('[表示・escape]');
t('払戻の頭は ¥（バックスラッシュではない）、組番は escText を通す', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'reporting', 'race_detail.js'), 'utf8');
  assert.ok(src.includes('<span class="refund-val">¥\''), '¥ になっていない');
  assert.ok(!src.includes('refund-val">\\\\\''), 'バックスラッシュが残っている');
  assert.ok(/escText\(r\.combination\)/.test(src));
});
t('escText は引用符も変換し、main と worker で同じ結果', () => {
  const ctx = makeCtx();
  const wctx = { console, Math, Date, JSON, Object, Array, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite, Map, Set };
  wctx.self = wctx; wctx.globalThis = wctx;
  vm.createContext(wctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'worker_predictor.js'), 'utf8'), wctx);
  const cases = ['a&b', '<b>', '"q"', "it's", 'a b', null, undefined, 12, ''];
  cases.forEach((c) => assert.strictEqual(ctx.escText(c), wctx.escText(c), JSON.stringify(c)));
  assert.strictEqual(ctx.escText('" \' < & >'), '&quot; &#39; &lt; &amp; &gt;');
});
t('TOP: 回収率を表示し、100% 未満は赤、事後生成の件数を出す', () => {
  const ctx = makeCtx();
  const today = ctx.todayStr();
  ctx.localStorage.setItem('boatrace_history_migrated_v21', '1');
  ctx.localStorage.setItem('boatrace_history', JSON.stringify([
    { date: today, actual: [1, 2, 3], trifecta_hit: true, payout3: 800, trifecta_bets: ['1-2-3', '1-3-2', '2-1-3', '2-3-1', '3-1-2', '3-2-1', '1-2-4', '1-4-2', '2-1-4', '2-4-1'], backfilled: true },
    { date: today, actual: [4, 5, 6], trifecta_hit: false, trifecta_bets: ['1-2-3', '1-3-2', '2-1-3', '2-3-1', '3-1-2', '3-2-1', '1-2-4', '1-4-2', '2-1-4', '2-4-1'] },
  ]));
  const acc = ctx.getAccuracy();
  assert.strictEqual(acc.invest3, 2000);
  assert.strictEqual(acc.roi3, 40);
  assert.strictEqual(acc.backfilled, 1);
  const el = { innerHTML: '' };
  ctx.document.getElementById = (id) => (id === 'topSummary' ? el : { style: {} });
  ctx._renderTopSummary();
  assert.ok(el.innerHTML.includes('40.0%'), el.innerHTML);
  assert.ok(/color:var\(--danger\)">40\.0%/.test(el.innerHTML), '赤になっていない');
  assert.ok(el.innerHTML.includes('回収率'));
  assert.ok(el.innerHTML.includes('うち 1 件はレース確定後'));
});
t('i18n: navigator.language=en でも日本語のまま（?lang= / 保存済みでは切替）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'i18n.js'), 'utf8');
  const body = src.slice(src.indexOf('function _detectLocale'), src.indexOf('function setLocale'));
  assert.ok(!/navigator\.language/.test(body), '自動判定が残っている');
  assert.ok(/qs\.get\('lang'\)/.test(body) && /localStorage\.getItem\(I18N_KEY\)/.test(body));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/id="detailBack" data-i18n="race\.back_to_list"/.test(html), 'detailBack が翻訳対象でない');
});

(async () => {
  for (const run of pending) await run();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail);
})();
