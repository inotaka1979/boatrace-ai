/**
 * Cloudflare Worker /racer-proxy のエンドポイント（2026-11-25）
 *   実際の worker モジュールを読み込み、fetch / caches を差し替えて 1 リクエストずつ通す。
 *   解析そのものは test_racer_proxy_parse.js。ここは「取りに行く回数」と応答ヘッダを固定する:
 *     - 登録番号の検証（400）
 *     - 取れた結果は edge に置き、2 回目からは boatrace.jp に取りに行かない
 *     - ブラウザに置かせる時間は「残り時間」（edge + ブラウザで古さが 2 倍にならない）
 *     - 存在しない選手は短く置く / 失敗は置かない
 *     - 公式が拒否（403 / 429）したら 10 分は取りに行かない
 *     - アプリが待ち切れずに接続を切っても、取得と edge への保存は最後までやる（waitUntil）
 *     - 公式への取得には時間切れを付け、アプリが待つ時間より先に打ち切る
 *     - edge に無い選手の取得は 1 分に 30 人まで（429）。edge にある分は対象外
 *     - CORS は許可したオリジンだけ
 *
 *   node scripts/tests/test_racer_proxy_endpoint.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const fx = (n) => fs.readFileSync(path.join(HERE, 'fixtures', n), 'utf8');

// ---- 差し替え: edge のキャッシュ（URL → Response）と boatrace.jp への fetch
const edge = new Map();
const puts = [];
globalThis.caches = {
  default: {
    async match(req) {
      const hit = edge.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      puts.push(req.url);
      edge.set(req.url, res);
    },
  },
};
let upstream = [];
let upstreamOpts = [];
let respond = null;
globalThis.fetch = async (input, opt) => {
  const u = String(input && input.url ? input.url : input);
  upstream.push(u);
  upstreamOpts.push(opt || {});
  return respond(u);
};
const page = (body, status) => new Response(body, { status: status || 200, headers: { 'content-type': 'text/html' } });
const official = (u) => page(/profile\?/.test(u) ? fx('racer_profile.html') : fx('racer_back3.html'));

const worker = (await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href)).default;
const pending = [];
const CTX = { waitUntil(p) { pending.push(p); } };
const ORIGIN = 'https://inotaka1979.github.io';
async function get(toban, origin) {
  const headers = origin === null ? {} : { origin: origin || ORIGIN };
  const q = toban === undefined ? '' : '?toban=' + toban;
  const res = await worker.fetch(new Request('https://w.example.dev/racer-proxy' + q, { headers }), {}, CTX);
  await Promise.all(pending.splice(0));
  return res;
}
// 実時計を進める代わりに Date.now を差し替える（上限の 1 分・残り時間の計算）
const realNow = Date.now;
let clock = realNow.call(Date);
Date.now = () => clock;
const advance = (ms) => { clock += ms; };

let pass = 0, fail = 0;
async function t(name, fn) {
  upstream = [];
  upstreamOpts = [];
  respond = official;
  try { await fn(); console.log('  PASS:', name); pass++; }
  catch (e) { console.log('  FAIL:', name, '\n    ', e.message); fail++; }
}

console.log('[/racer-proxy: エンドポイント]');

await t('登録番号は数字 4〜5 桁だけ。それ以外は 400 で、取りに行かない', async () => {
  for (const bad of [undefined, '', 'abc', '123', '123456', '4320;x', '43 20', '../x']) {
    const res = await get(bad === undefined ? undefined : encodeURIComponent(bad));
    assert.strictEqual(res.status, 400, String(bad));
  }
  assert.deepStrictEqual(upstream, []);
  assert.deepStrictEqual(puts, []);
});

await t('1 回目: 公式の 2 ページを取り、JSON で返して edge に 3 時間置く', async () => {
  const res = await get('4320');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(upstream.slice().sort(), [
    'https://www.boatrace.jp/owpc/pc/data/racersearch/back3?toban=4320',
    'https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=4320',
  ]);
  assert.strictEqual(res.headers.get('x-cache'), 'MISS');
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=10800');
  assert.ok(/application\/json/.test(res.headers.get('content-type')));
  const j = await res.json();
  assert.deepStrictEqual([j.toban, j.found, j.name, j.schedule.length, j.back3.length, j.wins.length, j.back3_ok],
    ['4320', true, '峰 竜太', 4, 3, 1, true]);
  assert.strictEqual(puts.length, 1);
  assert.ok(/[?&]toban=4320$/.test(puts[0]));
});

await t('2 回目以降: edge から返し、boatrace.jp には取りに行かない。ブラウザに置かせるのは残り時間', async () => {
  advance(60 * 60000); // 1 時間後
  const res = await get('4320');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(upstream, [], '取りに行かない');
  assert.strictEqual(res.headers.get('x-cache'), 'HIT');
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=7200', '3 時間 − 1 時間');
  assert.strictEqual((await res.json()).name, '峰 竜太');
  advance(2 * 3600000 - 30000); // 期限の 30 秒前でも 60 秒は置かせる（0 や負にしない）
  assert.strictEqual((await get('4320')).headers.get('cache-control'), 'public, max-age=60');
  // 期限の印が無い保存分（形が変わった場合）でも壊れない
  const key = [...edge.keys()].find((k) => /toban=4320$/.test(k));
  const old = edge.get(key);
  const h = new Headers(old.headers);
  h.delete('x-racer-expires');
  edge.set(key, new Response(await old.clone().text(), { headers: h }));
  assert.strictEqual((await get('4320')).headers.get('cache-control'), 'public, max-age=60');
  assert.strictEqual(puts.length, 1, '置き直さない');
});

await t('CORS: 許可したオリジンにだけ ACAO を付ける（edge から返すときも）', async () => {
  const ok = await get('4320');
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.ok(/Origin/i.test(ok.headers.get('vary') || ''));
  const ng = await get('4320', 'https://evil.example');
  assert.strictEqual(ng.headers.get('access-control-allow-origin'), null);
  const none = await get('4320', null); // Origin 無し（curl など）
  assert.strictEqual(none.status, 200);
  assert.strictEqual(none.headers.get('access-control-allow-origin'), null);
});

await t('存在しない選手番号は 10 分だけ置く（引退・誤り）', async () => {
  respond = () => page(fx('racer_notfound.html'));
  const res = await get('9999');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=600');
  const j = await res.json();
  assert.deepStrictEqual([j.found, j.schedule, j.back3, j.wins], [false, [], [], []]);
  upstream = [];
  advance(5 * 60000);
  const again = await get('9999');
  assert.deepStrictEqual(upstream, []);
  assert.strictEqual(again.headers.get('cache-control'), 'public, max-age=300');
});

await t('公式の障害・通信の失敗: 502 を返し、置かない（次の人が取り直せる）', async () => {
  const before = puts.length;
  respond = () => page('error', 500);
  const res = await get('4444');
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.deepStrictEqual((await res.json()).error, 'upstream');
  assert.strictEqual(puts.length, before);
  // 通信そのものが失敗しても同じ
  respond = () => { throw new Error('network down'); };
  const res2 = await get('4445');
  assert.strictEqual(res2.status, 502);
  assert.strictEqual(puts.length, before);
  // 障害（5xx）では止めない: 次の選手は取りに行く。過去 3 節だけ取れないときは出場予定を返す（back3_ok: false）
  respond = (u) => (/profile\?/.test(u) ? page(fx('racer_profile.html')) : page('busy', 503));
  const res3 = await get('4446');
  const j = await res3.json();
  assert.deepStrictEqual([res3.status, j.schedule.length, j.back3.length, j.back3_ok], [200, 4, 0, false]);
});

await t('過去 3 節だけ取れなかった結果は 10 分だけ置く（3 時間置くと、その間ずっと「取得できませんでした」のまま）', async () => {
  // 一時的な失敗（5xx）: 一部だけの結果も置くが 10 分だけ。過去 3 節のページの HTTP 状態を残す
  const before = puts.length;
  respond = (u) => (/profile\?/.test(u) ? page(fx('racer_profile.html')) : page('busy', 503));
  const res = await get('4460');
  const j = await res.json();
  assert.deepStrictEqual([res.status, j.found, j.schedule.length, j.back3_ok], [200, true, 4, false]);
  assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=600');
  assert.strictEqual(j.timing.back3_status, 503, '過去 3 節のページの HTTP 状態が残っていない');
  assert.strictEqual(puts.length, before + 1, '一部だけの結果も置く（取り直しの間隔を空けるため）');
  // 2 回目は置いたものが返る。ブラウザに置かせるのも残り時間まで（10 分を超えない）
  advance(4 * 60000);
  upstream = [];
  const again = await get('4460');
  assert.deepStrictEqual([again.headers.get('x-cache'), again.headers.get('cache-control'), upstream.length], ['HIT', 'public, max-age=360', 0]);
  // 5xx は「断られた」ではない: 次の選手は 2 ページとも取りに行く
  respond = official;
  const full = await get('4461');
  const fj = await full.json();
  assert.strictEqual(upstream.length, 2);
  // 両方取れた結果は 3 時間のまま。過去 3 節の HTTP 状態は 200
  assert.strictEqual(full.headers.get('cache-control'), 'public, max-age=10800');
  assert.deepStrictEqual([fj.back3_ok, fj.timing.back3_status, typeof fj.timing.back3_ms], [true, 200, 'number']);
});

await t('過去 3 節のページだけ断られたら（403 / 429）、そのページだけ 10 分取りに行かない。選手ページは取り続ける', async () => {
  // 公式サイトは Worker からの取得をページ単位で断ることがある（デプロイ run 81: 選手ページは取れ、過去 3 節は取れなかった）
  advance(2 * 60000);
  for (const refused of [403, 429]) {
    respond = (u) => (/profile\?/.test(u) ? page(fx('racer_profile.html')) : page('refused', refused));
    const a = String(4470 + (refused === 403 ? 0 : 5));
    const b = String(+a + 1);
    const c = String(+a + 2);
    upstream = [];
    const first = await get(a);
    const j = await first.json();
    assert.deepStrictEqual([first.status, j.schedule.length, j.back3_ok, j.timing.back3_status], [200, 4, false, refused]);
    assert.strictEqual(first.headers.get('cache-control'), 'public, max-age=600');
    assert.strictEqual(upstream.length, 2, '断られたことに気づく 1 回');
    // 公式が戻っていても、10 分は過去 3 節を確かめに行かない。選手ページだけ取って返す
    respond = official;
    upstream = [];
    advance(4 * 60000);
    const second = await get(b);
    const j2 = await second.json();
    assert.deepStrictEqual(upstream, ['https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=' + b], '止めている間は選手ページだけ');
    assert.deepStrictEqual([second.status, j2.name, j2.schedule.length, j2.back3_ok, j2.back3.length], [200, '峰 竜太', 4, false, 0]);
    assert.deepStrictEqual([j2.timing.back3_status, j2.timing.back3_ms], [0, null], '取りに行かなかった時は 0 / null');
    assert.ok(j2.timing.profile_ms >= 0);
    // 置くのは「止めている残り時間」だけ（止めるのをやめたら取り直せる）
    assert.strictEqual(second.headers.get('cache-control'), 'public, max-age=360');
    // 残りが短くても 60 秒は置く
    advance(5 * 60000 + 30000);
    upstream = [];
    const third = await get(c);
    assert.deepStrictEqual([upstream.length, third.headers.get('cache-control')], [1, 'public, max-age=60']);
    // 10 分たったら、置いた結果は切れていて、2 ページとも取りに行く
    advance(30000 + 1000);
    edge.delete([...edge.keys()].find((k) => k.endsWith('toban=' + b))); // 差し替えの edge は期限を見ないので、切れた分を消す
    upstream = [];
    const back = await get(b);
    const j4 = await back.json();
    assert.strictEqual(upstream.length, 2, '10 分たったら過去 3 節も取りに行く');
    assert.deepStrictEqual([j4.back3_ok, j4.back3.length, j4.timing.back3_status], [true, 3, 200]);
    assert.strictEqual(back.headers.get('cache-control'), 'public, max-age=10800');
    advance(2 * 60000);
  }
});

await t('公式が拒否（403）したら 10 分は取りに行かない（叩き続けない）。edge にある選手はその間も返す', async () => {
  respond = () => page('forbidden', 403);
  const first = await get('4447');
  assert.strictEqual(first.status, 502);
  assert.strictEqual(upstream.length, 2, '拒否に気づく 1 回（2 ページ）だけ');
  upstream = [];
  respond = official; // 公式が戻っていても、10 分は確かめに行かない
  const paused = await get('4448');
  assert.strictEqual(paused.status, 503);
  assert.deepStrictEqual(await paused.json(), { error: 'blocked' });
  assert.strictEqual(paused.headers.get('cache-control'), 'no-store');
  assert.strictEqual(paused.headers.get('retry-after'), '600');
  assert.strictEqual(paused.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepStrictEqual(upstream, [], '止めている間は boatrace.jp に取りに行かない');
  const hit = await get('4446'); // 直前のテストで edge に置いた選手
  assert.deepStrictEqual([hit.status, hit.headers.get('x-cache')], [200, 'HIT']);
  advance(9 * 60000 + 59000);
  assert.strictEqual((await get('4448')).status, 503);
  assert.strictEqual(upstream.length, 0);
  advance(2000);
  const back = await get('4448');
  assert.deepStrictEqual([back.status, upstream.length], [200, 2], '10 分たったら取りに行く');
  // 混雑（429）も同じ扱い
  respond = () => page('too many', 429);
  assert.strictEqual((await get('4449')).status, 502);
  upstream = [];
  assert.strictEqual((await get('4450')).status, 503);
  assert.deepStrictEqual(upstream, []);
  advance(10 * 60000 + 1000);
});

await t('取得の上限: edge に無い選手は 1 分に 30 人まで。超えたら 429 で取りに行かない。edge にある分は返す', async () => {
  advance(2 * 60000); // 直前のテストの取得分を上限の窓から出す
  let ok = 0;
  for (let i = 0; i < 30; i++) {
    const res = await get(String(5000 + i));
    if (res.status === 200) ok++;
    advance(100);
  }
  assert.strictEqual(ok, 30);
  upstream = [];
  const busy = await get('5999');
  assert.strictEqual(busy.status, 429);
  assert.strictEqual(busy.headers.get('retry-after'), '60');
  assert.strictEqual(busy.headers.get('cache-control'), 'no-store');
  assert.deepStrictEqual(upstream, [], '上限を超えた分は boatrace.jp に取りに行かない');
  assert.strictEqual(busy.headers.get('access-control-allow-origin'), ORIGIN, 'アプリが 429 を読める');
  // edge にある選手は上限に関係なく返す
  const hit = await get('5003');
  assert.deepStrictEqual([hit.status, hit.headers.get('x-cache')], [200, 'HIT']);
  // 1 分たてば戻る
  advance(61000);
  assert.strictEqual((await get('5999')).status, 200);
});

await t('アプリが待ち切れずに切っても、取得と edge への保存を最後までやる（応答の前に waitUntil に載せる）', async () => {
  advance(2 * 60000);
  // 公式サイトの応答が遅い: release() するまで返らない
  const waiting = [];
  respond = (u) => new Promise((resolve) => waiting.push(() => resolve(official(u))));
  const before = puts.length;
  const res = worker.fetch(new Request('https://w.example.dev/racer-proxy?toban=6100', { headers: { origin: ORIGIN } }), {}, CTX);
  res.catch(() => {});
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(upstream.length, 2, '公式の 2 ページを取りに行っている最中');
  assert.strictEqual(pending.length, 1, '応答を待っている間に、もう waitUntil に載っている（取得が終わってからでは遅い）');
  // ここでアプリが接続を切ったとする（応答は読まない）。公式が応答したら、waitUntil の仕事だけで保存まで終わる
  const job = pending.splice(0);
  waiting.splice(0).forEach((release) => release());
  await Promise.all(job);
  assert.strictEqual(puts.length, before + 1, 'edge に保存された');
  assert.ok(/toban=6100$/.test(puts[puts.length - 1]));
  // 次に開いた時は edge から返る（公式には取りに行かない）
  upstream = [];
  respond = official;
  const again = await get('6100');
  assert.deepStrictEqual([again.status, again.headers.get('x-cache'), upstream.length], [200, 'HIT', 0]);
  await res; // 後始末（この環境では handler も最後まで走る）
});

await t('拒否の記録も仕事の中で行う（接続が切れた後でも、次の人の取得を止める）', async () => {
  advance(11 * 60000);
  const waiting = [];
  respond = () => new Promise((resolve) => waiting.push(() => resolve(page('forbidden', 403))));
  const res = worker.fetch(new Request('https://w.example.dev/racer-proxy?toban=6200'), {}, CTX);
  res.catch(() => {});
  await new Promise((r) => setTimeout(r, 20));
  const job = pending.splice(0);
  assert.strictEqual(job.length, 1);
  waiting.splice(0).forEach((release) => release());
  await Promise.all(job); // waitUntil の仕事は失敗しても reject しない（runtime に未処理の失敗を残さない）
  upstream = [];
  respond = official;
  const next = await get('6201');
  assert.deepStrictEqual([next.status, upstream.length], [503, 0]);
  assert.strictEqual((await res).status, 502);
  advance(10 * 60000 + 1000);
});

await t('公式サイトの応答にかかった時間を応答に含める（遅いのがどこかを後から判別できる）', async () => {
  // このテストは時計を固定しているので、公式の応答 1 つにつき時計を 4 秒進めて「遅い応答」を表す
  respond = async (u) => {
    advance(4000);
    return new Response(/profile\?/.test(u) ? fx('racer_profile.html') : fx('racer_back3.html'), {
      status: 200,
      headers: { 'content-type': 'text/html', 'server-timing': 'cdn-cache; desc=MISS, edge; dur=9264, origin; dur=63' },
    });
  };
  const res = await get('6400');
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  assert.ok(j.timing && typeof j.timing === 'object', 'timing が無い: ' + JSON.stringify(j).slice(0, 120));
  // 2 ページは同時に取りに行く。どちらも「取りに行ってから応答が届くまで」の時間
  assert.ok(j.timing.profile_ms >= 4000 && j.timing.profile_ms <= 8000, 'profile_ms=' + j.timing.profile_ms);
  assert.ok(j.timing.back3_ms >= 4000 && j.timing.back3_ms <= 8000, 'back3_ms=' + j.timing.back3_ms);
  assert.deepStrictEqual([j.timing.edge_ms, j.timing.origin_ms], [9264, 63]);
  assert.strictEqual(j.schedule.length, 4);
  // 保存した結果にも入る（後から開いた人の応答でも、取得した時の所要時間が分かる）
  const again = await (await get('6400')).json();
  assert.deepStrictEqual(again.timing, j.timing);
});

await t('公式への取得に時間切れを付ける。時間切れは 502（置かない・拒否扱いにしない）', async () => {
  await get('6300');
  assert.strictEqual(upstreamOpts.length, 2);
  for (const o of upstreamOpts) {
    assert.ok(o.signal && typeof o.signal.aborted === 'boolean', '時間切れの signal が無い');
    assert.strictEqual(o.signal.aborted, false);
  }
  const before = puts.length;
  respond = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  const res = await get('6301');
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.strictEqual(puts.length, before, '置かない');
  // 時間切れは拒否ではない: 次の選手は取りに行く
  respond = official;
  upstream = [];
  const next = await get('6302');
  assert.deepStrictEqual([next.status, upstream.length], [200, 2]);
  // Worker が公式を待つ時間 < アプリが Worker を待つ時間（逆だと、アプリが先に切って毎回失敗に見える）
  const src = fs.readFileSync(path.join(ROOT, 'cloudflare-worker', 'worker.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src', 'discovery', 'racer_profiles_loader.js'), 'utf8');
  const workerMs = Number((/const RACER_UPSTREAM_TIMEOUT_MS = (\d+);/.exec(src) || [])[1]);
  const appMs = Number((/var RACER_OFFICIAL_TIMEOUT_MS = (\d+);/.exec(app) || [])[1]);
  assert.ok(workerMs >= 15000, 'Worker が公式を待つ時間が短すぎる（本番の初回取得は 10.9 秒）: ' + workerMs);
  assert.ok(appMs >= workerMs + 3000, `アプリ ${appMs}ms は Worker ${workerMs}ms より十分長く待つこと`);
});

Date.now = realNow;
console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
