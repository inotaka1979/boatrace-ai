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
