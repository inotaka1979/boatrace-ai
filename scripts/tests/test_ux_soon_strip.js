/**
 * UX 改善（2026-11-20）: まもなく締切 / 直前予想を先頭に / ヘッダの接続表示
 *
 *   - _soonRaces: 締切まで 0〜120 分の未確定レースを締切順に最大 5 件（確定済み・締切後は除く）
 *   - _renderSoonStrip: 「あと N 分」・◎・タップでレース詳細 (data-action=openRace)、5 分以内は強調
 *   - 詳細「AI予想・買い目」: 展示が出たら直前予想 → 買い目 → 番組予想（折りたたみ）の順
 *   - ヘッダ: 取得失敗のバナーが出ている間は「接続OK」と出さない
 *   - 本文の 9 / 10px の文字を 11px に（表のマス目以外）
 *
 *   node scripts/tests/test_ux_soon_strip.js
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

const NOW = Date.parse('2026-11-19T14:00:00+09:00');
function progAt(hhmm) { return { race_closed_at: '2026-11-19 ' + hhmm + ':00', boats: [] }; }

console.log('[まもなく締切]');
t('_soonRaces: 120 分以内・未確定・締切順に最大 5 件', () => {
  const ctx = makeCtx();
  ctx.programData = {
    1: { 1: progAt('13:59'), 2: progAt('14:03'), 3: progAt('16:30') },
    2: { 5: progAt('14:10'), 6: progAt('14:20') },
    3: { 7: progAt('14:05'), 8: progAt('14:40'), 9: progAt('15:00') },
  };
  ctx.resultData = { 2: { 6: { isFinished: true } } };
  const r = ctx._soonRaces(NOW).map((x) => x.sid + '-' + x.rno + ':' + x.mins);
  assert.strictEqual(JSON.stringify(r), JSON.stringify(['1-2:3', '3-7:5', '2-5:10', '3-8:40', '3-9:60']));
});
t('_renderSoonStrip: あと N 分・◎・openRace・5 分以内は強調、該当なしなら空', () => {
  const ctx = makeCtx();
  const el = { innerHTML: 'x', style: {} };
  ctx.document.getElementById = (id) => (id === 'soonStrip' ? el : null);
  ctx.programData = { 4: { 8: progAt('14:03') }, 17: { 9: progAt('14:30') } };
  ctx.resultData = {};
  ctx.predictRace = (sid) => ({ marks: [{ boat: sid === 4 ? 1 : 3 }] });
  ctx._renderSoonStrip(NOW);
  assert.ok(el.innerHTML.includes('まもなく締切'));
  assert.ok(/平和島 8R<\/span><span class="soon-mins soon-urgent">あと 3 分/.test(el.innerHTML), el.innerHTML);
  assert.ok(/宮島 9R<\/span><span class="soon-mins">あと 30 分<\/span><span class="soon-mark">◎3/.test(el.innerHTML));
  assert.ok(el.innerHTML.includes('data-action="openRace" data-arg-sid="4" data-arg-rn="8"'));
  ctx.programData = {};
  ctx._renderSoonStrip(NOW);
  assert.strictEqual(el.innerHTML, '');
});
t('TOP 描画 (renderStadiums) から呼ばれ、index.html に置き場がある', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'reporting', 'stadium_pages.js'), 'utf8');
  assert.ok(/if \(typeof _renderSoonStrip === 'function'\) _renderSoonStrip\(\);/.test(src));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="soonStrip"') > html.indexOf('id="topSummary"'));
  assert.ok(html.indexOf('id="soonStrip"') < html.indexOf('id="stadiumList"'));
});

console.log('[詳細: 直前予想を先頭に]');
function renderDetail(withExhibition) {
  const ctx = makeCtx();
  const el = { innerHTML: '' };
  ctx.document.getElementById = (id) => (id === 'detailPrediction' ? el : { style: {}, innerHTML: '' });
  const marks = [1, 2, 3, 4, 5, 6].map((b, i) => ({ boat: b, prob: [0.5, 0.2, 0.1, 0.1, 0.05, 0.05][i], mark: '◎○▲△××'[i], reasons: [], risks: [] }));
  ctx.predictRaceProgram = () => ({ marks, raceType: 'honmei' });
  ctx._renderRaceDetailBets = () => '<div>BETS</div>';
  ctx._renderPairwiseSummary = () => '';
  const preview = { boats: {} };
  for (let b = 1; b <= 6; b++) preview.boats[String(b)] = { racer_exhibition_time: withExhibition ? 6.7 : 0 };
  ctx._renderRaceDetailPrediction({
    sid: 1, rn: 1, race: { boats: [1, 2, 3, 4, 5, 6].map((b) => ({ racer_boat_number: b, racer_name: '選手' + b })) },
    pred: { marks, raceType: 'honmei', trifecta: [] }, preview, result: null, popularity: null, raceOdds: null,
  });
  return el.innerHTML;
}
t('展示あり: 直前予想 → 買い目 → 番組予想（折りたたみ）', () => {
  const h = renderDetail(true);
  const live = h.indexOf('直前予想'), bets = h.indexOf('BETS'), prog = h.indexOf('番組予想');
  assert.ok(live >= 0 && bets > live && prog > bets, `live ${live} bets ${bets} prog ${prog}`);
  assert.ok(/<details class="prog-pred-fold"[\s\S]*番組予想/.test(h), '番組予想が折りたたまれていない');
});
t('展示なし: 従来どおり 番組予想 → 直前予想（反映待ち）→ 買い目', () => {
  const h = renderDetail(false);
  const prog = h.indexOf('番組予想'), live = h.indexOf('直前予想'), bets = h.indexOf('BETS');
  assert.ok(prog >= 0 && live > prog && bets > live, `prog ${prog} live ${live} bets ${bets}`);
  assert.ok(!h.includes('prog-pred-fold'));
});

console.log('[ヘッダの接続表示]');
t('取得失敗がある間は「接続OK」ではなく「一部取得失敗」', () => {
  const ctx = makeCtx();
  const el = { innerHTML: '', textContent: '' };
  ctx.document.getElementById = (id) => (id === 'dataFreshness' ? el : null);
  const now = Date.now();
  ctx._lastFetchOkAt = now - 1000;
  ctx._dataLatestUpdatedAt = now - 60000;
  ctx._apiHealth = { programs: 'ok', previews: 'ok' };
  ctx._workerHealthy = true;
  ctx._renderFreshness();
  assert.ok(el.innerHTML.includes('接続OK'), el.innerHTML);
  ctx._apiHealth = { programs: 'ok', previews: 'fail' };
  ctx._renderFreshness();
  assert.ok(el.innerHTML.includes('一部取得失敗') && !el.innerHTML.includes('接続OK'), el.innerHTML);
  ctx._apiHealth = {};
  ctx._workerHealthy = false;
  ctx._renderFreshness();
  assert.ok(el.innerHTML.includes('一部取得失敗'), 'Worker 停止中');
});

console.log('[文字サイズ]');
t('レポート描画の inline style に 9 / 10px が無い、.fs-9 / .fs-10 は 11px', () => {
  const dir = path.join(ROOT, 'src', 'reporting');
  fs.readdirSync(dir).forEach((f) => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/font-size:\s?(9|10)px/.test(s), f);
  });
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('.fs-9{font-size:11px}') && html.includes('.fs-10{font-size:11px}'));
});

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail);
