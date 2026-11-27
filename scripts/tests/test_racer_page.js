/**
 * 選手ページ（2026-11-25、lazy chunk app-rest-racer）
 *   src/reporting/racer_page.js（一覧: ★ お気に入り / 本日の出走 / 検索）
 *   src/reporting/racer_detail.js（選手詳細）
 *   src/discovery/racer_profiles_loader.js（プロフィールの取得）
 *
 *   - 検索: 漢字・ひらがな・カタカナ・半角カナ・登録番号、並び順、件数の上限
 *   - 選手 1 人分の情報の集め方（今日の出走表 > 名簿 > お気に入りに保存した名前）
 *   - 一覧: 既定のタブ、場の切替、並び順、行の中の ★
 *   - 詳細: プロフィール / 本日の出走 / 今節成績 / 成績 / コース別 / 直近の着順 / 当アプリの集計 / 公式リンク
 *   - プロフィールの取得: 起動時の取得を待つ・二重に取らない・失敗しても落ちない
 *   - 配線: 専用 chunk への振り分け、オフライン用キャッシュ、ページ切替
 *
 *   node scripts/tests/test_racer_page.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x));
let pass = 0,
  fail = 0;
const queue = [];
function t(name, fn) {
  queue.push({ name, fn });
}
function section(title) {
  queue.push({ title });
}

const NOW = Date.parse('2026-11-25T14:45:00+09:00');
function boat(n, id, name, cls, extra) {
  return Object.assign(
    {
      racer_boat_number: n,
      racer_number: id,
      racer_name: name,
      racer_class_number: cls || 1,
      racer_branch_name: '佐賀',
      racer_birthplace: '佐賀',
      racer_age: 41,
      racer_weight: 52,
      racer_flying_count: 0,
      racer_late_count: 0,
      racer_average_start_timing: 0.13,
      racer_national_top_1_percent: 9.1,
      racer_national_top_2_percent: 70,
      racer_national_top_3_percent: 85,
      racer_local_top_1_percent: 6.39,
      racer_local_top_2_percent: 33.33,
      racer_assigned_motor_number: 7,
      racer_assigned_motor_top_2_percent: 37.8,
    },
    extra || {}
  );
}
function race(hhmm, boats, title, grade) {
  return { race_closed_at: '2026-11-25 ' + hhmm + ':00', race_title: title || 'テスト杯', race_grade_number: grade || 5, boats };
}
function program() {
  return {
    8: {
      6: race('12:45', [boat(3, 3897, '白井 英治'), boat(6, 4320, '峰 竜太')], 'チャレンジカップ', 1),
      10: race('14:55', [boat(1, 4500, '山田 康二', 1, { racer_national_top_1_percent: 8.15 }), boat(4, 4320, '峰 竜太')], 'チャレンジカップ', 1),
    },
    11: { 9: race('14:42', [boat(3, 2538, '高橋 二朗', 3, { racer_national_top_1_percent: 3.2 }), boat(4, 5999, '新人 太郎', 4, { racer_national_top_1_percent: 0 })]) },
  };
}
function results() {
  return { 8: { 6: { isFinished: true, results: [{ racer_boat_number: 3, place: 2 }, { racer_boat_number: 6, place: 4 }] } } };
}
function course(entries, places, top2, st, rank) {
  return { entries, places, wins: places[0], top2Rate: top2, avgST: st, avgSTRank: rank };
}
function profiles() {
  return {
    4320: {
      name: '峰　　　　竜　太',
      kana: 'ﾐﾈ ﾘｭｳﾀ',
      branch: '佐賀',
      classNum: 1,
      age: 41,
      weight: 52,
      winRate: 8.85,
      top2Rate: 63.3,
      avgST: 0.12,
      totalRaces: 109,
      courseStats: {
        1: course(29, [27, 1, 0, 1, 0, 0], 96.5, 0.12, 2.6),
        2: course(22, [7, 9, 3, 3, 0, 0], 72.7, 0.13, 2.9),
        3: course(0, [0, 0, 0, 0, 0, 0], 0, 0, 0),
        4: course(16, [6, 4, 3, 1, 2, 0], 62.5, 0.12, 1.9),
        5: course(10, [3, 1, 2, 2, 1, 1], 40.0, 0.09, 2.0),
        6: course(12, [0, 1, 7, 2, 0, 2], 8.3, 0.11, 2.8),
      },
      recentResults: [6, 6, 5, 1, 6, 2, 2, 1, 3, 1, 2, 1, 2, 1, 2, 2, 1, 3, 2, 2, 1, 1, 4],
    },
    4635: { name: '峰　重　　力　也', kana: 'ﾐﾈｼｹﾞ ﾘｷﾔ', branch: '岡山', classNum: 3, age: 40, weight: 53, winRate: 5.34, top2Rate: 30, avgST: 0.17, totalRaces: 90, courseStats: {}, recentResults: [] },
    4237: { name: '大　峯　　　　豊', kana: 'ｵｵﾐﾈ ﾕﾀｶ', branch: '山口', classNum: 1, age: 41, weight: 52, winRate: 7.57, top2Rate: 50, avgST: 0.14, totalRaces: 100, courseStats: {}, recentResults: [] },
    2538: { name: '高　橋　　二　朗', kana: 'ﾀｶﾊｼ ｼﾞﾛｳ', branch: '東京', classNum: 3, age: 77, weight: 54, winRate: 3.15, top2Rate: 5.6, avgST: 0.2, totalRaces: 106, courseStats: {}, recentResults: [4, 5, 6] },
    4444: { name: '高　田　　一　郎', kana: 'ﾀｶﾀﾞ ｲﾁﾛｳ', branch: '福岡', classNum: 1, age: 38, weight: 52, winRate: 7.0, top2Rate: 50, avgST: 0.14, totalRaces: 100, courseStats: {}, recentResults: [] },
    3941: { name: '池　田　　浩　二', kana: 'ｲｹﾀﾞ ｺｳｼﾞ', branch: '愛知', classNum: 1, age: 47, weight: 52, winRate: 8.2, top2Rate: 60, avgST: 0.13, totalRaces: 95, courseStats: {}, recentResults: [] },
  };
}
function fakeEl(id) {
  const cls = new Set();
  const listeners = {};
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    classList: { add: (c) => cls.add(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    addEventListener: (type, fn) => (listeners[type] = fn),
    fire: (type, ev) => listeners[type] && listeners[type](ev),
    focus: () => {},
    getAttribute: () => null,
    setAttribute: () => {},
  };
}
// 選手ページを開いた状態の ctx（番組表・結果・名簿あり）
function pageCtx(favs, opt) {
  const ctx = makeCtx();
  ctx.programData = program();
  ctx.resultData = results();
  ctx.predictRace = () => null;
  if (!(opt && opt.noProfiles)) {
    ctx._racerProfiles = profiles();
    ctx._racerProfilesAt = '2026-11-25T04:42:50Z';
  }
  ctx._racerStatsView = { racers: {}, window: { racer_months: 12 } };
  // 第 2 段階の追加項目・公式の選手ページは、使うテストが個別に入れる（既定は「取得済みで空」/「取得のしくみ無し」）
  ctx._racerExt = { racers: {}, term: null };
  ctx._loadRacerOfficial = () => false;
  ctx._racerOfficialOf = () => null;
  ctx._loadRacerOfficialMany = () => 0;
  // 第 3 段階の出走ログも同じ（既定は「取得のしくみ無し」= 従来の「直近の着順」を出す。test_racer_log.js が個別に確かめる）
  ctx._loadRacerLog = () => false;
  ctx._racerLogOf = () => null;
  if (favs) ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify(favs));
  const els = {};
  ctx.document.getElementById = (id) => els[id] || (els[id] = fakeEl(id));
  ctx.window.scrollTo = () => {};
  ctx.document.getElementById('pageRacer').classList.add('active');
  ctx.currentStadium = null;
  ctx.currentRace = null;
  return { ctx, els, html: () => els.racerView.innerHTML };
}

section('[検索]');
t('_racerSearchKey: ひらがな → カタカナ、半角カナ → 全角、空白を除く', () => {
  const ctx = makeCtx();
  assert.strictEqual(ctx._racerSearchKey('みね りゅうた'), 'ミネリュウタ');
  assert.strictEqual(ctx._racerSearchKey('ﾐﾈ ﾘｭｳﾀ'), 'ミネリュウタ');
  assert.strictEqual(ctx._racerSearchKey('ｲｹﾀﾞ ｺｳｼﾞ'), 'イケダコウジ'); // 濁点の合成
  assert.strictEqual(ctx._racerSearchKey('峰　竜太'), '峰竜太');
  assert.strictEqual(ctx._racerSearchKey('４３２０'), '4320'); // 全角数字
  assert.strictEqual(ctx._racerSearchKey(null), '');
});
t('名前（漢字）/ かな（ひらがな・カタカナ・半角）/ 登録番号で引ける', () => {
  const { ctx } = pageCtx();
  assert.deepStrictEqual(J(ctx._racerSearch('峰').ids), ['4320', '4635']); // 「大峯」は別の字（峯）なので漢字では当たらない
  assert.deepStrictEqual(J(ctx._racerSearch('みね').ids), ['4320', '4635', '4237']);
  assert.deepStrictEqual(J(ctx._racerSearch('ミネ').ids), ['4320', '4635', '4237']);
  assert.deepStrictEqual(J(ctx._racerSearch('ﾐﾈｼｹﾞ').ids), ['4635']);
  assert.deepStrictEqual(J(ctx._racerSearch('いけだ こうじ').ids), ['3941']);
  assert.deepStrictEqual(J(ctx._racerSearch('4320').ids), ['4320']);
  assert.strictEqual(ctx._racerSearch('').total, 0);
  assert.strictEqual(ctx._racerSearch('   ').total, 0);
  assert.strictEqual(ctx._racerSearch('ぜったいにいない').total, 0);
});
t('並び: 前方一致 → 部分一致、その中で 本日出走 → 級 → 勝率。登録番号は完全一致が先頭', () => {
  const { ctx } = pageCtx();
  // 「みね」: 峰 竜太（前方・本日出走）→ 峰重（前方）→ 大峯（部分一致。A1 でも前方一致の B1 より後）
  assert.deepStrictEqual(J(ctx._racerSearch('みね').ids), ['4320', '4635', '4237']);
  // 「たか」: 前方一致どうしでは、本日出走の 高橋（B1）が、出走の無い 高田（A1）より先。部分一致の 大峯 豊（ユタカ）は最後
  assert.deepStrictEqual(J(ctx._racerSearch('たか').ids), ['2538', '4444', '4237']);
  // 登録番号: 「43」は 4320（前方）。「4」は前方一致が複数 → 本日出走が先
  const r4 = J(ctx._racerSearch('4').ids);
  assert.strictEqual(r4[0], '4320');
  assert.ok(r4.indexOf('4500') >= 0, '名簿に無くても今日の出走表に居る選手は引ける');
  assert.deepStrictEqual(J(ctx._racerSearch('しんじん').ids), [], 'かなは名簿に無い選手では引けない（漢字では引ける）');
  assert.deepStrictEqual(J(ctx._racerSearch('新人').ids), ['5999']);
});
t('上限 50 人。全件数は total に残す', () => {
  const { ctx } = pageCtx();
  const P = {};
  for (let i = 0; i < 80; i++) P[3000 + i] = { name: '山　田　　太　郎', kana: 'ﾔﾏﾀﾞ ﾀﾛｳ', classNum: 3, winRate: i / 10 };
  ctx._racerProfiles = P;
  const r = ctx._racerSearch('やまだ');
  assert.strictEqual(r.total, 80);
  assert.strictEqual(r.ids.length, 50);
  assert.strictEqual(r.ids[0], '3079', '同じ級なら勝率の高い順');
  assert.strictEqual(r.ids[49], '3030');
});

section('[選手 1 人分の情報]');
t('今日の出走表 > 名簿 > お気に入りに保存した名前', () => {
  const { ctx } = pageCtx([{ id: '9999', name: '保存 名前', ts: 1 }]);
  const a = ctx._racerInfo('4320');
  assert.strictEqual(a.name, '峰 竜太');
  assert.strictEqual(a.kana, 'ミネ リュウタ');
  assert.strictEqual(a.winRate, 9.1, '出走表の全国勝率');
  assert.strictEqual(a.today.length, 2);
  assert.strictEqual(a.birthplace, '佐賀');
  const b = ctx._racerInfo('4635'); // 出走なし → 名簿
  assert.deepStrictEqual([b.name, b.kana, b.cls, b.branch, b.winRate, b.today.length], ['峰重 力也', 'ミネシゲ リキヤ', 3, '岡山', 5.34, 0]);
  const c = ctx._racerInfo('9999'); // 名簿にも出走表にも無い
  assert.deepStrictEqual([c.name, c.kana, c.cls, !!c.p, !!c.prog], ['保存 名前', '', 0, false, false]);
  assert.strictEqual(ctx._racerInfo('8888').name, '登録 8888');
});
t('_racerTodayLine: 確定は着順、締切前は太字で時刻', () => {
  const { ctx } = pageCtx();
  const info = ctx._racerInfo('4320');
  assert.strictEqual(ctx._racerTodayLine(info.today, NOW), '本日 常滑 6R（4着）・<b>10R 14:55</b>');
  assert.strictEqual(ctx._racerTodayLine(info.today, NOW, true), '6R（4着）・<b>10R 14:55</b>');
  assert.strictEqual(ctx._racerTodayLine(ctx._racerInfo('2538').today, NOW), '本日 びわこ 9R（結果待ち）');
  assert.strictEqual(ctx._racerTodayLine([], NOW), '');
});

section('[一覧]');
t('既定のタブ: お気に入りがあれば ★、無ければ本日の出走', () => {
  const a = pageCtx([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  a.ctx._renderRacerPage(null, NOW);
  assert.ok(/class="racer-tab active"[^>]*data-arg-tab="fav">★ お気に入り <span id="racerFavCount">\(1\)<\/span>/.test(a.html()), a.html().slice(0, 400));
  const b = pageCtx();
  b.ctx._renderRacerPage(null, NOW);
  assert.ok(/class="racer-tab active"[^>]*data-arg-tab="today"/.test(b.html()));
  assert.ok(b.html().includes('racer-sids'));
});
t('★ お気に入り: 本日出走（次の締切が近い順）→ 出走なし（登録の新しい順）。行から選手詳細へ', () => {
  const { ctx, html } = pageCtx([
    { id: '4635', name: '峰重 力也', ts: 9 },
    { id: '2538', name: '高橋 二朗', ts: 8 },
    { id: '4320', name: '峰 竜太', ts: 1 },
    { id: '3941', name: '池田 浩二', ts: 5 },
  ]);
  ctx._renderRacerPage(null, NOW);
  const ids = [...html().matchAll(/class="racer-li"[^>]*data-arg-id="(\d+)" data-arg-from="racer"/g)].map((m) => m[1]);
  // 4320: 締切前あり / 2538: 出走あり・締切前なし / 4635, 3941: 出走なし（ts 9 → 5）
  assert.deepStrictEqual(ids, ['4320', '2538', '4635', '3941']);
  assert.ok(html().includes('本日 常滑 6R（4着）・<b>10R 14:55</b>'));
  assert.ok(html().includes('本日の出走なし'));
  assert.ok(html().includes('ミネ リュウタ・佐賀・登録 4320'));
  assert.ok(/data-action="toggleFavRacer" data-arg-id="4320"[^>]*aria-pressed="true"[^>]*>★<\/button>/.test(html()));
  assert.ok(html().includes('src="data/photos/4320.jpg" loading="lazy"'));
});
t('★ が 0 人のときは登録のしかたを案内する', () => {
  const { ctx, html } = pageCtx();
  ctx._racerUi.tab = 'fav';
  ctx._renderRacerPage(null, NOW);
  assert.ok(html().includes('お気に入り選手はまだ登録されていません'));
  assert.ok(html().includes('TOP の場一覧の下'));
});
t('本日の出走: 場で絞る（級 → 全国勝率の順）。場の切替', () => {
  const { ctx, html } = pageCtx();
  ctx.currentStadium = '11';
  ctx._renderRacerPage(null, NOW);
  assert.ok(/class="racer-sid active"[^>]*data-arg-sid="11">びわこ</.test(html()), '直前に見ていた場が既定');
  assert.ok(html().includes('2 人（級 → 全国勝率の順）'));
  ctx.ACTION_HANDLERS.racerSid({ dataset: { argSid: '8' } });
  const names = [...html().matchAll(/class="racer-li-name">([^<]+) /g)].map((m) => m[1]);
  // 3 人とも A1。勝率 9.10（白井・峰: 同値は登録番号の若い順）→ 8.15（山田）
  assert.deepStrictEqual(names, ['白井 英治', '峰 竜太', '山田 康二']);
});
t('検索タブ: 入力で結果だけ描き直す（入力欄は作り直さない）。名簿が無ければ取りに行く', () => {
  const { ctx, els, html } = pageCtx(null, { noProfiles: true });
  let loads = 0;
  ctx._loadRacerProfiles = () => loads++;
  ctx.ACTION_HANDLERS.racerTab({ dataset: { argTab: 'search' } });
  assert.ok(html().includes('id="racerSearchInput"') && html().includes('名前（漢字・ひらがな・カタカナ）か登録番号で探せます'));
  const before = html();
  els.racerView.fire('input', { target: { id: 'racerSearchInput', value: '峰' } });
  assert.strictEqual(html(), before, '入れ物全体は描き直さない（入力中のフォーカスを保つ）');
  assert.ok(els.racerSearchResult.innerHTML.includes('峰 竜太'));
  assert.ok(els.racerSearchResult.innerHTML.includes('1 人'));
  assert.ok(loads >= 1);
  els.racerView.fire('input', { target: { id: 'racerSearchInput', value: 'zzz' } });
  assert.ok(els.racerSearchResult.innerHTML.includes('当てはまる選手が見つかりません'));
  assert.ok(els.racerSearchResult.innerHTML.includes('名簿を読み込み中'));
  // 検索語は覚えている（詳細から戻ったとき用）
  ctx._renderRacerPage(null, NOW);
  assert.ok(html().includes('value="zzz"'));
});
t('検索語は escape する', () => {
  const { ctx, els } = pageCtx();
  ctx.ACTION_HANDLERS.racerTab({ dataset: { argTab: 'search' } });
  els.racerView.fire('input', { target: { id: 'racerSearchInput', value: '"><img src=x>' } });
  assert.ok(!els.racerSearchResult.innerHTML.includes('<img src=x>'));
  ctx._renderRacerPage(null, NOW);
  assert.ok(!els.racerView.innerHTML.includes('<img src=x>'));
});
t('お気に入りの件数は登録の変更で直す（行は消さない）', () => {
  const { ctx, els } = pageCtx([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  ctx._renderRacerPage(null, NOW);
  const before = els.racerView.innerHTML;
  ctx._toggleFavRacer('4320', '峰 竜太');
  assert.strictEqual(els.racerFavCount.textContent, '(0)');
  assert.strictEqual(els.racerView.innerHTML, before);
});

section('[選手詳細]');
t('プロフィール・本日の出走・成績・コース別・直近の着順・公式リンク', () => {
  const { ctx, html } = pageCtx([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  ctx.predictRace = (sid, rno) => (rno === 10 ? { marks: [{ boat: 4, mark: '○', prob: 0.21 }] } : null);
  ctx.currentStadium = '8';
  ctx.currentRace = '10';
  ctx._renderRacerPage({ id: '4320', from: 'detail' }, NOW);
  const h = html();
  assert.ok(h.includes('data-action="racerBack">← 常滑 10R に戻る</button>'), h.slice(0, 200));
  // プロフィール
  assert.ok(h.includes('<div class="pf-name">峰 竜太</div><div class="pf-kana">ミネ リュウタ</div>'));
  assert.ok(h.includes('data-fav-style="full" aria-pressed="true"') && h.includes('>★ 登録済み</button>'));
  assert.ok(h.includes('<span class="cls-chip cls-1">A1</span><span class="chip">登録 4320</span><span class="chip">佐賀支部</span>'));
  assert.ok(h.includes('41歳 / 52kg / 佐賀出身<br>F0 / L0（今期）'));
  // 本日の出走（レース詳細へ）
  assert.ok(h.includes('本日の出走 <span class="sec-src">常滑 SG チャレンジカップ'));
  assert.ok(h.includes('data-action="openRace" data-arg-sid="8" data-arg-rn="6"') && /6号艇<\/span><span class="fav-st">4着</.test(h));
  assert.ok(/4号艇 <span class="fav-note">AI ○ 21%<\/span><\/span><span class="fav-st">あと 10 分</.test(h));
  // 成績（出走表）とファン手帳
  assert.ok(h.includes('<div><b>9.10</b><span>全国勝率</span></div>') && h.includes('<div><b>70.0%</b><span>2連対率</span></div>'));
  assert.ok(h.includes('<div><b>7</b><span>モーター</span></div>') && h.includes('<div><b>37.8%</b><span>モーター2連</span></div>'));
  assert.ok(h.includes('期別成績（ファン手帳）: 勝率 8.85 ／ 2連対率 63.3% ／ 平均ST 0.12 ／ 109 走'));
  // コース別: 1 着率 = 1 着 / 出走、3 連対 = 1〜3 着の合計 / 出走。出走 0 のコースは -
  assert.ok(h.includes('期別成績（ファン手帳）89 走'));
  assert.ok(/<td>29<\/td><td><b>93%<\/b><div class="bar"><i style="width:93%"><\/i><\/div><\/td><td>96\.5%<\/td><td>97%<\/td><td>0\.12<\/td><td>2\.6<\/td>/.test(h));
  assert.ok(/<td>0<\/td><td>-<\/td><td>-<\/td><td>-<\/td><td>-<\/td><td>-<\/td>/.test(h));
  // 直近の着順: 新しい順に 20 走まで（保存は古い順）
  const chips = [...h.split('pl-wrap')[1].matchAll(/<span class="pl[^"]*">([^<]+)<\/span>/g)].map((m) => m[1]).join('');
  assert.strictEqual(chips, '41122312212121312261'.split('').join(''), chips);
  assert.ok(h.includes('直近 20 走の着順'));
  assert.ok(h.includes('<span class="pl pl-1">1</span>') && h.includes('<span class="pl">4</span>'));
  // 公式リンクと出典
  assert.ok(h.includes('href="https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=4320" target="_blank" rel="noopener noreferrer"'));
  assert.ok(h.includes('出典: 本日の出走表 / ファン手帳の期別成績（2026-11-25 取得）</div>'), '出した情報の出どころだけ（集計は出していない）');
});
t('出走の無い選手: ファン手帳の成績を出す。フライングは赤', () => {
  const { ctx, html } = pageCtx();
  ctx._renderRacerPage({ id: '4635', from: 'racer' }, NOW);
  let h = html();
  assert.ok(h.includes('← 選手一覧に戻る'));
  assert.ok(h.includes('本日の出走はありません'));
  assert.ok(h.includes('成績 <span class="sec-src">期別成績（ファン手帳）</span>') && h.includes('<div><b>5.34</b><span>勝率</span></div>'));
  assert.ok(!h.includes('コース別成績'), 'コース別の出走が無ければ表を出さない');
  assert.ok(!h.includes('着順</div>') && !h.includes('pl-wrap'));
  assert.ok(h.includes('>☆ お気に入りに登録</button>'));
  ctx.programData[8][6].boats[1].racer_flying_count = 1; // その日の最初の出走の出走表を使う
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  h = html();
  assert.ok(h.includes('← TOP に戻る') && h.includes('<span class="c-danger fw-700">F1</span> / L0（今期）'));
});
t('名簿にも出走表にも無い選手: その旨を出して落ちない', () => {
  const { ctx, html } = pageCtx([{ id: '9999', name: '<b>引退</b> 選手', ts: 1 }]);
  ctx._renderRacerPage({ id: '9999', from: 'racer' }, NOW);
  const h = html();
  assert.ok(h.includes('この選手の成績はまだ手元にありません'));
  assert.ok(h.includes('&lt;b&gt;引退&lt;/b&gt; 選手') && !h.includes('<b>引退</b>'));
  assert.ok(!h.includes('出典:'), '出した成績が無ければ出典も出さない');
  assert.ok(h.includes('profile?toban=9999'));
});
t('今節成績: 着順・進入・ST を日ごとに並べる（_seriesSlotsFor と同じ枠）', () => {
  const { ctx, html } = pageCtx();
  const calls = [];
  ctx._seriesSlotsFor = (sid, rd, bn, rid) => {
    calls.push([sid, bn, rid]);
    return [{ waku: 1, course: 1, place: 1, st: '.06' }, null, { waku: 6, course: 6, place: 4, st: '.14' }, null, null];
  };
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  const h = html();
  assert.deepStrictEqual(calls, [['8', 6, 4320]], '場・艇番（その日の最初の出走）・選手番号（数値）で引く');
  assert.ok(h.includes('<th colspan="2">初日</th><th colspan="2">2日目</th></tr>'));
  assert.strictEqual(h.split('<table class="racer-series">')[1].split('</table>')[0].split('<td class="series-mc').length - 1, 4);
  ctx._seriesSlotsFor = () => [];
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  assert.ok(!html().includes('今節成績'));
});
t('当アプリの集計: 3 走以上で出す。勝ち決まり手と本番 ST。未取得なら取りに行く', () => {
  const { ctx, html } = pageCtx();
  ctx._racerStatsView = {
    window: { racer_months: 12 },
    racers: { 4320: { c: { 1: [4, 3, 4, 4], 4: [2, 1, 1, 2] }, kw: { 1: { 1: 3 }, 4: { 3: 1 } }, st: [0.11, 6, 1, 0], sz: [-0.02, 0, 6] } },
  };
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  let h = html();
  assert.ok(h.includes('当アプリの集計 <span class="sec-src">直近 12 か月・6 走</span>'));
  assert.ok(/<td>4<\/td><td>3<\/td><td>4<\/td><td>4<\/td><td class="ta-l">逃げ 3<\/td>/.test(h), h.split('当アプリの集計')[1].slice(0, 500));
  assert.ok(h.includes('本番の平均ST 0.11（6 走） ／ <span class="c-danger">F 1 回</span> ／ 展示との差 -0.02'));
  assert.ok(h.includes('/ 当アプリの集計</div>'), '集計を出したときだけ出典に載せる');
  ctx._racerStatsView.racers[4320] = { c: { 1: [2, 2, 2, 2] }, kw: {}, st: [0.1, 2, 0, 0] };
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  assert.ok(!html().includes('当アプリの集計 <span'), '2 走では出さない');
  ctx._racerStatsView = undefined;
  let asked = 0;
  ctx._loadRacerStatsView = () => asked++;
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  assert.strictEqual(asked, 1);
});
t('戻る: 一覧から開いたら一覧（タブ・検索語のまま）、他のページからはそのページ', () => {
  const { ctx, html } = pageCtx();
  const shown = [];
  ctx.showPage = (p) => shown.push(p);
  ctx.ACTION_HANDLERS.racerTab({ dataset: { argTab: 'search' } });
  ctx._racerUi.q = 'みね';
  ctx._renderRacerPage({ id: '4320', from: 'racer' }, NOW);
  assert.ok(html().includes('pf-name'));
  ctx.ACTION_HANDLERS.racerBack();
  assert.ok(html().includes('id="racerSearchInput"') && html().includes('value="みね"'));
  assert.deepStrictEqual(shown, []);
  ctx._renderRacerPage({ id: '4320', from: 'detail' }, NOW);
  ctx.ACTION_HANDLERS.racerBack();
  assert.deepStrictEqual(shown, ['detail']);
  // 下メニューから開き直すと一覧
  ctx._renderRacerPage(null, NOW);
  assert.ok(html().includes('racer-tabs'));
});
t('描き直し (_racerRerender): 表示中の画面のまま。選手ページを開いていなければ何もしない', () => {
  const { ctx, els, html } = pageCtx();
  ctx._renderRacerPage({ id: '4635', from: 'racer' }, NOW);
  ctx._racerProfiles[4635].winRate = 6.66;
  ctx._racerRerender();
  assert.ok(html().includes('<b>6.66</b>'));
  els.pageRacer.classList.toggle('active', false);
  els.racerView.innerHTML = 'KEEP';
  ctx._racerRerender();
  assert.strictEqual(html(), 'KEEP');
});

t('定期更新: 中身が同じなら DOM を書き換えない。時間が進んで表示が変われば書き換える', () => {
  const { ctx, els } = pageCtx([{ id: '4320', name: '峰 竜太', ts: 1 }]);
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  let writes = 0;
  let cur = els.racerView.innerHTML;
  Object.defineProperty(els.racerView, 'innerHTML', { get: () => cur, set: (v) => ((cur = v), writes++) });
  ctx._racerRerender(NOW);
  assert.strictEqual(writes, 0, '同じ内容では書き換えない');
  ctx._racerRerender(NOW + 4 * 60000); // あと 10 分 → あと 6 分
  assert.strictEqual(writes, 1);
  assert.ok(cur.includes('あと 6 分'));
  ctx._renderRacerPage(null, NOW); // 明示的な描画（タブ切替など）は常に書く
  assert.strictEqual(writes, 2);
  assert.ok(/setInterval\(function \(\) \{\s*try \{\s*if \(!document\.hidden\) _racerRerender\(\);/.test(read('src/reporting/racer_page.js')));
});

section('[プロフィールの取得]');
function loaderCtx() {
  const ctx = makeCtx();
  const fetched = [];
  ctx.fetch = (url) => {
    fetched.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ updated_at: '2026-11-25T00:00:00Z', racers: { 1: { name: 'A' } } }) });
  };
  ctx._racerProfiles = undefined;
  ctx._racerProfilesReady = undefined;
  return { ctx, fetched };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
t('既に在れば取りに行かない', async () => {
  const { ctx, fetched } = loaderCtx();
  ctx._racerProfiles = { 9: {} };
  let n = 0;
  ctx._loadRacerProfiles(() => n++);
  await tick();
  assert.deepStrictEqual([fetched.length, n], [0, 0]);
});
t('起動時の取得が進行中ならそれを待ち、二重に取らない', async () => {
  const { ctx, fetched } = loaderCtx();
  let done;
  ctx._racerProfilesReady = new Promise((r) => (done = r));
  let n = 0;
  ctx._loadRacerProfiles(() => n++);
  ctx._loadRacerProfiles(() => n++); // 連打しても 1 回
  await tick();
  assert.deepStrictEqual([fetched.length, n], [0, 0]);
  ctx._racerProfiles = { 4320: { name: 'X' } }; // 起動時の取得が成功
  done();
  await tick();
  assert.deepStrictEqual([fetched.length, n], [0, 1]);
});
t('起動時の取得が失敗していたら 1 回取りに行き、届いたら知らせる', async () => {
  const { ctx, fetched } = loaderCtx();
  ctx._racerProfilesReady = Promise.resolve(); // 失敗（_racerProfiles は無いまま）
  let n = 0;
  ctx._loadRacerProfiles(() => n++);
  await tick();
  assert.deepStrictEqual(fetched, ['data/db/racerDB.json']);
  assert.strictEqual(n, 1);
  assert.strictEqual(ctx._racerProfiles[1].name, 'A');
  assert.strictEqual(ctx._racerProfilesAt, '2026-11-25T00:00:00Z');
});
t('取得に失敗しても例外を出さず、次に開いたときにやり直せる', async () => {
  const { ctx, fetched } = loaderCtx();
  let mode = 'reject';
  ctx.fetch = (url) => {
    fetched.push(url);
    return mode === 'reject' ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: false });
  };
  let n = 0;
  ctx._loadRacerProfiles(() => n++);
  await tick();
  mode = '404';
  ctx._loadRacerProfiles(() => n++);
  await tick();
  assert.deepStrictEqual([fetched.length, n, ctx._racerProfiles], [2, 0, undefined]);
});
t('起動時の取得 (loadDeferredData) が元の形を残し、進行中かどうかを公開する', () => {
  const app = read('assets/app.js');
  assert.ok(/globalThis\._racerProfiles=dbData\.racers;\s*globalThis\._racerProfilesAt=dbData\.updated_at\|\|'';/.test(app));
  assert.ok(/globalThis\._racerProfilesReady=_racerDbTask;\s*tasks\.push\(_racerDbTask\);/.test(app));
});

// ───────────────────────── 第 2 段階: 追加項目・公式の出場予定 / 過去 3 節 ─────────────────────────
function extData() {
  return {
    updated_at: '2026-11-25T00:00:00Z',
    source: 'fan2610',
    term: { year: 2027, half: 1, from: '2026-05-01', to: '2026-10-31' },
    racers: {
      4320: { b: '1985-03-30', s: 1, h: 171, bl: 'B', bp: '佐賀', ki: 95, w: [47, 22], y: [10, 2], pc: [1, 1, 2], ab: [75.0, 77.0], fl: [1, 0, 0, 0] },
      4635: { b: '1986-01-02', s: 1, h: 165, bl: 'O', bp: '岡山', ki: 96, w: [10, 12], y: [0, 0], pc: [2, 3, 3], ab: [50.0, 52.5], fl: [0, 0, 0, 0] },
    },
  };
}
function official(over) {
  return Object.assign(
    {
      toban: '4320',
      found: true,
      name: '峰 竜太',
      schedule: [
        { from: '2026-11-20', to: '2026-11-24', sid: 8, stadium: '常滑', grade: '一般', series: '', time: '', title: '終わった節', extra: '' },
        { from: '2026-12-06', to: '2026-12-11', sid: 7, stadium: '蒲郡', grade: 'G1', series: '', time: 'nighter', title: 'オールジャパン竹島特別', extra: '' },
        { from: '2026-12-29', to: '2027-01-03', sid: 23, stadium: '唐津', grade: '一般', series: 'オールレディース', time: 'morning', title: '<b>唐津</b>杯', extra: '追加' },
      ],
      back3: [
        { from: '2026-11-15', to: '2026-11-20', sid: 15, stadium: '丸亀', grade: 'G1', series: '', time: 'nighter', title: '京極賞', results: '2 21322 1 [1]' },
        { from: '2026-10-27', to: '2026-11-01', sid: 13, stadium: '尼崎', grade: 'SG', series: '', time: '', title: 'ダービー', results: '1 62351 6 22' },
      ],
      wins: [{ from: '2026-11-20', to: '2026-11-20', sid: 15, stadium: '丸亀', grade: 'G1', title: '京極賞' }],
      back3_ok: true,
    },
    over || {}
  );
}
// 公式の取得を差し替える（state: null = 未取得 / {data, loading, failed}）
function withOfficial(ctx, state) {
  const asked = [];
  ctx._loadRacerOfficial = (id, cb) => {
    asked.push({ id, cb });
    return false;
  };
  ctx._racerOfficialOf = () => state;
  return asked;
}

section('[第 2 段階: 現在の級と来期の級]');
t('適用開始の前は「前期級」が現在の級。級が変わる選手は来期の級も返す', () => {
  const { ctx } = pageCtx();
  ctx._racerExt = extData();
  const P = ctx._racerProfiles;
  const before = Date.parse('2026-11-25T12:00:00+09:00');
  const after = Date.parse('2027-01-01T00:00:00+09:00');
  // 4635: 名簿の級（来期）= B1(3)、前期級 = A2(2)
  assert.deepStrictEqual(J(ctx._racerClassOf('4635', P[4635], null, before)), { cls: 2, next: 3 });
  assert.deepStrictEqual(J(ctx._racerClassOf('4635', P[4635], null, after)), { cls: 3, next: 0 }, '適用開始後は名簿の級');
  assert.deepStrictEqual(J(ctx._racerClassOf('4635', P[4635], null, after - 1)), { cls: 2, next: 3 }, '12/31 23:59 (JST) まで');
  // 4320: 変わらない
  assert.deepStrictEqual(J(ctx._racerClassOf('4320', P[4320], null, before)), { cls: 1, next: 0 });
  // 今日の出走表があれば、それが現在の級
  assert.deepStrictEqual(J(ctx._racerClassOf('4635', P[4635], { racer_class_number: 2 }, before)), { cls: 2, next: 3 });
  // 追加項目が無い（未取得・名簿に無い）ときは名簿の級のまま
  assert.deepStrictEqual(J(ctx._racerClassOf('3941', P[3941], null, before)), { cls: 1, next: 0 });
  ctx._racerExt = undefined;
  assert.deepStrictEqual(J(ctx._racerClassOf('4635', P[4635], null, before)), { cls: 3, next: 0 });
  // 後期（7/1 適用）
  ctx._racerExt = Object.assign(extData(), { term: { year: 2027, half: 2, from: '2026-11-01', to: '2027-04-30' } });
  assert.strictEqual(ctx._racerClassOf('4635', P[4635], null, Date.parse('2027-06-30T23:00:00+09:00')).cls, 2);
  assert.strictEqual(ctx._racerClassOf('4635', P[4635], null, Date.parse('2027-07-01T00:00:00+09:00')).cls, 3);
});
t('検索の並び（級）は現在の級。追加項目が届いたら索引を作り直す', () => {
  const { ctx } = pageCtx();
  assert.deepStrictEqual(J(ctx._racerSearch('みね', NOW).ids), ['4320', '4635', '4237']);
  // 峰重（来期 B1・現在 A2）と同じ前方一致に、B1 で勝率の高い選手を足す
  ctx._racerProfiles[4700] = { name: '峰　山　　一　郎', kana: 'ﾐﾈﾔﾏ ｲﾁﾛｳ', classNum: 3, winRate: 6.5 };
  ctx._racerProfiles = Object.assign({}, ctx._racerProfiles);
  assert.deepStrictEqual(J(ctx._racerSearch('みね', NOW).ids), ['4320', '4700', '4635', '4237'], '追加項目なし: どちらも B1 → 勝率順');
  ctx._racerExt = extData();
  assert.deepStrictEqual(J(ctx._racerSearch('みね', NOW).ids), ['4320', '4635', '4700', '4237'], '現在 A2 の峰重が先');
});

section('[第 2 段階: 選手詳細の追加項目]');
t('プロフィール: 登録期・生年月日・身長・血液型・来期の級', () => {
  const { ctx, html } = pageCtx();
  ctx._racerExt = extData();
  withOfficial(ctx, null);
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  let h = html();
  assert.ok(h.includes('<span class="chip">佐賀支部</span><span class="chip">95期</span>'), h.slice(0, 900));
  assert.ok(h.includes('41歳（1985/3/30 生） / 171cm / 52kg / B型 / 佐賀出身'));
  assert.ok(!h.includes('chip-next'), '級が変わらない選手には出さない');
  ctx._renderRacerPage({ id: '4635', from: 'top' }, NOW);
  h = html();
  assert.ok(h.includes('<span class="cls-chip cls-2">A2</span><span class="chip chip-next">来期 B1</span>'), h.slice(0, 900));
  assert.ok(h.includes('40歳（1986/1/2 生） / 165cm / 53kg / O型 / 岡山出身'), '出走の無い選手の出身地は追加項目から');
});
t('成績: 算出期間・1 着 / 2 着・優出 / 優勝・能力指数・F・級の推移', () => {
  const { ctx, html } = pageCtx();
  ctx._racerExt = extData();
  withOfficial(ctx, null);
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  let h = html();
  assert.ok(h.includes('期別成績（2026/5/1〜10/31）: 勝率 8.85 ／ 2連対率 63.3% ／ 平均ST 0.12 ／ 109 走'));
  assert.ok(h.includes('1着 47 回・2着 22 回 ／ 優出 10 回・優勝 2 回 ／ 能力指数 75.00（前期 77.00）'));
  assert.ok(h.includes('<span class="c-danger">F 1 回</span> ／ L 0 回（この期間）'));
  assert.ok(h.includes('級の推移: A2 → A1 → A1 → A1（2027年前期）'));
  // 出走の無い選手（タイルの下にも出す）。F / L が 0 なら行を出さない
  ctx._renderRacerPage({ id: '4635', from: 'top' }, NOW);
  h = html();
  assert.ok(h.includes('<div><b>5.34</b><span>勝率</span></div>') && h.includes('1着 10 回・2着 12 回 ／ 優出 0 回・優勝 0 回'));
  assert.ok(h.includes('級の推移: B1 → B1 → A2 → B1（2027年前期）') && !h.includes('（この期間）'));
  // 追加項目が無ければ従来どおり 1 行
  ctx._racerExt = { racers: {}, term: null };
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  h = html();
  assert.ok(h.includes('期別成績（ファン手帳）: 勝率 8.85') && !h.includes('優出') && !h.includes('95期'));
});

section('[第 2 段階: 今後の出場予定 / 過去 3 節]');
t('出場予定: 終わった節は出さない。グレード・時間帯・シリーズ・追加あっせん。タイトルは escape', () => {
  const { ctx, html } = pageCtx();
  const asked = withOfficial(ctx, { data: official(), loading: false, failed: false });
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  const card = html().split('今後の出場予定')[1].split('</div></div>')[0] + html().split('今後の出場予定')[1];
  assert.strictEqual(asked.length, 1, '開いた時に取りに行く');
  assert.strictEqual(asked[0].id, '4320');
  const sched = html().split('今後の出場予定 <span')[1].split('<div class="card">')[0];
  assert.strictEqual(sched.split('class="sr-row"').length - 1, 2, sched);
  assert.ok(!sched.includes('終わった節'));
  assert.ok(sched.includes('<span class="sr-date">12/6(日)〜<br>12/11(金)</span><b class="sr-place">蒲郡</b>'));
  assert.ok(sched.includes('<span class="gr gr-g1">G1</span>オールジャパン竹島特別 <span class="fav-note">ナイター</span>'));
  assert.ok(sched.includes('12/29(火)〜<br>1/3(日)'), '年またぎ');
  assert.ok(sched.includes('&lt;b&gt;唐津&lt;/b&gt;杯') && !sched.includes('<b>唐津</b>杯'));
  assert.ok(sched.includes('オールレディース・モーニング') && sched.includes('<span class="fav-note">追加</span>'));
  assert.ok(!/gr-[a-z0-9]+">一般/.test(sched), '一般戦に印は付けない');
  assert.ok(card.length > 0);
  // シリーズ名が大会名に入っていれば、重ねて出さない（公式の G3 オールレディースは大会名に入っている）
  const lady = { from: '2027-01-04', to: '2027-01-09', sid: 16, stadium: '児島', grade: 'G3', series: 'オールレディース', time: '', title: 'オールレディース 第38回瀬戸の女王決定戦', extra: '' };
  ctx._racerOfficialOf = () => ({ data: official({ schedule: [lady] }), loading: false, failed: false });
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  const s2 = html().split('今後の出場予定 <span')[1].split('<div class="card">')[0];
  assert.strictEqual(s2.split('オールレディース').length - 1, 1, s2);
  assert.ok(!s2.includes('fav-note'), '時間帯も無ければ添え書き自体を出さない');
});
t('過去 3 節: 節間成績・優勝の印・直近の優勝', () => {
  const { ctx, html } = pageCtx();
  withOfficial(ctx, { data: official(), loading: false, failed: false });
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  const b = html().split('過去 3 節 <span')[1].split('<div class="racer-foot">')[0];
  assert.strictEqual(b.split('class="sr-row"').length - 1, 2);
  assert.ok(b.includes('<span class="sr-res">2 21322 1 <b class="res-1">[1]</b> <span class="sr-won">優勝</span></span>'), b);
  assert.ok(b.includes('<span class="sr-res">1 62351 6 22</span>'), '優勝していない節に印を付けない');
  assert.ok(b.includes('<span class="gr gr-sg">SG</span>ダービー'));
  assert.ok(b.includes('直近の優勝: 2026/11/20 丸亀 <span class="gr gr-g1">G1</span>京極賞'));
  assert.ok(html().includes('公式サイト（出場予定・過去 3 節）'), '出典に載せる');
  // 出場予定 → 成績 … → 過去 3 節 の順
  const h = html();
  assert.ok(h.indexOf('本日の出走') < h.indexOf('今後の出場予定') && h.indexOf('今後の出場予定') < h.indexOf('コース別成績'));
  assert.ok(h.indexOf('直近 20 走の着順') < h.indexOf('過去 3 節 <span'));
});
t('取得中 / 失敗 / 公式に選手ページが無い / 予定なし / 過去 3 節だけ失敗', () => {
  const { ctx, html } = pageCtx();
  const show = (state) => {
    withOfficial(ctx, state);
    ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
    return html();
  };
  let h = show({ data: null, loading: true, failed: false });
  assert.ok(h.includes('今後の出場予定') && h.includes('公式サイトから取得中…') && !h.includes('過去 3 節'));
  h = show({ data: null, loading: false, failed: true });
  assert.ok(h.includes('取得できませんでした') && h.includes('下のリンクから公式サイトで確認できます') && !h.includes('過去 3 節'));
  assert.ok(!h.includes('公式サイト（出場予定・過去 3 節）'), '出していない情報を出典に載せない');
  h = show({ data: { toban: '4320', found: false, schedule: [], back3: [], wins: [] }, loading: false, failed: false });
  assert.ok(h.includes('公式サイトにこの登録番号の選手ページがありません') && !h.includes('過去 3 節'));
  h = show({ data: official({ schedule: [], back3: [], wins: [] }), loading: false, failed: false });
  assert.ok(h.includes('発表されている出場予定はありません。') && !h.includes('sec-title">過去 3 節'));
  h = show({ data: official({ back3: [], wins: [], back3_ok: false }), loading: false, failed: false });
  assert.ok(h.includes('過去 3 節は取得できませんでした。') && h.includes('オールジャパン竹島特別'));
  // 取り直しに失敗しても、前に取れた内容は出したまま
  h = show({ data: official(), loading: false, failed: true });
  assert.ok(h.includes('オールジャパン竹島特別') && !h.includes('取得できませんでした（'));
  // 取得のしくみが無い（Worker の場所が分からない等）ならカードごと出さない
  ctx._loadRacerOfficial = () => false;
  ctx._racerOfficialOf = () => null;
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  assert.ok(!html().includes('今後の出場予定'));
});
t('公式の取得が終わったら描き直す（選手番号を時刻として渡さない）', () => {
  const { ctx } = pageCtx();
  const asked = withOfficial(ctx, { data: null, loading: true, failed: false });
  ctx._renderRacerPage({ id: '4320', from: 'top' }, NOW);
  const args = [];
  ctx._racerRerender = function () {
    args.push(Array.prototype.slice.call(arguments));
  };
  asked[0].cb('4320');
  assert.deepStrictEqual(args, [[]]);
});
t('お気に入り一覧: 「次節」の行。まだ取っていない選手を取りに行き、届いた行だけ書き換える', () => {
  const { ctx, html } = pageCtx([
    { id: '4320', name: '峰 竜太', ts: 2 },
    { id: '4635', name: '峰重 力也', ts: 1 },
  ]);
  const state = { 4320: { data: official(), loading: false, failed: false } };
  ctx._racerOfficialOf = (id) => state[id] || null;
  let batch = null;
  ctx._loadRacerOfficialMany = (ids, onEach) => {
    batch = { ids: J(ids), onEach };
    return ids.length;
  };
  ctx._renderRacerPage(null, NOW);
  assert.deepStrictEqual(batch.ids, ['4320', '4635']);
  assert.ok(html().includes('<div class="racer-li-next" data-racer-next="4320">次節 12/6〜12/11 蒲郡 G1</div>'), html().slice(0, 1500));
  assert.ok(html().includes('<div class="racer-li-next" data-racer-next="4635"></div>'));
  // 届いた行だけ書き換える
  const el = { innerHTML: '' };
  ctx.document.querySelectorAll = (sel) => (sel === '[data-racer-next="4635"]' ? [el] : []);
  state[4635] = { data: official({ schedule: [{ from: '2026-12-10', to: '2026-12-15', stadium: '大村', grade: '一般', title: 'x' }] }), loading: false, failed: false };
  batch.onEach('4635', NOW); // 実行時は時刻なし（＝いま）で呼ばれる
  assert.strictEqual(el.innerHTML, '次節 12/10〜12/15 大村');
  // 本日の出走タブ・検索では取りに行かない
  batch = null;
  ctx.ACTION_HANDLERS.racerTab({ dataset: { argTab: 'today' } });
  assert.strictEqual(batch, null);
  assert.ok(!html().includes('racer-li-next'));
});

t('年齢: 出走表 > 生年月日から計算（誕生日の前後で変わる）> 名簿', () => {
  const { ctx } = pageCtx();
  ctx._racerExt = extData();
  const at = (iso) => Date.parse(iso);
  const age = (id, now) => (/(\d+)歳/.exec(ctx._racerDetailHtml(id, 'list', now)) || [])[1];
  // 4635 は本日の出走なし。生年月日 1986-01-02、名簿の年齢は算出時点のまま
  ctx._racerProfiles[4635].age = 40;
  assert.strictEqual(age('4635', at('2026-11-25T14:45:00+09:00')), '40');
  assert.strictEqual(age('4635', at('2027-01-01T23:59:00+09:00')), '40', '誕生日の前日');
  assert.strictEqual(age('4635', at('2027-01-02T00:10:00+09:00')), '41', '誕生日（JST）に 1 歳増える。名簿の 40 のままにしない');
  // 生年月日が無ければ名簿の年齢
  delete ctx._racerExt.racers[4635].b;
  assert.strictEqual(age('4635', at('2027-01-02T00:10:00+09:00')), '40');
  // 本日出走する選手は出走表の年齢（公式）
  const prog = ctx._racerInfo('4320', null, NOW).prog;
  assert.ok(prog && prog.racer_age);
  ctx._racerExt.racers[4320].b = '1970-01-01';
  assert.strictEqual(age('4320', NOW), String(prog.racer_age));
  // 読めない生年月日・ありえない年齢は使わない
  for (const bad of ['1985-3-30', '85-03-30', '', null, '2030-01-01', '1900-01-01']) {
    assert.strictEqual(ctx._rAge(bad, NOW), null, String(bad));
  }
  assert.strictEqual(ctx._rAge('1985-03-30', at('2026-03-29T23:00:00+09:00')), 40);
  assert.strictEqual(ctx._rAge('1985-03-30', at('2026-03-30T00:00:00+09:00')), 41);
});
t('日付の境目は JST。今日が最終日の節は出し、昨日終わった節は出さない', () => {
  const { ctx } = pageCtx();
  const at = (iso) => Date.parse(iso);
  assert.strictEqual(ctx._racerIsoDay(at('2026-11-25T00:30:00+09:00')), '2026-11-25', 'JST 0 時台（UTC では前日）');
  assert.strictEqual(ctx._racerIsoDay(at('2026-11-24T23:59:00+09:00')), '2026-11-24');
  assert.strictEqual(ctx._racerIsoDay(at('2027-01-01T00:00:00+09:00')), '2027-01-01', '年またぎ');
  const sched = [
    { from: '2026-11-20', to: '2026-11-24', stadium: '常滑', grade: '一般', title: '昨日まで' },
    { from: '2026-11-22', to: '2026-11-25', stadium: '蒲郡', grade: '一般', title: '今日が最終日' },
    { from: '2026-12-06', to: '2026-12-11', stadium: '大村', grade: 'G1', title: '来月' },
  ];
  ctx._racerOfficialOf = () => ({ data: official({ schedule: sched }), loading: false, failed: false });
  const early = at('2026-11-25T00:30:00+09:00');
  let h = ctx._racerDetailHtml('4320', 'list', early);
  assert.ok(!h.includes('昨日まで') && h.includes('今日が最終日') && h.includes('来月'));
  assert.strictEqual(ctx._racerNextSeries('4320', early).title, '今日が最終日');
  // 日付が変わった直後（11/26 0:05）: 今日が最終日だった節は消える
  const next = at('2026-11-26T00:05:00+09:00');
  h = ctx._racerDetailHtml('4320', 'list', next);
  assert.ok(!h.includes('今日が最終日') && h.includes('来月'));
  assert.strictEqual(ctx._racerNextSeries('4320', next).title, '来月');
  assert.ok(ctx._racerNextLine('4320', next).indexOf('次節 12/6〜12/11 大村 G1') === 0);
});
t('壊れた応答・想定外の値でも落ちず、HTML をそのまま入れない', () => {
  const { ctx } = pageCtx();
  const evil = '<img src=x onerror=alert(1)>';
  const st = {
    data: {
      toban: '4320', found: true,
      schedule: [
        null, 'x', 7,
        { from: '2026-12-06', to: '2026-12-11', stadium: evil, grade: 'constructor', series: evil, time: 'constructor', title: evil, extra: evil },
        { from: evil, to: '2099-01-01', stadium: '蒲郡', grade: evil, time: evil, title: 't' },
      ],
      back3: { not: 'an array' },
      wins: [null, { from: '2026-11-20', stadium: evil, grade: '__proto__', title: evil }],
    },
    loading: false, failed: false,
  };
  ctx._racerOfficialOf = () => st;
  ctx._racerExt = extData();
  ctx._racerExt.term.year = evil;
  // 形は合っているが中身が文字列（HTML）: 数値は数値として出し、文字列は escape する
  Object.assign(ctx._racerExt.racers[4320], { w: [evil, 1], y: [evil, evil], ab: [evil, evil], fl: [1, evil], pc: [evil, 'constructor', 2], ki: evil, b: evil, h: evil, bl: evil, bp: evil });
  let h = '';
  assert.doesNotThrow(() => { h = ctx._racerDetailHtml('4320', 'list', NOW); });
  assert.ok(!h.includes('<img src=x'), 'HTML がそのまま入っている');
  assert.ok(!/function Object|native code/.test(h), 'Object の既定の項目を拾っている');
  assert.ok(h.includes('今後の出場予定') && h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(h.includes('1着 - 回・2着 1 回 ／ 優出 - 回・優勝 - 回'), '数値でない回数は - にする');
  // 形そのものが違う（配列のはずが文字列・数値）
  Object.assign(ctx._racerExt.racers[4320], { w: 'x', y: 5, ab: 'x', fl: 'x', pc: 'x' });
  assert.doesNotThrow(() => { h = ctx._racerDetailHtml('4320', 'list', NOW); });
  assert.ok(!h.includes('<img src=x') && !h.includes('undefined'));
  // 一覧の「次節」も同じ
  const line = ctx._racerNextLine('4320', NOW);
  assert.ok(!line.includes('<img') && line.includes('&lt;img'));
  // 応答そのものが配列・文字列でも落ちない
  for (const bad of [[], 'x', 5, { schedule: 'x' }, { schedule: [], back3: 'x', wins: 5 }]) {
    st.data = bad;
    assert.doesNotThrow(() => ctx._racerDetailHtml('4320', 'list', NOW), JSON.stringify(bad));
    assert.doesNotThrow(() => ctx._racerNextLine('4320', NOW), JSON.stringify(bad));
  }
});

section('[第 2 段階: 取得（追加項目 / 公式の選手ページ）]');
function officialCtx() {
  const ctx = makeCtx();
  const calls = [];
  let pending = [];
  ctx.fetch = (url, opt) => {
    // 起動時の処理（番組表の取得など）も fetch を呼ぶので、/racer-proxy だけ数える
    if (String(url).indexOf('/racer-proxy') < 0) return Promise.reject(new Error('no network in test'));
    calls.push({ url, opt });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  const settle = async (fn) => {
    const p = pending;
    pending = [];
    p.forEach(fn);
    await tick();
  };
  const ok = (body) => (x) => x.resolve({ ok: true, json: () => Promise.resolve(body) });
  return { ctx, calls, settle, ok };
}
t('公式: 取得中は重ねて取らない。成功は 30 分、失敗は 3 分は取り直さない', async () => {
  const { ctx, calls, settle, ok } = officialCtx();
  const done = [];
  assert.strictEqual(ctx._loadRacerOfficial('4320', (id) => done.push(id)), true);
  assert.strictEqual(ctx._loadRacerOfficial('4320', (id) => done.push(id)), false, '取得中');
  // 取得中は、時間がたっても・端末の時計が戻っても重ねて取らない（応答が遅いだけで 2 本目を投げない）
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, Date.now() + 31 * 60000), false, '取得中（31 分後）');
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, Date.now() - 60000), false, '取得中（時計が戻った）');
  assert.strictEqual(calls.length, 1);
  assert.ok(/\/racer-proxy\?toban=4320$/.test(calls[0].url) && calls[0].url.indexOf('https://boatrace-scrape-trigger') === 0);
  assert.strictEqual(J(ctx._racerOfficialOf('4320')).loading, true);
  await settle(ok(official()));
  assert.deepStrictEqual(done, ['4320']);
  const e = ctx._racerOfficialOf('4320');
  assert.deepStrictEqual([e.loading, e.failed, e.data.schedule.length], [false, false, 3]);
  const t0 = Date.now();
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t0 + 29 * 60000), false);
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t0 + 31 * 60000), true);
  // 取り直しに失敗: 前の内容は残し、3 分は取り直さない
  await settle((x) => x.reject(new Error('offline')));
  const f = ctx._racerOfficialOf('4320');
  assert.deepStrictEqual([f.loading, f.failed, f.data.schedule.length], [false, true, 3]);
  const t1 = Date.now();
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t1 + 2 * 60000), false);
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t1 + 4 * 60000), true);
});
t('公式: 過去 3 節だけ取れなかった結果は、3 分で取り直す（30 分は待たない）', async () => {
  const { ctx, calls, settle, ok } = officialCtx();
  ctx._loadRacerOfficial('4320');
  await settle(ok(official({ back3: [], wins: [], back3_ok: false })));
  const e = ctx._racerOfficialOf('4320');
  assert.deepStrictEqual([e.loading, e.failed, e.data.back3_ok, e.data.schedule.length], [false, false, false, 3]);
  const t0 = Date.now();
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t0 + 2 * 60000), false, '2 分後はまだ取り直さない');
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t0 + 4 * 60000), true, '4 分後に取り直す');
  // 取り直して全部取れたら、次は 30 分後
  await settle(ok(official()));
  assert.strictEqual(ctx._racerOfficialOf('4320').data.back3_ok, true);
  const t1 = Date.now();
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t1 + 4 * 60000), false);
  assert.strictEqual(ctx._loadRacerOfficial('4320', null, t1 + 31 * 60000), true);
  assert.strictEqual(calls.length, 3);
  // back3_ok の無い応答（古い形）は「一部だけ」と扱わない
  const noFlag = official();
  delete noFlag.back3_ok;
  ctx._loadRacerOfficial('4321');
  await settle(ok(noFlag));
  assert.strictEqual(ctx._racerOfficialOf('4321').data.back3_ok, undefined);
  assert.strictEqual(ctx._loadRacerOfficial('4321', null, Date.now() + 4 * 60000), false);
});
t('公式（一覧用）: 過去 3 節が欠けた結果は取り直さない（一覧は出場予定だけを使う）。30 分たてば取り直す', async () => {
  const { ctx, calls, settle, ok } = officialCtx();
  ctx.setTimeout = (fn) => fn();
  const realNow = Date.now;
  let clock = realNow.call(Date);
  ctx.Date.now = () => clock;
  try {
    ctx._loadRacerOfficial('4320');
    await settle(ok(official({ back3: [], wins: [], back3_ok: false })));
    calls.length = 0;
    clock += 4 * 60000; // 詳細なら取り直す間隔を過ぎている
    assert.strictEqual(ctx._loadRacerOfficialMany(['4320']), 0, '一覧からは取り直さない');
    assert.strictEqual(calls.length, 0);
    clock += 27 * 60000; // 取得から 31 分
    assert.strictEqual(ctx._loadRacerOfficialMany(['4320']), 1);
    assert.strictEqual(calls.length, 1);
  } finally {
    ctx.Date.now = realNow;
  }
});
t('公式: HTTP エラー・エラー応答・形の違う応答は失敗として扱う。番号が不正なら取りに行かない', async () => {
  const { ctx, calls, settle, ok } = officialCtx();
  for (const bad of ['', 'abc', '123', '123456', null]) assert.strictEqual(ctx._loadRacerOfficial(bad), false, String(bad));
  assert.strictEqual(calls.length, 0);
  ctx._loadRacerOfficial('5001');
  await settle((x) => x.resolve({ ok: false, status: 502 }));
  assert.deepStrictEqual(J(ctx._racerOfficialOf('5001')).failed, true);
  ctx._loadRacerOfficial('5002');
  await settle(ok({ error: 'upstream' }));
  assert.strictEqual(ctx._racerOfficialOf('5002').failed, true);
  // 存在しない選手（found: false）は「取れた」扱い（30 分は取り直さない）
  ctx._loadRacerOfficial('9999');
  await settle(ok({ toban: '9999', found: false, schedule: [], back3: [], wins: [] }));
  assert.deepStrictEqual([ctx._racerOfficialOf('9999').failed, ctx._racerOfficialOf('9999').data.found], [false, false]);
  ctx._loadRacerOfficial('5003');
  await settle(ok({ hello: 1 }));
  assert.deepStrictEqual([ctx._racerOfficialOf('5003').failed, ctx._racerOfficialOf('5003').data], [true, null]);
});
t('公式: 続けて 3 回失敗したら 10 分は誰の分も取りに行かない。1 回でも成功すれば数え直す', async () => {
  const { ctx, calls, settle, ok } = officialCtx();
  const failOne = async (id) => {
    assert.strictEqual(ctx._loadRacerOfficial(id), true, id);
    await settle((x) => x.resolve({ ok: false, status: 503 }));
  };
  await failOne('6001');
  await failOne('6002');
  ctx._loadRacerOfficial('6003');
  await settle(ok(official({ toban: '6003' }))); // 成功 → 数え直し
  await failOne('6004');
  await failOne('6005');
  assert.strictEqual(ctx._racerOfficialPaused(), false, '2 回ではまだ休止しない');
  await failOne('6006');
  assert.strictEqual(ctx._racerOfficialPaused(), true);
  const n = calls.length;
  assert.strictEqual(ctx._loadRacerOfficial('6007'), false, '休止中');
  assert.strictEqual(ctx._racerOfficialOf('6007'), null);
  assert.strictEqual(ctx._loadRacerOfficialMany(['6008', '6009', '6010']), 0, '一覧からも取りに行かない');
  assert.strictEqual(ctx._loadRacerOfficial('6007', null, Date.now() + 9 * 60000), false);
  assert.strictEqual(calls.length, n);
  // 10 分たてば取りに行く
  assert.strictEqual(ctx._racerOfficialPaused(Date.now() + 10 * 60000 + 1000), false);
  assert.strictEqual(ctx._loadRacerOfficial('6007', null, Date.now() + 10 * 60000 + 1000), true);
  assert.strictEqual(calls.length, n + 1);
  // 端末の時計が大きく戻っても、休止したままにならない
  assert.strictEqual(ctx._racerOfficialPaused(Date.now() - 60 * 60000), false);
});
t('選手詳細: 休止中でまだ取れていない選手にも「取得できませんでした」を出す（カードを黙って消さない）', () => {
  const { ctx } = pageCtx();
  ctx._loadRacerOfficial = () => false;
  ctx._racerOfficialOf = () => null;
  ctx._racerOfficialPaused = () => true;
  let h = ctx._racerDetailHtml('4320', 'list', NOW);
  assert.ok(h.includes('今後の出場予定') && h.includes('取得できませんでした'));
  assert.ok(!h.includes('取得中'));
  // 休止していない・取りに行けない（Worker の宛先が無いなど）ときは、カードごと出さない
  ctx._racerOfficialPaused = () => false;
  h = ctx._racerDetailHtml('4320', 'list', NOW);
  assert.ok(!h.includes('今後の出場予定') && !h.includes('取得できませんでした'));
});
t('公式: 時間切れを付けて取る（capabilities.makeTimeoutSignal）', () => {
  const { ctx, calls } = officialCtx();
  const sig = { tag: 'signal' };
  let ms = null;
  // 起動時の処理も capabilities を使うので、丸ごと差し替えずに makeTimeoutSignal だけ上書きする
  const caps = Object.create(ctx.capabilities);
  Object.defineProperty(caps, 'makeTimeoutSignal', { value: (n) => ((ms = n), sig) });
  ctx.capabilities = caps;
  ctx._loadRacerOfficial('4320');
  assert.strictEqual(ms, 25000); // 本番の初回取得は 10.9 秒かかった。10 秒では初回が毎回失敗に見える
  assert.strictEqual(calls[0].opt.signal, sig);
});
t('公式（一覧用）: 1 人ずつ順に、最大 20 人。取得済みの選手は飛ばす', async () => {
  const { ctx, calls, settle, ok } = officialCtx();
  ctx.setTimeout = (fn) => fn(); // 間隔を待たずに次へ
  ctx._loadRacerOfficial('4001');
  await settle(ok(official({ toban: '4001' })));
  calls.length = 0;
  const ids = [];
  for (let i = 0; i < 30; i++) ids.push(String(4001 + i));
  const got = [];
  const n = ctx._loadRacerOfficialMany(ids.concat(['x', '']), (id) => got.push(id));
  assert.strictEqual(n, 20);
  assert.strictEqual(calls.length, 1, '同時に 1 人だけ');
  assert.ok(/toban=4002$/.test(calls[0].url), '取得済みの 4001 は飛ばす');
  for (let i = 0; i < 25; i++) await settle(ok(official()));
  assert.strictEqual(calls.length, 20);
  assert.deepStrictEqual(got.slice(0, 3), ['4002', '4003', '4004']);
  assert.strictEqual(got.length, 20);
  assert.ok(/const|var RACER_OFFICIAL_BATCH_GAP_MS = 300/.test(read('src/discovery/racer_profiles_loader.js')));
});
t('追加項目: 1 回だけ取り、届いたら知らせる。失敗しても落ちない', async () => {
  const ctx = makeCtx();
  const urls = [];
  ctx._racerExt = undefined;
  ctx.fetch = (url) => {
    urls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(extData()) });
  };
  let n = 0;
  ctx._loadRacerExt(() => n++);
  ctx._loadRacerExt(() => n++);
  await tick();
  assert.deepStrictEqual(urls, ['data/db/racer_ext.json']);
  assert.strictEqual(n, 1);
  assert.strictEqual(ctx._racerExt.racers[4320].ki, 95);
  ctx._loadRacerExt(() => n++);
  await tick();
  assert.strictEqual(urls.length, 1, '取得済みなら取りに行かない');
  const b = makeCtx();
  b._racerExt = undefined;
  b.fetch = () => Promise.reject(new Error('offline'));
  b._loadRacerExt(() => n++);
  await tick();
  assert.strictEqual(b._racerExt, undefined);
});
t('選手ページを開いたら追加項目を取りに行く（一覧でも級の表示に使う）', () => {
  const { ctx } = pageCtx();
  let asked = 0;
  ctx._racerExt = undefined;
  ctx._loadRacerExt = () => asked++;
  ctx._renderRacerPage(null, NOW);
  assert.strictEqual(asked, 1);
  ctx._racerExt = extData();
  ctx._renderRacerPage(null, NOW);
  assert.strictEqual(asked, 1);
});
t('追加項目のデータ: 名簿と同じ選手を持ち、起動時に読むファイルとは別', () => {
  const ext = JSON.parse(read('data/db/racer_ext.json'));
  const db = JSON.parse(read('data/db/racerDB.json'));
  assert.ok(Object.keys(ext.racers).length > 1500);
  assert.ok(ext.term && /^\d{4}-\d{2}-\d{2}$/.test(ext.term.from) && /^\d{4}-\d{2}-\d{2}$/.test(ext.term.to));
  const sample = ext.racers[Object.keys(ext.racers)[0]];
  for (const k of ['b', 's', 'h', 'bl', 'ki', 'w', 'y', 'pc', 'fl']) assert.ok(k in sample, k);
  const any = db.racers[Object.keys(db.racers)[0]];
  assert.ok(!('ki' in any) && !('b' in any), 'racerDB.json には混ぜない');
  assert.ok(!/racer_ext\.json/.test(read('assets/app-critical.js')) && !/racer_ext\.json/.test(read('assets/app-rest.js')), '起動時には読まない');
});

section('[配線]');
t('選手ページは専用 chunk（rest には入れない）。お気に入りは rest', () => {
  const racer = read('assets/app-rest-racer.js');
  const rest = read('assets/app-rest.js');
  const critical = read('assets/app-critical.js');
  for (const m of ['DISCOVERY_RACER_PROFILES', 'REPORTING_RACER_PAGE', 'REPORTING_RACER_DETAIL']) {
    assert.ok(racer.includes('/* BUILD:' + m + ':START */'), m + ' が racer chunk に無い');
    assert.ok(!rest.includes('/* BUILD:' + m + ':START */') && !critical.includes('/* BUILD:' + m + ':START */'), m);
  }
  assert.ok(rest.includes('/* BUILD:REPORTING_RACER_FAV:START */'));
  assert.ok(!critical.includes('/* BUILD:REPORTING_RACER_FAV:START */'), 'critical の予算を使わない');
  assert.ok(racer.includes('_renderRacerPage') && !rest.includes('function _renderRacerPage'));
});
t('chunk の読込（detail と一緒）・オフライン用キャッシュ・版数の計算に入っている', () => {
  const router = read('src/reporting/page_router.js');
  assert.ok(/Promise\.all\(\[_ensureRaceDetailChunk\(\), _loadChunk\('racer', 'app-rest-racer\.min\.js'\)\]\)/.test(router));
  assert.ok(read('sw.js').includes("'./assets/app-rest-racer.min.js'"));
  const build = read('build/build.mjs');
  assert.ok(/Buffer\.concat\(\[criticalBuf, restBuf, restStatsBuf, restDetailBuf, restRacerBuf\]\)/.test(build));
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/app-rest-racer.min.js')));
});
t('写真の読込失敗と検索入力は入れ物で受ける（CSP: inline handler を使わない）', () => {
  for (const f of ['src/reporting/racer_page.js', 'src/reporting/racer_detail.js', 'src/reporting/racer_fav.js']) {
    assert.ok(!/\son(error|click|input|load)=/.test(read(f)), f + ' に inline handler');
  }
  const { ctx, els } = pageCtx();
  ctx._renderRacerPage(null, NOW);
  const img = { tagName: 'IMG', dataset: {} };
  els.racerView.fire('error', { target: img });
  assert.strictEqual(img.dataset.broken, '1');
});

(async () => {
  for (const q of queue) {
    if (q.title) {
      console.log(q.title);
      continue;
    }
    try {
      await q.fn();
      console.log('  PASS:', q.name);
      pass++;
    } catch (e) {
      console.log('  FAIL:', q.name, '\n    ', e.message);
      fail++;
    }
  }
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
