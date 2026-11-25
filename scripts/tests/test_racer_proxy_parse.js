/**
 * Cloudflare Worker /racer-proxy（選手の今後の出場予定・過去 3 節、2026-11-25）
 *   公式の選手ページ（profile / back3）の解析と、エンドポイントの振る舞い。
 *   フィクスチャは 2026-11-25 に採取した登録番号 4320 のページ（<main> 部分）。
 *
 *   node scripts/tests/test_racer_proxy_parse.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'cloudflare-worker', 'worker.js'), 'utf8');
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x));

// worker.js から必要な関数だけ brace-matching で抽出して eval する
function extractFn(name) {
  const i = src.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(i >= 0, `function ${name} not found in worker.js`);
  let depth = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}
function extractConst(name) {
  const m = new RegExp('^const ' + name + ' = [\\s\\S]*?;\\n', 'm').exec(src);
  assert.ok(m, `const ${name} not found`);
  return m[0].replace(/^const /, 'var ');
}

const calls = [];
const ctx = {
  console,
  fetch: async (url) => {
    calls.push(url);
    return ctx.__fetch(url);
  },
};
vm.createContext(ctx);
vm.runInContext(extractConst('RACER_PROFILE_KEYS'), ctx);
vm.runInContext(extractConst('RACER_PROXY_MAX_PER_MIN'), ctx);
vm.runInContext('var _racerScrapeLog = [];', ctx);
for (const fn of ['stripTags', 'zenToHan', 'racerSectionTable', 'racerTableRows', 'racerSeriesCells',
  'parseRacerProfileHTML', 'parseRacerBack3HTML', 'scrapeRacerOfficial', 'racerScrapeAllowed']) {
  vm.runInContext(extractFn(fn), ctx);
}

let pass = 0, fail = 0;
const queue = [];
const t = (name, f) => queue.push({ name, f });

t('プロフィール: 名前・かな・見出しの項目', () => {
  const r = J(ctx.parseRacerProfileHTML(fx('racer_profile.html')));
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.name, '峰 竜太');
  assert.strictEqual(r.kana, 'ミネ リュウタ');
  assert.deepStrictEqual(r.profile, {
    toban: '4320', birth: '1985/03/30', height: '171cm', weight: '52kg', blood: 'B型',
    branch: '佐賀', birthplace: '佐賀県', ki: '95期', cls: 'A1級',
  });
});
t('出場予定: 期間・場・グレード（PG1 / G1 / 一般）・時間帯・タイトル', () => {
  const s = J(ctx.parseRacerProfileHTML(fx('racer_profile.html'))).schedule;
  assert.strictEqual(s.length, 4);
  assert.deepStrictEqual(s[0], {
    from: '2026-12-06', to: '2026-12-11', sid: 7, stadium: '蒲郡', grade: 'G1', series: '', time: 'nighter',
    title: 'オールジャパン竹島特別 開設71周年記念競走', extra: '',
  });
  assert.deepStrictEqual([s[1].from, s[1].to, s[1].sid, s[1].stadium, s[1].grade, s[1].time],
    ['2026-12-29', '2027-01-03', 23, '唐津', '一般', 'morning']); // 年またぎ
  assert.deepStrictEqual([s[2].stadium, s[2].grade, s[2].time], ['江戸川', 'G1', '']);
  assert.deepStrictEqual([s[3].stadium, s[3].grade, s[3].title], ['三国', 'PG1', '第8回BBCトーナメント']);
});
t('「本日出走予定」の表を出場予定に混ぜない', () => {
  const s = J(ctx.parseRacerProfileHTML(fx('racer_profile.html'))).schedule;
  assert.ok(s.every((x) => x.from >= '2026-12-01'), JSON.stringify(s.map((x) => x.from)));
  assert.ok(!s.some((x) => /チャレンジカップ/.test(x.title)));
});
t('過去 3 節: 節間成績（全角 → 半角、日の区切りは空白、優勝戦は [ ]）', () => {
  const r = J(ctx.parseRacerBack3HTML(fx('racer_back3.html')));
  assert.strictEqual(r.back3.length, 3);
  assert.deepStrictEqual(r.back3[0], {
    from: '2026-11-15', to: '2026-11-20', sid: 15, stadium: '丸亀', grade: 'G1', series: '', time: 'nighter',
    title: '京極賞開設74周年記念競走', results: '2 21322 1 [1]',
  });
  assert.deepStrictEqual(r.back3.map((x) => [x.stadium, x.grade, x.results]), [
    ['丸亀', 'G1', '2 21322 1 [1]'],
    ['鳴門', 'G1', '1 31212 1 2'],
    ['尼崎', 'SG', '1 62351 6 22'],
  ]);
});
t('直近の優勝: 過去 3 節の表と取り違えない', () => {
  const r = J(ctx.parseRacerBack3HTML(fx('racer_back3.html')));
  assert.deepStrictEqual(r.wins, [{
    from: '2026-11-20', to: '2026-11-20', sid: 15, stadium: '丸亀', grade: 'G1', series: '', time: 'nighter',
    title: '京極賞開設74周年記念競走',
  }]);
});
t('存在しない登録番号 / 空の応答 / 表の無いページでも落ちない', () => {
  const nf = J(ctx.parseRacerProfileHTML(fx('racer_notfound.html')));
  assert.deepStrictEqual(nf, { found: false, name: '', kana: '', profile: {}, schedule: [] });
  assert.deepStrictEqual(J(ctx.parseRacerProfileHTML('')), nf);
  assert.deepStrictEqual(J(ctx.parseRacerBack3HTML('')), { back3: [], wins: [] });
  assert.deepStrictEqual(J(ctx.parseRacerBack3HTML(fx('racer_notfound.html'))), { back3: [], wins: [] });
  // 出場予定の表が空（あっせんが無い選手）
  const html = fx('racer_profile.html').replace(/(title9_mainLabel">出場予定<[\s\S]*?<\/thead>)[\s\S]*?<\/table>/, '$1</table>');
  const r = J(ctx.parseRacerProfileHTML(html));
  assert.strictEqual(r.found, true);
  assert.deepStrictEqual(r.schedule, []);
});
t('見出しだけで表が無い節は空（次の見出しの表を拾わない）', () => {
  // 過去 3 節の表だけを消す → 続く「直近の優勝情報」の表を過去 3 節として読んではいけない
  const full = fx('racer_back3.html');
  const i = full.indexOf('title9_mainLabel">過去3節成績<');
  const t0 = full.indexOf('<table', i);
  const t1 = full.indexOf('</table>', t0) + '</table>'.length;
  assert.ok(i >= 0 && t0 > i && t1 > t0);
  const html = full.slice(0, t0) + '<p>データがありません。</p>' + full.slice(t1);
  const r = J(ctx.parseRacerBack3HTML(html));
  assert.deepStrictEqual(r.back3, []);
  assert.strictEqual(r.wins.length, J(ctx.parseRacerBack3HTML(full)).wins.length);
  assert.ok(r.wins.length >= 1);
});
t('グレード / シリーズ / 時間帯の印', () => {
  const cell = (attr, html) => ({ attr, html: html || '' });
  const row = (g, tz) => [cell('', '2026/12/01<br/>～<br/>2026/12/06'), cell('', '<img src="/x/text_place1_24.png" alt="大村" />'),
    cell(' class="is-p10-5 ' + g + ' "'), cell(tz ? ' class="' + tz + '"' : ''), cell('', '<a href="/a">Ｇ３オールレディース　タイトル</a>')];
  const g = (a, b) => { const r = J(ctx.racerSeriesCells(row(a, b))); return [r.grade, r.series, r.time, r.sid]; };
  assert.deepStrictEqual(g('is-SGa', ''), ['SG', '', '', 24]); // 場番号はリンクが無ければ画像名から
  assert.deepStrictEqual(g('is-G2b', 'is-midnight'), ['G2', '', 'midnight', 24]);
  assert.deepStrictEqual(g('is-G3b', 'is-lady'), ['G3', 'オールレディース', '', 24]);
  assert.deepStrictEqual(g('is-ippan', 'is-venus'), ['一般', 'ヴィーナス', '', 24]);
  assert.deepStrictEqual(g('is-ippan is-rookie__3rdadd', 'is-summer'), ['一般', 'ルーキー', 'summer', 24]);
  assert.strictEqual(J(ctx.racerSeriesCells(row('is-G3b', 'is-lady'))).title, 'G3オールレディース タイトル');
  assert.strictEqual(ctx.racerSeriesCells([cell('', '日付なし')]), null);
});
t('着順以外の記号（F・欠・転 など）もそのまま残す', () => {
  const html = fx('racer_back3.html').replace('>[１]</a>', '>Ｆ</a>　<a href="/x">欠</a><a href="/y">転</a>');
  assert.strictEqual(J(ctx.parseRacerBack3HTML(html)).back3[0].results, '2 21322 1 F 欠転');
});
t('scrapeRacerOfficial: 2 ページを取り、過去 3 節が取れなくても出場予定は返す', async () => {
  const res = (ok, text, status) => ({ ok, status: status || (ok ? 200 : 503), text: async () => text });
  calls.length = 0;
  ctx.__fetch = (url) => (/profile\?/.test(url) ? res(true, fx('racer_profile.html')) : res(true, fx('racer_back3.html')));
  let r = J(await ctx.scrapeRacerOfficial('4320'));
  assert.deepStrictEqual(calls.slice().sort(), [
    'https://www.boatrace.jp/owpc/pc/data/racersearch/back3?toban=4320',
    'https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=4320',
  ]);
  assert.deepStrictEqual([r.toban, r.found, r.name, r.schedule.length, r.back3.length, r.wins.length, r.back3_ok],
    ['4320', true, '峰 竜太', 4, 3, 1, true]);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r.fetched_at));

  ctx.__fetch = (url) => (/profile\?/.test(url) ? res(true, fx('racer_profile.html')) : res(false, '', 503));
  r = J(await ctx.scrapeRacerOfficial('4320'));
  assert.deepStrictEqual([r.found, r.schedule.length, r.back3.length, r.back3_ok], [true, 4, 0, false]);

  ctx.__fetch = () => res(false, 'forbidden', 403);
  await assert.rejects(() => ctx.scrapeRacerOfficial('4320'), /racer profile 403/);

  ctx.__fetch = () => res(true, fx('racer_notfound.html'));
  r = J(await ctx.scrapeRacerOfficial('9999'));
  assert.deepStrictEqual([r.found, r.schedule, r.back3], [false, [], []]);
});
t('取得の上限: edge に無い選手は 1 分に 30 人まで（総なめの抑止）。1 分たてば戻る', () => {
  const t0 = 1_800_000_000_000;
  for (let i = 0; i < 30; i++) assert.strictEqual(ctx.racerScrapeAllowed(t0 + i * 100), true, 'i=' + i);
  assert.strictEqual(ctx.racerScrapeAllowed(t0 + 5000), false);
  assert.strictEqual(ctx.racerScrapeAllowed(t0 + 59999), false);
  assert.strictEqual(ctx.racerScrapeAllowed(t0 + 60000), true, '最初の 1 件が 1 分を過ぎた');
  assert.strictEqual(ctx.racerScrapeAllowed(t0 + 60000), false);
  assert.strictEqual(ctx.racerScrapeAllowed(t0 + 200000), true);
  // 時計が戻っても、古い記録が残り続けて止まったままにならない
  for (let i = 0; i < 30; i++) ctx.racerScrapeAllowed(t0 + 300000 + i);
  assert.strictEqual(ctx.racerScrapeAllowed(t0 + 300100), false);
  assert.strictEqual(ctx.racerScrapeAllowed(t0 + 100000), true, '時計が戻った');
});
t('身元を偽らない（ブラウザを装う UA にしない）。拒否・混雑は blocked の印を付けて投げる', async () => {
  // エンドポイントの振る舞い（検証・edge への保存・上限・拒否時の停止）は test_racer_proxy_endpoint.mjs
  const fn = extractFn('scrapeRacerOfficial');
  assert.ok(/'User-Agent': 'Mozilla\/5\.0 boatrace-scrape-worker\/[\d.]+'/.test(fn));
  assert.ok(!/Chrome\/|Safari\/|Firefox\/|AppleWebKit/.test(fn));
  const res = (status) => ({ ok: status === 200, status, text: async () => '' });
  for (const [status, blocked] of [[403, true], [429, true], [500, false], [404, false]]) {
    ctx.__fetch = () => res(status);
    const e = await ctx.scrapeRacerOfficial('4320').then(() => null, (x) => x);
    assert.ok(e && new RegExp('racer profile ' + status).test(e.message), String(status));
    assert.strictEqual(!!e.blocked, blocked, String(status));
  }
});

(async () => {
  console.log('[/racer-proxy: 選手の出場予定・過去 3 節]');
  for (const q of queue) {
    try { await q.f(); pass++; console.log(`  PASS: ${q.name}`); }
    catch (e) { fail++; console.log(`  FAIL: ${q.name} — ${e.message}`); }
  }
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})();
