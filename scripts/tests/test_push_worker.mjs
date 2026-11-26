/**
 * Web Push: Worker の登録口と毎分の確認（2026-11-27）
 *   cloudflare-worker/push.js / worker.js（実際の worker モジュールに 1 リクエスト・1 回の cron ずつ通す）
 *
 *   - /push/key・subscribe・unsubscribe・test・status・selftest
 *   - 宛先は決まった push service だけ。件数・1 日の書込回数に上限（宛先の文書・送った記録のどちらも）
 *   - 締切の N 分前ちょうどの回に 1 回だけ送る。送り損ねは 2 分おきの回に拾い直す（先に記録してから送る = 1 回きり）
 *   - 送った記録は分の偶奇で 2 つ。KV の読み遅れがあっても重ねて送らない
 *   - 毎分の cron はデータ更新を走らせない。データ更新の cron は通知の確認を走らせない
 *
 *   node scripts/tests/test_push_worker.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeUa, decryptPush, verifyVapid, makeKV } from './_push_helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ─── 外向きの通信の代役 ──────────────────────────────────────
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
let pushCalls = []; // push service への送信
let upstreamCalls = []; // データ更新の取得
let pushStatus = 201; // push service の応答（数値か、url を受け取る関数）
let programsBody = { programs: [] };
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
globalThis.fetch = async (input, init) => {
  const u = String(input && input.url ? input.url : input);
  if (PUSH_HOST.test(u)) {
    pushCalls.push({ url: u, method: init && init.method, headers: (init && init.headers) || {}, body: init && init.body, redirect: init && init.redirect });
    const st = typeof pushStatus === 'function' ? pushStatus(u, pushCalls.length) : pushStatus;
    if (st === 'throw') throw new Error('network down');
    return new Response(null, { status: st });
  }
  upstreamCalls.push(u);
  const body = u.includes('results') ? { results: [] } : u.includes('programs') ? programsBody : { previews: [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const workerMod = await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'worker.js')).href);
const worker = workerMod.default;
const P = await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'push.js')).href);

let pass = 0,
  fail = 0;
async function t(name, fn) {
  P._resetPushStateForTest();
  pushCalls = [];
  upstreamCalls = [];
  pushStatus = 201;
  programsBody = { programs: [] };
  try {
    await fn();
    console.log('  PASS:', name);
    pass++;
  } catch (e) {
    console.log('  FAIL:', name, '\n    ', e && e.message);
    fail++;
  }
}
const section = (s) => console.log(s);
const ORIGIN = 'https://inotaka1979.github.io';
function mkEnv(kv) {
  return { BOATRACE_KV: kv || makeKV() };
}
function mkCtx() {
  const waits = [];
  return { waits, waitUntil(p) { waits.push(p); } };
}
async function call(env, method, p, body, headers, ctx) {
  const init = { method, headers: Object.assign({}, headers || {}) };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!init.headers['content-type']) init.headers['content-type'] = 'text/plain;charset=UTF-8';
  }
  const res = await worker.fetch(new Request('https://w.test' + p, init), env, ctx || mkCtx());
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, headers: res.headers };
}
const post = (env, p, body, headers, ctx) => call(env, 'POST', p, body, headers, ctx);
const get = (env, p, headers) => call(env, 'GET', p, undefined, headers);
const FAVS = [[4320, '峰 竜太'], [3897, '白井 英治']];
const subBody = (ua, over) => Object.assign({ sub: ua.sub, favs: FAVS, lead: 5 }, over || {});

// 2026-11-27 の時刻（日本時間）
const at = (hm, sec) => Date.parse('2026-11-27T' + hm + ':' + (sec ? String(sec).padStart(2, '0') : '00') + '+09:00');
// 常滑 6R 締切 12:45（3 号艇 白井・6 号艇 峰）、桐生 3R 締切 12:48（1 号艇 池田 3941）
const INDEX = { v: 1, r: [[8, 6, at('12:45') / 60000, [5001, 5002, 3897, 5004, 5005, 4320]], [1, 3, at('12:48') / 60000, [3941, 5012, 5013, 5014, 5015, 5016]]] };
const tick = (env, hm, sec) => worker.scheduled({ cron: P.PUSH_CRON, scheduledTime: at(hm, sec) }, env, mkCtx());
function readPush(callRec, ua) {
  return JSON.parse(decryptPush(callRec.body, ua).toString('utf8'));
}
async function register(env, ua, over) {
  const r = await post(env, '/push/subscribe', subBody(ua, over));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

section('[鍵と自己確認]');
await t('/push/key: 最初の呼出で鍵を作り、以後は同じ鍵を返す', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const a = await get(env, '/push/key');
  assert.strictEqual(a.status, 200);
  assert.ok(/^[A-Za-z0-9_-]{87}$/.test(a.json.key), '65 バイトの base64url');
  const b = await get(env, '/push/key');
  const c = await get(env, '/push/key');
  assert.strictEqual(b.json.key, a.json.key);
  assert.strictEqual(c.json.key, a.json.key);
  assert.strictEqual(kv.countPuts('push:vapid'), 1);
  assert.strictEqual(a.headers.get('cache-control'), 'no-store');
});
await t('/push/selftest: 実行環境の暗号が RFC 8291 の例と一致する', async () => {
  const r = await get(mkEnv(), '/push/selftest');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { ok: true, error: null });
});
await t('KV が無ければ 500（落ちない）。知らない経路は 404', async () => {
  assert.strictEqual((await get({}, '/push/key')).status, 500);
  assert.strictEqual((await get(mkEnv(), '/push/nothing')).status, 404);
  assert.strictEqual((await post(mkEnv(), '/push/nothing', {})).status, 400, '宛先の無い POST');
  assert.strictEqual((await call(mkEnv(), 'PUT', '/push/subscribe', {})).status, 405);
});

section('[登録]');
await t('宛先・お気に入り・何分前かを預かる', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  const r = await post(env, '/push/subscribe', subBody(ua));
  assert.strictEqual(r.status, 200);
  assert.ok(/^[0-9a-f]{32}$/.test(r.json.id));
  assert.deepStrictEqual([r.json.ok, r.json.favs, r.json.lead], [true, 2, 5]);
  const doc = kv.json('push:subs');
  assert.deepStrictEqual(Object.keys(doc).sort(), ['subs', 'v', 'w'], '保存するのは宛先と書込回数だけ');
  assert.strictEqual(doc.subs.length, 1);
  const rec = doc.subs[0];
  assert.deepStrictEqual([rec.id, rec.e, rec.p, rec.a, rec.l], [r.json.id, ua.sub.endpoint, ua.sub.keys.p256dh, ua.sub.keys.auth, 5]);
  assert.deepStrictEqual(rec.f, [[3897, '白井 英治'], [4320, '峰 竜太']], '登録番号順');
});
await t('同じ内容をもう一度送っても書かない。変えた時だけ書き、宛先は増えない', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  await register(env, ua);
  const again = await post(env, '/push/subscribe', subBody(ua, { favs: [[3897, '白井 英治'], [4320, '峰 竜太']] }));
  assert.strictEqual(again.json.unchanged, true);
  assert.strictEqual(kv.countPuts('push:subs'), 1);
  const changed = await post(env, '/push/subscribe', subBody(ua, { lead: 10 }));
  assert.strictEqual(changed.json.unchanged, undefined);
  assert.strictEqual(kv.countPuts('push:subs'), 2);
  const fewer = await post(env, '/push/subscribe', subBody(ua, { lead: 10, favs: [[4320, '峰 竜太']] }));
  assert.strictEqual(fewer.json.favs, 1);
  const doc = kv.json('push:subs');
  assert.strictEqual(doc.subs.length, 1);
  assert.deepStrictEqual([doc.subs[0].l, doc.subs[0].f.length], [10, 1]);
});
await t('お気に入りの形: {id, name} でも [id, name] でも。重複は 1 つに、名前は 1 行・24 文字まで', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  const favs = [{ id: '4320', name: '峰  竜太\n改行' }, [4320, '重複'], ['3897', 'あ'.repeat(40)], { id: 5000 }, 4444];
  const r = await post(env, '/push/subscribe', subBody(ua, { favs, lead: '10' }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const rec = kv.json('push:subs').subs[0];
  assert.deepStrictEqual(rec.f, [[3897, 'あ'.repeat(24)], [4320, '峰 竜太 改行'], [4444, ''], [5000, '']]);
  assert.strictEqual(rec.l, 10);
  // お気に入りが空でも預かる（テスト通知に使える）
  assert.strictEqual((await post(env, '/push/subscribe', subBody(makeUa(), { favs: [] }))).status, 200);
});
await t('宛先は決まった push service だけ', async () => {
  const env = mkEnv();
  const ok = ['https://fcm.googleapis.com/fcm/send/abc123def456', 'https://web.push.apple.com/QGuBnQ8Z0a1b2c3d4e5f', 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB', 'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD'];
  for (const e of ok) {
    const r = await post(env, '/push/subscribe', subBody(makeUa(e)));
    assert.strictEqual(r.status, 200, e + ' → ' + JSON.stringify(r.json));
  }
  const ng = ['https://evil.example/fcm/send/abc123def456', 'http://fcm.googleapis.com/fcm/send/abc123def456', 'https://fcm.googleapis.com.evil.org/fcm/send/abc123', 'https://evilpush.apple.com/aaaaaaaaaaaaaaaa',
    'https://push.apple.com.evil.org/aaaaaaaaaaaaaaaa', 'https://user:pw@fcm.googleapis.com/fcm/send/abc123', 'https://fcm.googleapis.com:8443/fcm/send/abc123', 'https://127.0.0.1/fcm/send/abc123def456',
    'https://fcm.googleapis.com/' + 'a'.repeat(1100), 'javascript:alert(1)//fcm.googleapis.com/aaaaaaaa', '', null, 12345];
  for (const e of ng) {
    const ua = makeUa();
    const r = await post(env, '/push/subscribe', { sub: { endpoint: e, keys: ua.sub.keys }, favs: FAVS, lead: 5 });
    assert.strictEqual(r.status, 400, String(e).slice(0, 50));
    assert.strictEqual(r.json.error, 'bad_endpoint', String(e).slice(0, 50));
  }
  assert.strictEqual(pushCalls.length, 0, '登録では何も送らない');
});
await t('おかしな内容は 400（鍵の長さ・何分前か・お気に入り・JSON でない・大きすぎる）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  const k = ua.sub.keys;
  const cases = [
    [{ sub: { endpoint: ua.sub.endpoint, keys: { p256dh: k.p256dh.slice(0, 80), auth: k.auth } }, favs: FAVS, lead: 5 }, 'bad_key'],
    [{ sub: { endpoint: ua.sub.endpoint, keys: { p256dh: 'A' + k.p256dh.slice(1), auth: k.auth } }, favs: FAVS, lead: 5 }, 'bad_key'],
    [{ sub: { endpoint: ua.sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth.slice(0, 10) } }, favs: FAVS, lead: 5 }, 'bad_auth'],
    [{ sub: { endpoint: ua.sub.endpoint, keys: { p256dh: k.p256dh } }, favs: FAVS, lead: 5 }, 'bad_auth'],
    [{ sub: { endpoint: ua.sub.endpoint }, favs: FAVS, lead: 5 }, 'bad_subscription'],
    [{ favs: FAVS, lead: 5 }, 'bad_subscription'],
    [subBody(ua, { lead: 7 }), 'bad_lead'],
    [subBody(ua, { lead: -5 }), 'bad_lead'],
    [subBody(ua, { lead: '5分' }), 'bad_lead'],
    [subBody(ua, { lead: undefined }), 'bad_lead'],
    [subBody(ua, { favs: 'x' }), 'bad_favs'],
    [subBody(ua, { favs: Array.from({ length: 101 }, (_, i) => [1000 + i, '']) }), 'bad_favs'],
    [subBody(ua, { favs: [['abc', '']] }), 'bad_favs'],
    [subBody(ua, { favs: [[1234567, '']] }), 'bad_favs'],
    [subBody(ua, { favs: [{ id: { $gt: '' } }] }), 'bad_favs'],
    ['[1,2', 'bad_json'],
    ['null', 'bad_body'],
    ['"text"', 'bad_body'],
  ];
  for (const [body, want] of cases) {
    const r = await post(env, '/push/subscribe', body);
    assert.strictEqual(r.status, 400, want + ': ' + JSON.stringify(r.json));
    assert.strictEqual(r.json.error, want);
    P._resetPushStateForTest();
  }
  const big = await post(env, '/push/subscribe', subBody(ua, { pad: 'x'.repeat(17000) }));
  assert.strictEqual(big.status, 413);
  assert.strictEqual(kv._puts.length, 0, '何も書かない');
  // ちょうど 100 人は受け付ける
  const full = await post(env, '/push/subscribe', subBody(ua, { favs: Array.from({ length: 100 }, (_, i) => [1000 + i, '選手']) }));
  assert.strictEqual(full.json.favs, 100);
});
await t('宛先は 30 件まで。満員でも登録済みの宛先は変更できる', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const uas = [];
  for (let i = 0; i < P.PUSH_MAX_SUBS; i++) {
    const ua = makeUa();
    uas.push(ua);
    P._resetPushStateForTest();
    assert.strictEqual((await post(env, '/push/subscribe', subBody(ua))).status, 200, 'i=' + i);
  }
  P._resetPushStateForTest();
  const over = await post(env, '/push/subscribe', subBody(makeUa()));
  assert.strictEqual(over.status, 507);
  assert.strictEqual(over.json.error, 'full');
  assert.strictEqual((await post(env, '/push/subscribe', subBody(uas[0], { lead: 15 }))).status, 200);
  assert.strictEqual(kv.json('push:subs').subs.length, P.PUSH_MAX_SUBS);
});
await t('登録・変更・解除で KV に書けるのは 1 日 60 回まで。戻るのは KV の枠と同じ区切り（UTC の 0 時 = 日本時間の 9 時）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  const realNow = Date.now;
  let now = at('10:00');
  Date.now = () => now;
  try {
    assert.strictEqual(P.PUSH_SUBS_WRITES_PER_DAY, 60);
    for (let i = 0; i < P.PUSH_SUBS_WRITES_PER_DAY; i++) {
      P._resetPushStateForTest();
      const r = await post(env, '/push/subscribe', subBody(ua, { lead: [3, 5][i % 2] }));
      assert.strictEqual(r.status, 200, 'i=' + i);
    }
    P._resetPushStateForTest();
    const r = await post(env, '/push/subscribe', subBody(ua, { lead: 15 }));
    assert.strictEqual(r.status, 429);
    assert.strictEqual(kv.countPuts('push:subs'), P.PUSH_SUBS_WRITES_PER_DAY);
    assert.strictEqual((await post(env, '/push/unsubscribe', { endpoint: ua.sub.endpoint })).status, 429, '解除も書込');
    // 中身が同じ登録は書かないので、上限でも通る
    assert.strictEqual((await post(env, '/push/subscribe', subBody(ua, { lead: [3, 5][(P.PUSH_SUBS_WRITES_PER_DAY - 1) % 2] }))).json.unchanged, true);
    // 日本時間の日付が変わっても、KV の枠はまだ戻っていない（8:59 までは同じ 1 日）
    for (const ms of [at('23:59'), at('00:30') + 86400000, at('08:59') + 86400000]) {
      now = ms;
      P._resetPushStateForTest();
      assert.strictEqual((await post(env, '/push/subscribe', subBody(ua, { lead: 15 }))).status, 429, new Date(ms).toISOString());
    }
    assert.strictEqual(kv.countPuts('push:subs'), P.PUSH_SUBS_WRITES_PER_DAY);
    now = at('09:00') + 86400000;
    P._resetPushStateForTest();
    assert.strictEqual((await post(env, '/push/subscribe', subBody(ua, { lead: 15 }))).status, 200, '枠が戻った');
    assert.deepStrictEqual(kv.json('push:subs').w, { d: '20261128', n: 1 });
  } finally {
    Date.now = realNow;
  }
});
await t('ブラウザからは許可した origin だけ。Origin の無い呼出（curl・確認用）は通す', async () => {
  const env = mkEnv();
  const bad = await post(env, '/push/subscribe', subBody(makeUa()), { origin: 'https://evil.example' });
  assert.strictEqual(bad.status, 403);
  assert.strictEqual(bad.headers.get('access-control-allow-origin'), null);
  const ok = await post(env, '/push/subscribe', subBody(makeUa()), { origin: ORIGIN });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), ORIGIN, 'アプリが応答を読める');
  assert.strictEqual((await post(env, '/push/subscribe', subBody(makeUa()))).status, 200);
  const key = await get(env, '/push/key', { origin: ORIGIN });
  assert.strictEqual(key.headers.get('access-control-allow-origin'), ORIGIN);
  const pre = await call(env, 'OPTIONS', '/push/subscribe', undefined, { origin: ORIGIN });
  assert.strictEqual(pre.status, 204);
  assert.ok(/POST/.test(pre.headers.get('access-control-allow-methods')));
});
await t('1 分に 30 回を超える POST は 429', async () => {
  const env = mkEnv();
  const ua = makeUa();
  let limited = 0;
  for (let i = 0; i < P.PUSH_HTTP_MAX_PER_MIN + 3; i++) {
    const r = await post(env, '/push/subscribe', subBody(ua));
    if (r.status === 429) limited++;
  }
  assert.strictEqual(limited, 3);
  assert.strictEqual((await get(env, '/push/key')).status, 200, 'GET は数えない');
});

section('[解除]');
await t('解除すると宛先が消える。登録の無い宛先の解除は書かない', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const a = makeUa();
  const b = makeUa();
  await register(env, a);
  await register(env, b);
  const r = await post(env, '/push/unsubscribe', { endpoint: a.sub.endpoint });
  assert.deepStrictEqual(r.json, { ok: true });
  assert.deepStrictEqual(kv.json('push:subs').subs.map((s) => s.e), [b.sub.endpoint]);
  const puts = kv.countPuts('push:subs');
  const again = await post(env, '/push/unsubscribe', { endpoint: a.sub.endpoint });
  assert.deepStrictEqual(again.json, { ok: true, unchanged: true });
  assert.strictEqual(kv.countPuts('push:subs'), puts);
  assert.strictEqual((await post(env, '/push/unsubscribe', { endpoint: 'https://evil.example/x'.padEnd(30, 'x') })).status, 400);
  assert.strictEqual((await post(env, '/push/unsubscribe', {})).status, 400);
});

section('[テスト通知]');
await t('登録済みの宛先に 1 通送る（暗号化した本文・送信元の証明・ヘッダ）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa('https://web.push.apple.com/QGuBnQ8Z0a1b2c3d4e5f');
  const key = (await get(env, '/push/key')).json.key;
  await register(env, ua);
  const ctx = mkCtx();
  const r = await post(env, '/push/test', { endpoint: ua.sub.endpoint }, {}, ctx);
  assert.deepStrictEqual(r.json, { ok: true, status: 201, delay: 0 });
  assert.strictEqual(pushCalls.length, 1);
  const c = pushCalls[0];
  assert.strictEqual(c.url, ua.sub.endpoint);
  assert.strictEqual(c.method, 'POST');
  assert.deepStrictEqual(readPush(c, ua), { t: 'テスト通知', b: 'この通知が届けば設定は完了です。', g: 'boatrace-test', d: {} });
  assert.strictEqual(c.headers['content-encoding'], 'aes128gcm');
  assert.strictEqual(c.headers['content-type'], 'application/octet-stream');
  assert.strictEqual(c.headers.ttl, '120');
  assert.strictEqual(c.headers.urgency, 'high');
  assert.strictEqual(c.headers.topic, 'test');
  const v = verifyVapid(c.headers.authorization, { aud: 'https://web.push.apple.com' });
  assert.ok(v.ok, v.why);
  assert.strictEqual(v.k, key, '/push/key と同じ鍵で署名している');
  assert.strictEqual(ctx.waits.length, 1, '送信は waitUntil に載せる（アプリを閉じても最後まで送る）');
});
await t('登録の無い宛先には送らない。続けて押しても 15 秒は送らない', async () => {
  const env = mkEnv();
  const ua = makeUa();
  const none = await post(env, '/push/test', { endpoint: ua.sub.endpoint });
  assert.strictEqual(none.status, 404);
  assert.strictEqual(none.json.error, 'not_registered');
  await get(env, '/push/key');
  await register(env, ua);
  assert.strictEqual((await post(env, '/push/test', { endpoint: ua.sub.endpoint })).status, 200);
  const soon = await post(env, '/push/test', { endpoint: ua.sub.endpoint });
  assert.strictEqual(soon.status, 429);
  assert.strictEqual(pushCalls.length, 1);
});
await t('別の宛先が登録されていても、登録の無い宛先には送らない（送るのは、その宛先自身の登録だけ）', async () => {
  const env = mkEnv();
  const mine = makeUa();
  const stranger = makeUa();
  await get(env, '/push/key');
  await register(env, mine);
  const r = await post(env, '/push/test', { endpoint: stranger.sub.endpoint });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(pushCalls.length, 0);
  P._resetPushStateForTest();
  await post(env, '/push/test', { endpoint: mine.sub.endpoint });
  assert.deepStrictEqual(pushCalls.map((c) => c.url), [mine.sub.endpoint]);
});
await t('push service が断ったら、その応答を返す。宛先が無くなっていたら登録を消す', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  await get(env, '/push/key');
  await register(env, ua);
  pushStatus = 403;
  assert.deepStrictEqual((await post(env, '/push/test', { endpoint: ua.sub.endpoint })).json, { ok: false, status: 403, delay: 0 });
  assert.strictEqual(kv.json('push:subs').subs.length, 1, '403 では消さない');
  P._resetPushStateForTest();
  pushStatus = 'throw';
  assert.deepStrictEqual((await post(env, '/push/test', { endpoint: ua.sub.endpoint })).json, { ok: false, status: 0, delay: 0 });
  P._resetPushStateForTest();
  pushStatus = 410;
  assert.strictEqual((await post(env, '/push/test', { endpoint: ua.sub.endpoint })).json.status, 410);
  assert.strictEqual(kv.json('push:subs').subs.length, 0);
});
await t('待ってから送れる（アプリを閉じて確かめる用）。待ち時間は 20 秒まで', async () => {
  const env = mkEnv();
  const ua = makeUa();
  await get(env, '/push/key');
  await register(env, ua);
  const realSetTimeout = globalThis.setTimeout;
  const waits = [];
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms >= 1000) {
      waits.push(ms);
      return realSetTimeout(fn, 0, ...rest);
    }
    return realSetTimeout(fn, ms, ...rest);
  };
  try {
    const a = await post(env, '/push/test', { endpoint: ua.sub.endpoint, delay: 10 });
    assert.strictEqual(a.json.delay, 10);
    P._resetPushStateForTest();
    const b = await post(env, '/push/test', { endpoint: ua.sub.endpoint, delay: 999 });
    assert.strictEqual(b.json.delay, 20);
    P._resetPushStateForTest();
    const c = await post(env, '/push/test', { endpoint: ua.sub.endpoint, delay: -3 });
    assert.strictEqual(c.json.delay, 0);
    P._resetPushStateForTest();
    const d = await post(env, '/push/test', { endpoint: ua.sub.endpoint, delay: 'abc' });
    assert.strictEqual(d.json.delay, 0);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.deepStrictEqual(waits, [10000, 20000]);
  assert.strictEqual(pushCalls.length, 4);
});

section('[索引: 番組表から締切と出場選手だけを抜き出す]');
const prog = (sid, rno, closed, tobans) => ({
  race_stadium_number: sid, race_number: rno, race_date: '2026-11-27', race_closed_at: closed, race_title: 'テスト杯',
  boats: tobans.map((tb, i) => ({ racer_boat_number: i + 1, racer_number: tb, racer_name: '選手' + tb })),
});
await t('締切の早い順。枠番の位置に登録番号。読めない行は入れない', () => {
  const idx = P.buildPushIndex({
    programs: [
      prog(8, 6, '2026-11-27 12:45:00', [5001, 5002, 3897, 5004, 5005, 4320]),
      prog(1, 3, '2026-11-27 10:02:00', [3941, 2, 3, 4, 5, 6]),
      prog(25, 1, '2026-11-27 10:00:00', [1, 2, 3, 4, 5, 6]),
      prog(2, 13, '2026-11-27 10:00:00', [1, 2, 3, 4, 5, 6]),
      prog(3, 1, '締切未定', [1, 2, 3, 4, 5, 6]),
      { race_stadium_number: 4, race_number: 1, race_closed_at: '2026-11-27 11:00:00', boats: [{ racer_boat_number: 6, racer_number: 4444 }, { racer_boat_number: 9, racer_number: 1 }, null, { racer_boat_number: 2 }] },
      null,
    ],
  });
  assert.deepStrictEqual(idx, {
    v: 1,
    r: [
      [1, 3, at('10:02') / 60000, [3941, 2, 3, 4, 5, 6]],
      [4, 1, at('11:00') / 60000, [0, 0, 0, 0, 0, 4444]],
      [8, 6, at('12:45') / 60000, [5001, 5002, 3897, 5004, 5005, 4320]],
    ],
  });
  for (const bad of [null, {}, { programs: 'x' }, []]) assert.deepStrictEqual(P.buildPushIndex(bad), { v: 1, r: [] });
  assert.strictEqual(P.parseJstMs('2026-11-27 12:45:00'), at('12:45'));
  assert.strictEqual(P.parseJstMs('2026-11-27T12:45'), at('12:45'));
  assert.strictEqual(P.parseJstMs('12:45'), null);
});
await t('本物の番組表（data/programs/today.json）から作れて、十分に小さい', () => {
  const programs = JSON.parse(read('data/programs/today.json'));
  const idx = P.buildPushIndex(programs);
  assert.strictEqual(idx.r.length, programs.programs.length);
  assert.ok(idx.r.every((r) => r[3].length === 6 && r[3].every((n) => Number.isInteger(n))));
  const size = JSON.stringify(idx).length;
  assert.ok(size < 16000, '索引 ' + size + ' 文字（番組表は ' + read('data/programs/today.json').length + ' 文字）');
});
await t('データ更新の cron が索引を書く。番組表が同じなら書き直さない。空なら書かない', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  programsBody = { programs: [] };
  await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at('12:00') }, env, mkCtx());
  assert.strictEqual(kv.countPuts('push:index'), 0, '空の番組表');
  programsBody = { programs: [prog(8, 6, '2026-11-27 12:45:00', [5001, 5002, 3897, 5004, 5005, 4320])] };
  await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at('12:05') }, env, mkCtx());
  assert.strictEqual(kv.countPuts('push:index'), 1);
  assert.deepStrictEqual(kv.json('push:index').r, [[8, 6, at('12:45') / 60000, [5001, 5002, 3897, 5004, 5005, 4320]]]);
  await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at('12:10') }, env, mkCtx());
  assert.strictEqual(kv.countPuts('push:index'), 1, '同じなら書かない');
  programsBody = { programs: [prog(8, 6, '2026-11-27 12:50:00', [5001, 5002, 3897, 5004, 5005, 4320])] };
  await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at('12:15') }, env, mkCtx());
  assert.strictEqual(kv.countPuts('push:index'), 2, '締切が変わったら書く');
  programsBody = { programs: [] };
  await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at('12:20') }, env, mkCtx());
  assert.strictEqual(kv.json('push:index').r.length, 1, '空の番組表で消さない');
});
await t('索引を書けなくても、データ更新は最後まで進む', async () => {
  const kv = makeKV({ failPut: (k) => k === 'push:index' });
  const env = mkEnv(kv);
  programsBody = { programs: [prog(8, 6, '2026-11-27 12:45:00', [1, 2, 3, 4, 5, 6])] };
  await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at('12:05') }, env, mkCtx());
  assert.ok(kv.countPuts('programs:today') >= 1);
  assert.ok(kv.countPuts('health:heartbeat') >= 1);
});

section('[毎分の確認: いつ・誰に・何を送るか]');
// アプリの流れと同じ: 鍵を取る → 登録する
async function setup(over) {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  assert.strictEqual((await get(env, '/push/key')).status, 200);
  await register(env, ua, over);
  kv.setJson('push:index', INDEX);
  return { kv, env, ua };
}
await t('締切の N 分前ちょうどの回に 1 通。その前後の回は送らない', async () => {
  const { env, ua, kv } = await setup();
  await tick(env, '12:38');
  await tick(env, '12:39');
  assert.strictEqual(pushCalls.length, 0);
  await tick(env, '12:40', 7); // cron は数秒遅れて動く
  assert.strictEqual(pushCalls.length, 1);
  const c = pushCalls[0];
  assert.deepStrictEqual(readPush(c, ua), {
    t: 'まもなく締切 常滑 6R（あと 5 分）',
    b: '3号艇 白井 英治、6号艇 峰 竜太　締切 12:45',
    g: 'boatrace-fav-8-6',
    d: { sid: 8, rno: 6 },
  });
  assert.strictEqual(c.headers.topic, 'r8-6');
  assert.strictEqual(c.headers.ttl, '293', '締切までの秒数（過ぎたら届けない）');
  assert.strictEqual(c.headers.urgency, 'high');
  assert.ok(verifyVapid(c.headers.authorization, { aud: 'https://fcm.googleapis.com', nowSec: at('12:40') / 1000 }).ok);
  for (const hm of ['12:41', '12:42', '12:43', '12:44', '12:45', '12:46']) await tick(env, hm);
  assert.strictEqual(pushCalls.length, 1, '1 レース 1 通');
  // 記録は、送った回の分の偶奇の文書に（12:40 は偶数分）
  assert.deepStrictEqual(kv.json('push:sent:0'), { d: '20261127', k: [kv.json('push:subs').subs[0].id + ':8_6'], n: 1 });
  assert.strictEqual(kv.json('push:sent:1'), null);
  assert.strictEqual(c.redirect, 'manual', '転送は追わない');
});
await t('同じ回が 2 度動いても重ねて送らない（別の isolate でも、KV の記録で分かる）', async () => {
  const { env } = await setup();
  await tick(env, '12:40');
  await tick(env, '12:40', 30);
  assert.strictEqual(pushCalls.length, 1);
  P._resetPushStateForTest(); // 別の isolate（isolate の中の控えが無い）
  await tick(env, '12:40', 45);
  await tick(env, '12:42');
  assert.strictEqual(pushCalls.length, 1);
});
await t('何分前かは宛先ごと。「通知しない」(0) の宛先には送らない', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const u3 = makeUa();
  const u10 = makeUa();
  const u0 = makeUa();
  await get(env, '/push/key');
  await register(env, u3, { lead: 3 });
  await register(env, u10, { lead: 10 });
  await register(env, u0, { lead: 0 });
  kv.setJson('push:index', INDEX);
  const seen = [];
  for (const hm of ['12:34', '12:35', '12:36', '12:37', '12:38', '12:39', '12:40', '12:41', '12:42', '12:43', '12:44']) {
    const before = pushCalls.length;
    await tick(env, hm);
    for (const c of pushCalls.slice(before)) seen.push([hm, c.url === u3.sub.endpoint ? 'u3' : c.url === u10.sub.endpoint ? 'u10' : 'u0', readPush(c, c.url === u3.sub.endpoint ? u3 : u10).t]);
  }
  assert.deepStrictEqual(seen, [
    ['12:35', 'u10', 'まもなく締切 常滑 6R（あと 10 分）'],
    ['12:42', 'u3', 'まもなく締切 常滑 6R（あと 3 分）'],
  ]);
});
await t('お気に入りの出ないレース・締切を過ぎたレースは送らない。別のレースは別の通知', async () => {
  const { env, ua } = await setup({ favs: [[3941, '池田 浩二'], [9999, 'いない']] });
  for (const hm of ['12:40', '12:42', '12:43', '12:44']) await tick(env, hm);
  assert.strictEqual(pushCalls.length, 1);
  assert.deepStrictEqual(readPush(pushCalls[0], ua), { t: 'まもなく締切 桐生 3R（あと 5 分）', b: '1号艇 池田 浩二　締切 12:48', g: 'boatrace-fav-1-3', d: { sid: 1, rno: 3 } });
  for (const hm of ['12:48', '12:49', '13:30']) await tick(env, hm);
  assert.strictEqual(pushCalls.length, 1);
});
await t('送り損ね（その回の cron が動かなかった）は 2 分後に拾い直す。締切を過ぎたら送らない', async () => {
  const { env, ua } = await setup();
  await tick(env, '12:41'); // 12:40 の回が欠けた。直後の回は待つ（記録の反映待ち）
  assert.strictEqual(pushCalls.length, 0);
  await tick(env, '12:42');
  assert.strictEqual(pushCalls.length, 1);
  assert.strictEqual(readPush(pushCalls[0], ua).t, 'まもなく締切 常滑 6R（あと 3 分）');
  assert.strictEqual(pushCalls[0].headers.ttl, '180');
  P._resetPushStateForTest(); // 以後は別の isolate（KV の記録だけで分かること）
  await tick(env, '12:43');
  await tick(env, '12:44');
  assert.strictEqual(pushCalls.length, 1);
  // ずっと欠けていて、締切の時刻になった → 送らない
  const late = await setup();
  await tick(late.env, '12:45');
  await tick(late.env, '12:46');
  assert.strictEqual(pushCalls.length, 1);
});
await t('締切の直前に登録した・分数を変えた場合も、次の回に知らせる', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  kv.setJson('push:index', INDEX);
  await tick(env, '12:40');
  await tick(env, '12:41');
  await tick(env, '12:42');
  assert.strictEqual(pushCalls.length, 0, 'まだ宛先が無い');
  const ua = makeUa();
  await get(env, '/push/key');
  await register(env, ua); // 12:42 台に登録
  await tick(env, '12:43'); // 試す回は 2 分おき（12:40・12:42・12:44）
  assert.strictEqual(pushCalls.length, 0);
  await tick(env, '12:44');
  assert.strictEqual(pushCalls.length, 1);
  assert.strictEqual(readPush(pushCalls[0], ua).t, 'まもなく締切 常滑 6R（あと 1 分）');
  // 分数を変えた場合（15 分前に変更 → ちょうどの回は過ぎているが、次の試す回に知らせる）
  pushCalls = [];
  const b = makeKV();
  const envB = mkEnv(b);
  b.setJson('push:index', INDEX);
  const ub = makeUa();
  await get(envB, '/push/key');
  await register(envB, ub, { lead: 3 });
  await tick(envB, '12:36');
  assert.strictEqual(pushCalls.length, 0, '3 分前の設定ではまだ');
  await register(envB, ub, { lead: 15 }); // 12:36 台に変更（15 分前 = 12:30 は過ぎた）
  await tick(envB, '12:37');
  assert.strictEqual(pushCalls.length, 0);
  await tick(envB, '12:38');
  assert.strictEqual(pushCalls.length, 1);
  assert.strictEqual(readPush(pushCalls[0], ub).t, 'まもなく締切 常滑 6R（あと 7 分）');
});
await t('一時的な失敗（5xx・通信できない・転送・429・408）は覚えず、2 分後の回に 1 回だけ拾い直す。断られた送信（403）はやり直さない', async () => {
  for (const st of [503, 'throw', 302, 429, 408]) {
    pushCalls = [];
    P._resetPushStateForTest();
    const a = await setup({ lead: 15 }); // 12:30 がちょうどの回。試す回は 2 分おきに 12:44 まで
    pushStatus = st;
    await tick(a.env, '12:30');
    assert.strictEqual(pushCalls.length, 1, String(st));
    assert.deepStrictEqual([a.kv.json('push:sent:0'), a.kv.json('push:sent:1')], [null, null], st + ' は覚えない');
    pushStatus = 201;
    await tick(a.env, '12:31');
    assert.strictEqual(pushCalls.length, 1, '試す回ではない');
    await tick(a.env, '12:32');
    assert.strictEqual(pushCalls.length, 2, st + ' は拾い直す');
    assert.strictEqual(readPush(pushCalls[1], a.ua).t, 'まもなく締切 常滑 6R（あと 13 分）');
    P._resetPushStateForTest();
    for (const hm of ['12:33', '12:34', '12:36', '12:40', '12:44']) await tick(a.env, hm);
    assert.strictEqual(pushCalls.length, 2, '届いたらもう送らない');
  }
  // 拾い直しも失敗したら、そこで終わり（送る前に記録しているので、別の isolate でも送り直さない）
  pushCalls = [];
  P._resetPushStateForTest();
  const again = await setup({ lead: 15 });
  pushStatus = 503;
  await tick(again.env, '12:30');
  await tick(again.env, '12:32');
  assert.strictEqual(pushCalls.length, 2);
  assert.strictEqual(again.kv.json('push:sent:0').k.length, 1, '拾い直しは記録済み');
  pushStatus = 201;
  for (const hm of ['12:34', '12:36']) await tick(again.env, hm);
  P._resetPushStateForTest();
  for (const hm of ['12:38', '12:40', '12:42', '12:44']) await tick(again.env, hm);
  assert.strictEqual(pushCalls.length, 2, '拾い直しは 1 回きり');
  // 断られた送信
  pushCalls = [];
  P._resetPushStateForTest();
  const b = await setup();
  pushStatus = 403;
  await tick(b.env, '12:40');
  pushStatus = 201;
  for (const hm of ['12:42', '12:43', '12:44']) await tick(b.env, hm);
  assert.strictEqual(pushCalls.length, 1, '403 はやり直さない');
  assert.strictEqual(b.kv.json('push:subs').subs.length, 1, '登録は残す');
});
await t('ちょうどの回は「送ってから記録」、拾い直しは「記録してから送る」', async () => {
  const order = [];
  const watch = (kv) => {
    const realPut = kv.put.bind(kv);
    kv.put = async (k, v, o) => {
      if (k.startsWith('push:sent')) order.push('record');
      return realPut(k, v, o);
    };
  };
  pushStatus = () => {
    order.push('send');
    return 201;
  };
  const a = await setup();
  watch(a.kv);
  await tick(a.env, '12:40'); // ちょうどの回
  assert.deepStrictEqual(order, ['send', 'record']);
  order.length = 0;
  P._resetPushStateForTest();
  const b = await setup();
  watch(b.kv);
  await tick(b.env, '12:42'); // ちょうどの回が欠けた後の拾い直し
  assert.deepStrictEqual(order, ['record', 'send']);
  assert.strictEqual(b.kv.json('push:sent:0').n, 1, '書くのは 1 回');
});
await t('拾い直しを送った isolate は、KV の記録が読めなくても送り直さない（isolate の中の控え）', async () => {
  const { env, kv } = await setup({ lead: 15 });
  await tick(env, '12:32'); // 12:30 が欠けた後の拾い直し
  assert.strictEqual(pushCalls.length, 1);
  const realGet = kv.get.bind(kv);
  kv.get = async (k) => (k.startsWith('push:sent') ? null : realGet(k)); // 記録が読めない
  for (const hm of ['12:34', '12:36', '12:38']) await tick(env, hm);
  assert.strictEqual(pushCalls.length, 1);
});
await t('記録を書けない間は、拾い直しを送らない（別の isolate が 2 分おきに送り直さない）。ちょうどの回は送る', async () => {
  const kv = makeKV({ failPut: (k) => k.startsWith('push:sent') }); // 1 日の書込枠を使い切った日
  const env = mkEnv(kv);
  const ua = makeUa();
  await get(env, '/push/key');
  await register(env, ua, { lead: 15 });
  kv.setJson('push:index', INDEX);
  const r0 = await P.pushTick(env, at('12:30'));
  assert.deepStrictEqual([r0.sent, r0.sent_record_failed], [1, true], 'ちょうどの回は、記録できなくても届ける');
  for (const hm of ['12:32', '12:34', '12:36', '12:38', '12:40', '12:42', '12:44']) {
    P._resetPushStateForTest(); // 毎回 別の isolate
    const r = await P.pushTick(env, at(hm));
    assert.deepStrictEqual([r.sent, r.due, r.sent_record_failed], [0, 1, true], hm);
  }
  assert.strictEqual(pushCalls.length, 1, '重ねて送らない');
  // ちょうどの回と拾い直しが同じ回に重なった時: 記録を書けなくても、ちょうどの回の分は送る
  pushCalls = [];
  P._resetPushStateForTest();
  const kv2 = makeKV({ failPut: (k) => k.startsWith('push:sent') });
  const env2 = mkEnv(kv2);
  const exact = makeUa();
  const missed = makeUa();
  await get(env2, '/push/key');
  await register(env2, exact, { lead: 3 }); // 12:42 がちょうどの回
  await register(env2, missed, { lead: 5 }); // 12:40 が欠けた → 12:42 は拾い直し
  kv2.setJson('push:index', INDEX);
  const r2 = await P.pushTick(env2, at('12:42'));
  assert.deepStrictEqual([r2.due, r2.sent], [2, 1]);
  assert.deepStrictEqual(pushCalls.map((c) => c.url), [exact.sub.endpoint]);
});
await t('ちょうどの回と拾い直しが同じ回に重なったら、記録は 2 回（拾い直しの分を先に、ちょうどの回の分を後に）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const exact = makeUa();
  const missed = makeUa();
  await get(env, '/push/key');
  await register(env, exact, { lead: 3 });
  await register(env, missed, { lead: 5 });
  kv.setJson('push:index', INDEX);
  const r = await P.pushTick(env, at('12:42'));
  assert.deepStrictEqual([r.due, r.sent], [2, 2]);
  assert.strictEqual(kv.countPuts('push:sent:0'), 2);
  assert.deepStrictEqual([kv.json('push:sent:0').n, kv.json('push:sent:0').k.length], [2, 2]);
  // 上限の 1 つ手前なら、後の記録は書かない（上限を超えない）。次の回からは「ちょうどの回だけ」
  P._resetPushStateForTest();
  pushCalls = [];
  const kv2 = makeKV();
  const env2 = mkEnv(kv2);
  await get(env2, '/push/key');
  await register(env2, exact, { lead: 3 });
  await register(env2, missed, { lead: 5 });
  kv2.setJson('push:index', INDEX);
  kv2.setJson('push:sent:0', { d: '20261127', k: [], n: P.PUSH_SENT_WRITES_PER_DAY / 2 - 1 });
  const r2 = await P.pushTick(env2, at('12:42'));
  assert.deepStrictEqual([r2.due, r2.sent], [2, 2]);
  assert.strictEqual(kv2.json('push:sent:0').n, P.PUSH_SENT_WRITES_PER_DAY / 2);
  assert.strictEqual(kv2.countPuts('push:sent:0'), 1);
});
await t('宛先が無くなっていたら（404 / 410）登録を消す。その間に増えた登録は消さない', async () => {
  for (const st of [404, 410]) {
    const kv = makeKV();
    const env = mkEnv(kv);
    const dead = makeUa();
    const alive = makeUa();
    await get(env, '/push/key');
    await register(env, dead);
    await register(env, alive, { favs: [[9999, '']] });
    kv.setJson('push:index', INDEX);
    const late = makeUa();
    pushStatus = (u) => {
      // 送っている最中に、別の端末が登録した
      const doc = kv.json('push:subs');
      if (!doc.subs.some((s) => s.e === late.sub.endpoint)) {
        doc.subs.push({ id: 'late', e: late.sub.endpoint, p: late.sub.keys.p256dh, a: late.sub.keys.auth, f: [], l: 5, t: 0 });
        kv.setJson('push:subs', doc);
      }
      return u === dead.sub.endpoint ? st : 201;
    };
    const docBefore = kv.json('push:subs');
    docBefore.w = { d: '20261127', n: 5 }; // 今日すでに 5 回書いている
    kv.setJson('push:subs', docBefore);
    await tick(env, '12:40');
    assert.deepStrictEqual(kv.json('push:subs').subs.map((s) => s.e).sort(), [alive.sub.endpoint, late.sub.endpoint].sort(), String(st));
    assert.deepStrictEqual(kv.json('push:subs').w, { d: '20261127', n: 6 }, '掃除の書込も 1 日の回数に数える');
    P._resetPushStateForTest();
    pushCalls = [];
    pushStatus = 201;
  }
});
await t('掃除しようとした宛先がもう無ければ（送信の間に解除された）、何も書かない', async () => {
  const { env, kv, ua } = await setup();
  pushStatus = () => {
    // 送っている最中に、その端末が解除した
    const doc = kv.json('push:subs');
    doc.subs = doc.subs.filter((s) => s.e !== ua.sub.endpoint);
    kv.setJson('push:subs', doc);
    return 410;
  };
  const puts = kv.countPuts('push:subs');
  const r = await P.pushTick(env, at('12:40'));
  assert.deepStrictEqual([r.gone, r.gone_cleanup_skipped, r.gone_cleanup_failed], [1, undefined, undefined]);
  assert.strictEqual(kv.countPuts('push:subs'), puts, '書込回数を使わない');
});
await t('宛先の文書を今日はもう書けない（上限）なら、無くなった宛先の掃除は見送る。記録は付くので送り直さない', async () => {
  const { env, kv, ua } = await setup();
  const doc = kv.json('push:subs');
  doc.w = { d: '20261127', n: P.PUSH_SUBS_WRITES_PER_DAY };
  kv.setJson('push:subs', doc);
  const puts = kv.countPuts('push:subs');
  pushStatus = 410;
  const r = await P.pushTick(env, at('12:40'));
  assert.deepStrictEqual([r.sent, r.failed, r.gone, r.gone_cleanup_skipped], [0, 1, 1, true]);
  assert.strictEqual(kv.countPuts('push:subs'), puts, '書かない');
  assert.strictEqual(kv.json('push:subs').subs.length, 1);
  P._resetPushStateForTest();
  for (const hm of ['12:42', '12:44']) await tick(env, hm);
  assert.strictEqual(pushCalls.length, 1, '410 は覚えるので、同じレースで送り直さない');
  // 枠が戻った日（翌日）に 410 が返れば消す
  kv.setJson('push:index', { v: 1, r: [[8, 6, (at('12:45') + 86400000) / 60000, [0, 0, 3897, 0, 0, 4320]]] });
  P._resetPushStateForTest();
  const r2 = await P.pushTick(env, at('12:40') + 86400000);
  assert.deepStrictEqual([r2.gone, r2.gone_cleanup_skipped], [1, undefined]);
  assert.strictEqual(kv.json('push:subs').subs.length, 0);
  assert.deepStrictEqual(kv.json('push:subs').w, { d: '20261128', n: 1 });
  assert.ok(ua);
});
await t('1 回の確認で送るのは 6 通まで。残りは後の回に送る', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const uas = [];
  await get(env, '/push/key');
  for (let i = 0; i < 8; i++) {
    const ua = makeUa();
    uas.push(ua);
    P._resetPushStateForTest();
    await register(env, ua);
  }
  kv.setJson('push:index', INDEX);
  await tick(env, '12:40');
  assert.strictEqual(pushCalls.length, P.PUSH_MAX_SENDS_PER_TICK);
  await tick(env, '12:41');
  assert.strictEqual(pushCalls.length, 6);
  await tick(env, '12:42');
  assert.strictEqual(pushCalls.length, 8);
  assert.strictEqual(new Set(pushCalls.map((c) => c.url)).size, 8, '全員に 1 通ずつ');
  await tick(env, '12:43');
  assert.strictEqual(pushCalls.length, 8);
});
await t('KV に書くのは送った回だけ（毎分は書かない）。書くのはその回の分の偶奇の文書だけ。日付が変わったら作り直す', async () => {
  const { env, kv } = await setup({ favs: [[4320, '峰 竜太'], [3941, '池田 浩二']] });
  const id = kv.json('push:subs').subs[0].id;
  const before = kv._puts.length;
  for (const hm of ['12:30', '12:31', '12:32', '12:39']) await tick(env, hm);
  assert.deepStrictEqual(kv._puts.slice(before), ['push:tick'], '生存記録の 1 回だけ');
  await tick(env, '12:40');
  assert.deepStrictEqual(kv._puts.slice(before), ['push:tick', 'push:sent:0']);
  for (const hm of ['12:41', '12:42', '12:43', '12:44', '12:50']) await tick(env, hm);
  assert.deepStrictEqual(kv._puts.slice(before), ['push:tick', 'push:sent:0', 'push:sent:1'], '桐生 3R (12:43 = 奇数分) はもう一方の文書に');
  assert.deepStrictEqual(kv.json('push:sent:0'), { d: '20261127', k: [id + ':8_6'], n: 1 }, '12:43 の回は偶数分の文書に触らない');
  assert.deepStrictEqual([kv.json('push:sent:1').d, kv.json('push:sent:1').n], ['20261127', 1]);
  assert.ok(kv.json('push:sent:1').k.includes(id + ':1_3'));
  // 翌日: 前日の記録も書いた回数も引き継がない
  kv.setJson('push:index', { v: 1, r: [[8, 1, (at('12:45') + 86400000) / 60000, [4320, 0, 0, 0, 0, 0]]] });
  await worker.scheduled({ cron: P.PUSH_CRON, scheduledTime: at('12:40') + 86400000 }, env, mkCtx());
  assert.deepStrictEqual(kv.json('push:sent:0'), { d: '20261128', k: [id + ':8_1'], n: 1 });
});
await t('KV の読み遅れがあっても、前の回の記録を上書きで失わない（1 分違いで別のレースを送った場合）', async () => {
  // 12:40 に常滑 6R、12:43 に桐生 3R を送る。12:43 の回は別の isolate で、偶数分の文書を「12:40 より前の古い中身」で読む。
  //   記録が 1 つの文書だと、12:43 の回が古い中身に自分の分を足して書き戻し、12:40 の記録が消えて 12:44 に送り直す。
  const { env, kv } = await setup({ favs: [[4320, '峰 竜太'], [3941, '池田 浩二']], lead: 5 });
  await tick(env, '12:40');
  assert.strictEqual(pushCalls.length, 1);
  P._resetPushStateForTest();
  const realGet = kv.get.bind(kv);
  kv.get = async (k) => (k === 'push:sent:0' ? null : realGet(k)); // 読み遅れ
  await tick(env, '12:43');
  kv.get = realGet;
  assert.strictEqual(pushCalls.length, 2);
  assert.strictEqual(kv.json('push:sent:0').k.length, 1, '12:40 の記録は残っている');
  P._resetPushStateForTest();
  await tick(env, '12:44'); // 常滑 6R の次の試す回（12:40 から 4 分）
  await tick(env, '12:45'); // 桐生 3R の次の試す回（12:43 から 2 分）
  await tick(env, '12:47');
  assert.strictEqual(pushCalls.length, 2, '送り直さない');
});
await t('何分前かを奇数分だけ変えても、もう一方の文書の記録を見て送り直さない', async () => {
  const { env, kv, ua } = await setup({ lead: 10 });
  await tick(env, '12:35'); // 10 分前（奇数分の文書に記録）
  assert.strictEqual(pushCalls.length, 1);
  assert.strictEqual(kv.json('push:sent:1').k.length, 1);
  await register(env, ua, { lead: 5 }); // 5 分前に変更 → ちょうどの回は 12:40（偶数分）
  P._resetPushStateForTest();
  for (const hm of ['12:40', '12:42', '12:44']) await tick(env, hm);
  assert.strictEqual(pushCalls.length, 1);
});
await t('送った記録を書けるのは 1 日 100 回まで（文書ごとに 50 回）。超えたら、ちょうどの回だけ送って拾い直しはしない', async () => {
  assert.strictEqual(P.PUSH_SENT_WRITES_PER_DAY, 100);
  const half = P.PUSH_SENT_WRITES_PER_DAY / 2;
  // 上限の 1 つ手前: 書く
  const a = await setup();
  a.kv.setJson('push:sent:0', { d: '20261127', k: ['x:1_1'], n: half - 1 });
  const ra = await P.pushTick(a.env, at('12:40'));
  assert.deepStrictEqual([ra.sent, ra.sent_cap], [1, undefined]);
  assert.strictEqual(a.kv.json('push:sent:0').n, half);
  assert.strictEqual(a.kv.json('push:sent:0').k.length, 2, 'それまでの記録に足す');
  // 上限: ちょうどの回は送るが、書かない
  pushCalls = [];
  P._resetPushStateForTest();
  const b = await setup();
  b.kv.setJson('push:sent:0', { d: '20261127', k: [], n: half });
  const puts = b.kv._puts.length;
  const rb = await P.pushTick(b.env, at('12:40'));
  assert.deepStrictEqual([rb.sent, rb.sent_cap], [1, true]);
  assert.strictEqual(pushCalls.length, 1);
  assert.deepStrictEqual(b.kv._puts.slice(puts).filter((k) => k.startsWith('push:sent')), [], '書かない');
  // 別の isolate の次の試す回: 記録が無いので「送ったかどうか」が分からない → 送らない
  P._resetPushStateForTest();
  const rb2 = await P.pushTick(b.env, at('12:42'));
  assert.deepStrictEqual([rb2.sent, rb2.due, rb2.sent_cap], [0, 0, true]);
  await tick(b.env, '12:44');
  assert.strictEqual(pushCalls.length, 1);
  // 上限の日は、送り損ねの拾い直しもしない（ちょうどの回が欠けた場合）
  pushCalls = [];
  P._resetPushStateForTest();
  const c = await setup();
  c.kv.setJson('push:sent:0', { d: '20261127', k: [], n: half });
  await tick(c.env, '12:42');
  assert.strictEqual(pushCalls.length, 0);
  // もう一方の文書は別に数える。日付が変われば戻る
  P._resetPushStateForTest();
  const d = await setup({ favs: [[3941, '池田 浩二']] }); // 桐生 3R 12:48 → 5 分前は 12:43（奇数分）
  d.kv.setJson('push:sent:0', { d: '20261127', k: [], n: half });
  const rd = await P.pushTick(d.env, at('12:43'));
  assert.deepStrictEqual([rd.sent, rd.sent_cap], [1, undefined]);
  assert.strictEqual(d.kv.json('push:sent:1').n, 1);
  pushCalls = [];
  P._resetPushStateForTest();
  const e = await setup();
  e.kv.setJson('push:sent:0', { d: '20261126', k: ['old'], n: half });
  const re = await P.pushTick(e.env, at('12:40'));
  assert.deepStrictEqual([re.sent, re.sent_cap], [1, undefined]);
  assert.deepStrictEqual([e.kv.json('push:sent:0').d, e.kv.json('push:sent:0').n, e.kv.json('push:sent:0').k.length], ['20261127', 1, 1]);
});
await t('試す回は、ちょうどの回から 2 分おき（何分前の設定でも、締切の分には送らない）', () => {
  const closed = at('12:45');
  const slots = {};
  for (const lead of P.PUSH_LEADS) {
    slots[lead] = [];
    for (let m = 20; m >= -2; m--) {
      const due = P.duePushes([{ id: 'a', e: 'x', f: [[4320, '']], l: lead }], { v: 1, r: [[8, 6, closed / 60000, [4320, 0, 0, 0, 0, 0]]] }, closed - m * 60000, null);
      if (due.length) {
        slots[lead].push(m);
        assert.strictEqual(due[0].late, (lead - m) * 60000);
      }
    }
  }
  assert.deepStrictEqual(slots, { 0: [], 3: [3, 1], 5: [5, 3, 1], 10: [10, 8, 6, 4, 2], 15: [15, 13, 11, 9, 7, 5, 3, 1] });
  assert.strictEqual(P.PUSH_ATTEMPT_EVERY_MS, 120000, 'KV の読み遅れ（60 秒ほど）より長く空ける');
});
await t('送った記録を KV に書けなくても送信は行う（同じ isolate の中では重ねて送らない）', async () => {
  const kv = makeKV({ failPut: (k) => k.startsWith('push:sent') });
  const env = mkEnv(kv);
  const ua = makeUa();
  await get(env, '/push/key');
  await register(env, ua);
  kv.setJson('push:index', INDEX);
  const r = await P.pushTick(env, at('12:40'));
  assert.deepStrictEqual([r.sent, r.sent_record_failed], [1, true]);
  await tick(env, '12:42');
  assert.strictEqual(pushCalls.length, 1);
  // 書けるようになったら、この isolate が覚えている分も残す（別の isolate でも分かるように）
  P._resetPushStateForTest();
  const kv2 = makeKV();
  const env2 = mkEnv(kv2);
  let failing = true;
  const realPut = kv2.put.bind(kv2);
  kv2.put = async (k, v, o) => {
    if (failing && k.startsWith('push:sent')) throw new Error('KV put() limit exceeded for the day.');
    return realPut(k, v, o);
  };
  const u2 = makeUa();
  await get(env2, '/push/key');
  await register(env2, u2, { favs: [[4320, '峰 竜太'], [3941, '池田 浩二']], lead: 15 });
  kv2.setJson('push:index', INDEX);
  pushCalls = [];
  await tick(env2, '12:30'); // 常滑 6R の 15 分前。記録は書けない
  assert.strictEqual(pushCalls.length, 1);
  assert.strictEqual(kv2.json('push:sent:0'), null);
  failing = false;
  await tick(env2, '12:33'); // 桐生 3R の 15 分前（奇数分の文書）。書けるので、覚えている常滑 6R の分も入れる
  assert.strictEqual(pushCalls.length, 2);
  assert.strictEqual(kv2.json('push:sent:1').k.length, 2);
  P._resetPushStateForTest();
  for (const hm of ['12:34', '12:35', '12:36', '12:37']) await tick(env2, hm);
  assert.strictEqual(pushCalls.length, 2, '別の isolate でも送り直さない');
});
await t('宛先が無い・索引が無い・KV が無いときは何も送らず、落ちない', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  kv.setJson('push:index', INDEX);
  await tick(env, '12:40');
  const noIndex = mkEnv();
  await register(noIndex, makeUa());
  await tick(noIndex, '12:40');
  await worker.scheduled({ cron: P.PUSH_CRON, scheduledTime: at('12:40') }, {}, mkCtx());
  assert.deepStrictEqual(await P.pushTick(null, at('12:40')), { subs: 0, due: 0, sent: 0, failed: 0, gone: 0 });
  for (const broken of ['x', { v: 1 }, { v: 1, r: 'x' }, { v: 1, r: [[8, 6]] }, { v: 1, r: [null, [8, 6, at('12:45') / 60000, null], [8, 6, 'x', [4320]], 5] }]) {
    const e = mkEnv();
    await get(e, '/push/key');
    await register(e, makeUa());
    e.BOATRACE_KV.setJson('push:index', broken);
    P._resetPushStateForTest();
    const r = await P.pushTick(e, at('12:40')); // 例外を出さない（scheduled の try/catch に頼らない）
    assert.strictEqual(r.sent, 0, JSON.stringify(broken).slice(0, 40));
  }
  assert.strictEqual(pushCalls.length, 0);
});
await t('索引の一部の行が壊れていても、読める行の通知は送る', async () => {
  const { env, kv } = await setup();
  kv.setJson('push:index', { v: 1, r: [null, [8, 6], 'x', [1, 3, at('12:48') / 60000, null]].concat(INDEX.r) });
  const r = await P.pushTick(env, at('12:40'));
  assert.strictEqual(r.sent, 1);
  assert.strictEqual(pushCalls.length, 1);
});
await t('鍵が無いのに送ろうとしても、その場で鍵を作らない（別の鍵で作られた宛先には届かないため）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  await register(env, ua); // /push/key を呼ばずに登録だけある状態（KV の鍵が消えた場合に相当）
  kv.setJson('push:index', INDEX);
  const r = await P.pushTick(env, at('12:40'));
  assert.deepStrictEqual([r.sent, r.failed], [0, 1]);
  assert.strictEqual(kv.countPuts('push:vapid'), 0);
  assert.strictEqual(pushCalls.length, 0, 'push service には送らない');
  assert.deepStrictEqual([kv.json('push:sent:0'), kv.json('push:sent:1')], [null, null], '覚えない（鍵が戻れば拾い直す）');
});

section('[KV を読めない時は、書かない（読めなかった中身を空として上書きしない）]');
// k を読もうとすると失敗する KV にする。戻す関数を返す
function breakGet(kv, match) {
  const realGet = kv.get.bind(kv);
  kv.get = async (k) => {
    if (match(k)) throw new Error('KV GET failed');
    return realGet(k);
  };
  return () => {
    kv.get = realGet;
  };
}
await t('鍵: 読めない時は作り直さない（作り直すと、それまでの宛先すべてに送れなくなる）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const k1 = (await get(env, '/push/key')).json.key;
  P._resetPushStateForTest(); // 別の isolate（鍵の控えが無い）
  const restore = breakGet(kv, (k) => k === 'push:vapid');
  const r = await get(env, '/push/key');
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.json.error, 'no_key');
  assert.strictEqual(kv.countPuts('push:vapid'), 1, '書かない');
  restore();
  P._resetPushStateForTest();
  assert.strictEqual((await get(env, '/push/key')).json.key, k1, '読めるようになれば同じ鍵');
  // 中身が壊れている鍵は使えないので作り直す（読めない時とは区別する）
  kv._store.set('push:vapid', { value: '{broken', meta: null });
  P._resetPushStateForTest();
  const k2 = (await get(env, '/push/key')).json.key;
  assert.ok(/^[A-Za-z0-9_-]{87}$/.test(k2) && k2 !== k1);
});
await t('宛先: 読めない時は登録・変更・解除・テスト通知とも 503 で、書かない（預かっている宛先を消さない）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const ua = makeUa();
  await get(env, '/push/key');
  await register(env, ua);
  const before = kv.json('push:subs');
  const puts = kv.countPuts('push:subs');
  const restore = breakGet(kv, (k) => k === 'push:subs');
  for (const [path, body] of [
    ['/push/subscribe', subBody(makeUa())],
    ['/push/subscribe', subBody(ua, { lead: 15 })],
    ['/push/unsubscribe', { endpoint: ua.sub.endpoint }],
    ['/push/test', { endpoint: ua.sub.endpoint }],
  ]) {
    const r = await post(env, path, body);
    assert.deepStrictEqual([r.status, r.json.error], [503, 'kv_unavailable'], path);
  }
  const broken = await get(env, '/push/status');
  assert.deepStrictEqual([broken.status, broken.json.kv_readable, broken.json.subs], [200, false, 0], '読めていないことを状態に出す');
  restore();
  assert.strictEqual(pushCalls.length, 0);
  assert.strictEqual(kv.countPuts('push:subs'), puts, '書かない');
  assert.deepStrictEqual(kv.json('push:subs'), before);
  const st = await get(env, '/push/status');
  assert.deepStrictEqual([st.json.subs, st.json.kv_readable], [1, true]);
});
await t('毎分の確認: 宛先を読めない回は何も送らない。掃除の時に読めなければ書かない', async () => {
  const { env, kv } = await setup();
  const before = kv.json('push:subs');
  let restore = breakGet(kv, (k) => k === 'push:subs');
  const r0 = await P.pushTick(env, at('12:40'));
  assert.deepStrictEqual([r0.subs, r0.sent], [0, 0]);
  restore();
  assert.strictEqual(pushCalls.length, 0);
  // 送信は 410。掃除のための読み直しだけが失敗する
  P._resetPushStateForTest();
  pushStatus = 410;
  let reads = 0;
  const realGet = kv.get.bind(kv);
  kv.get = async (k) => {
    if (k === 'push:subs' && ++reads > 1) throw new Error('KV GET failed');
    return realGet(k);
  };
  const puts = kv.countPuts('push:subs');
  const r1 = await P.pushTick(env, at('12:42'));
  kv.get = realGet;
  assert.deepStrictEqual([r1.gone, r1.gone_cleanup_skipped], [1, true]);
  assert.strictEqual(kv.countPuts('push:subs'), puts);
  assert.deepStrictEqual(kv.json('push:subs'), before);
});
await t('毎分の確認: 送った記録を読めない回は、ちょうどの回だけ送り、記録に書かない（それまでの記録を消さない）', async () => {
  const { env, kv } = await setup();
  const doc0 = { d: '20261127', k: ['x:1_1', 'y:2_2'], n: 7 };
  kv.setJson('push:sent:0', doc0);
  let restore = breakGet(kv, (k) => k === 'push:sent:0');
  const r0 = await P.pushTick(env, at('12:40')); // ちょうどの回
  assert.deepStrictEqual([r0.sent, r0.sent_unreadable, r0.sent_cap], [1, true, undefined]);
  assert.strictEqual(kv.countPuts('push:sent:0'), 0, '書かない');
  P._resetPushStateForTest(); // 別の isolate。まだ読めない → 拾い直しはしない
  const r1 = await P.pushTick(env, at('12:42'));
  assert.deepStrictEqual([r1.sent, r1.due, r1.sent_unreadable], [0, 0, true]);
  restore();
  assert.deepStrictEqual(kv.json('push:sent:0'), doc0, 'それまでの記録はそのまま');
  assert.strictEqual(pushCalls.length, 1);
  // 読めるようになった後に書く時は、それまでの記録と回数に足す
  P._resetPushStateForTest();
  pushCalls = [];
  const other = await setup({ favs: [[4320, '峰 竜太']], lead: 3 });
  other.kv.setJson('push:sent:0', doc0);
  await tick(other.env, '12:42');
  assert.strictEqual(pushCalls.length, 1);
  assert.deepStrictEqual([other.kv.json('push:sent:0').n, other.kv.json('push:sent:0').k.slice(0, 2)], [8, ['x:1_1', 'y:2_2']]);
  // もう一方の文書だけが読めない回は、自分の文書には書ける
  P._resetPushStateForTest();
  pushCalls = [];
  const c = await setup();
  restore = breakGet(c.kv, (k) => k === 'push:sent:1');
  const rc = await P.pushTick(c.env, at('12:40'));
  restore();
  assert.deepStrictEqual([rc.sent, rc.sent_unreadable], [1, undefined]);
  assert.strictEqual(c.kv.json('push:sent:0').n, 1);
});
await t('索引: 前の内容と比べられない（KV を読めない）時は書かない。読めるようになったら書く', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  programsBody = { programs: [{ race_stadium_number: 8, race_number: 6, race_date: '2026-11-27', race_closed_at: '2026-11-27 12:45:00', boats: [{ racer_boat_number: 1, racer_number: 4320 }] }] };
  const realMeta = kv.getWithMetadata.bind(kv);
  kv.getWithMetadata = async (k, o) => {
    if (k === 'push:index') throw new Error('KV GET failed');
    return realMeta(k, o);
  };
  const r = await P.writePushIndex(env, programsBody);
  assert.deepStrictEqual(r, { races: 1, wrote: false, unreadable: true });
  for (const hm of ['12:05', '12:10', '12:15']) await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at(hm) }, env, mkCtx());
  assert.strictEqual(kv.countPuts('push:index'), 0, 'データ更新のたびに書かない');
  assert.ok(kv.countPuts('health:heartbeat') >= 1, 'データ更新は進む');
  kv.getWithMetadata = realMeta;
  await worker.scheduled({ cron: P.MAIN_CRONS[0], scheduledTime: at('12:20') }, env, mkCtx());
  assert.strictEqual(kv.countPuts('push:index'), 1);
});

section('[毎分の cron が動いている記録]');
await t('最初の回に書き、以後 6 時間は書かない（読みもしない）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  await tick(env, '09:00');
  assert.strictEqual(kv.countPuts('push:tick'), 1);
  assert.strictEqual(kv.json('push:tick').at, new Date(at('09:00')).toISOString());
  let gets = 0;
  const realGet = kv.get.bind(kv);
  kv.get = async (k) => {
    if (k === 'push:tick') gets++;
    return realGet(k);
  };
  for (const hm of ['09:01', '09:02', '12:00', '14:59']) await tick(env, hm);
  assert.strictEqual(kv.countPuts('push:tick'), 1);
  assert.strictEqual(gets, 0, '同じ isolate なら KV を読まない');
  await tick(env, '15:00');
  assert.strictEqual(kv.countPuts('push:tick'), 2, '6 時間たったら書く');
  assert.strictEqual(gets, 1, '書く前に 1 回読む（別の isolate が書いていれば書かない）');
  P._resetPushStateForTest(); // 別の isolate: KV を読んで、新しければ書かない
  await tick(env, '15:01');
  await tick(env, '15:02');
  assert.strictEqual(kv.countPuts('push:tick'), 2);
  assert.strictEqual(gets, 2);
});
await t('生存記録を読めない間は書かない（isolate が替わるたびに書いて、書込枠を使わない）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  const realGet = kv.get.bind(kv);
  kv.get = async (k) => {
    if (k === 'push:tick') throw new Error('KV GET failed');
    return realGet(k);
  };
  for (const hm of ['09:00', '09:01', '09:02', '09:03', '09:04']) {
    P._resetPushStateForTest(); // 毎回 別の isolate
    await tick(env, hm);
  }
  assert.strictEqual(kv.countPuts('push:tick'), 0);
  kv.get = realGet;
  P._resetPushStateForTest();
  await tick(env, '09:05');
  assert.strictEqual(kv.countPuts('push:tick'), 1, '読めるようになったら書く');
});
await t('/push/status: 鍵・宛先の数・索引・最後に動いた時刻・今日送った数・今日の書込回数', async () => {
  const realNow = Date.now;
  Date.now = () => at('12:41', 30);
  try {
    const { env, kv } = await setup({ favs: [[4320, '峰 竜太'], [3941, '池田 浩二']] });
    const empty = await get(mkEnv(), '/push/status');
    assert.deepStrictEqual([empty.json.key, empty.json.subs, empty.json.index_races, empty.json.tick_at, empty.json.sent_today], [false, 0, 0, null, 0]);
    assert.deepStrictEqual([empty.json.sent_writes_today, empty.json.subs_writes_today], [0, 0]);
    const before = await get(env, '/push/status');
    assert.deepStrictEqual([before.json.key, before.json.subs, before.json.index_races, before.json.tick_at, before.json.sent_today], [true, 1, 2, null, 0]);
    assert.deepStrictEqual([before.json.sent_writes_today, before.json.subs_writes_today], [0, 1]);
    await tick(env, '12:40');
    const after = await get(env, '/push/status');
    assert.strictEqual(after.json.key, true);
    assert.strictEqual(after.json.tick_at, new Date(at('12:40')).toISOString());
    assert.strictEqual(after.json.tick_age_sec, 90);
    assert.strictEqual(after.json.sent_today, 1);
    assert.strictEqual(after.json.max_subs, 30);
    assert.deepStrictEqual([after.json.max_sent_writes, after.json.max_subs_writes], [P.PUSH_SENT_WRITES_PER_DAY, P.PUSH_SUBS_WRITES_PER_DAY]);
    await tick(env, '12:43'); // もう一方の文書に書く。この isolate が覚えている常滑 6R の分も入る（重ねて数えない）
    const both = await get(env, '/push/status');
    assert.deepStrictEqual([both.json.sent_today, both.json.sent_writes_today], [2, 2]);
    assert.ok(JSON.stringify(both.json).indexOf('googleapis') < 0, '宛先そのものは出さない');
    // 前の日（UTC）の書込回数は数えない
    const doc = kv.json('push:subs');
    doc.w = { d: '20261126', n: 7 };
    kv.setJson('push:subs', doc);
    assert.strictEqual((await get(env, '/push/status')).json.subs_writes_today, 0);
    assert.strictEqual(kv.json('push:subs').subs.length, 1);
  } finally {
    Date.now = realNow;
  }
});

section('[cron の振り分け]');
await t('毎分の cron はデータ更新を走らせない（上流を取りに行かない・heartbeat を書かない）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  await worker.scheduled({ cron: '* * * * *', scheduledTime: at('12:40') }, env, mkCtx());
  assert.deepStrictEqual(upstreamCalls, []);
  assert.strictEqual(kv.countPuts('health:heartbeat'), 0);
  assert.strictEqual(kv.countPuts('push:tick'), 1);
});
await t('データ更新の cron・式の無い実行（手動）は従来どおり。通知の確認は走らせない', async () => {
  for (const ev of [{ cron: P.MAIN_CRONS[0], scheduledTime: at('12:40') }, { cron: P.MAIN_CRONS[1], scheduledTime: at('23:30') }, {}, { cron: '', scheduledTime: at('12:41') }]) {
    const kv = makeKV();
    upstreamCalls = [];
    await worker.scheduled(ev, mkEnv(kv), mkCtx());
    assert.ok(upstreamCalls.length >= 3, JSON.stringify(ev));
    assert.strictEqual(kv.countPuts('health:heartbeat'), 1, JSON.stringify(ev));
    assert.strictEqual(kv.countPuts('push:tick'), 0, JSON.stringify(ev));
  }
});
await t('知らない式で 5 分の区切りでない時刻なら、何もしない（重い更新を毎分走らせない歯止め）', async () => {
  const kv = makeKV();
  const env = mkEnv(kv);
  for (const hm of ['12:41', '12:42', '12:43', '12:44']) await worker.scheduled({ cron: '*/1 * * * *', scheduledTime: at(hm) }, env, mkCtx());
  assert.deepStrictEqual(upstreamCalls, []);
  assert.strictEqual(kv._puts.length, 0);
  await worker.scheduled({ cron: '*/1 * * * *', scheduledTime: at('12:45') }, env, mkCtx());
  assert.ok(upstreamCalls.length >= 3, '5 分の区切りなら更新する');
});
await t('通知の確認が失敗しても cron は例外を外に出さない', async () => {
  const kv = makeKV();
  kv.get = async () => {
    throw new Error('kv down');
  };
  await worker.scheduled({ cron: P.PUSH_CRON, scheduledTime: at('12:40') }, mkEnv(kv), mkCtx());
  // 確認の途中で例外が出ても（ここでは予定時刻を読むところで）、scheduled は正常に終わる
  const ev = { cron: P.PUSH_CRON };
  Object.defineProperty(ev, 'scheduledTime', {
    get() {
      throw new Error('boom');
    },
  });
  await worker.scheduled(ev, mkEnv(), mkCtx());
  assert.deepStrictEqual(upstreamCalls, [], '失敗してもデータ更新には進まない');
});
await t('入口のモジュール (worker.js) は default だけを export する（ほかの export は Workers が入口として解釈する）', () => {
  assert.deepStrictEqual(Object.keys(workerMod), ['default']);
});
await t('wrangler.toml の cron は「データ更新 2 本 + 毎分 1 本」で、コードの式と一致する。アカウント合計は 5 本以内', () => {
  const crons = (toml) => {
    const m = /^crons\s*=\s*\[([\s\S]*?)\]/m.exec(read(toml));
    assert.ok(m, toml + ' に crons が無い');
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };
  const main = crons('cloudflare-worker/wrangler.toml');
  assert.deepStrictEqual(main, P.MAIN_CRONS.concat([P.PUSH_CRON]));
  assert.strictEqual(P.PUSH_CRON, '* * * * *');
  const sentinel = crons('cloudflare-worker/sentinel/wrangler.toml');
  assert.ok(main.length + sentinel.length <= 5, 'Cloudflare Free は 5 本まで: ' + (main.length + sentinel.length));
});

section('[アプリと揃っていること]');
await t('場の名前・何分前かの選択肢・お気に入りの上限がアプリと同じ', () => {
  const app = read('assets/app.js');
  const m = /var STADIUMS = Object\.freeze\((\{[\s\S]*?\})\);/.exec(app);
  const appStadiums = new Function('return ' + m[1])();
  for (let sid = 1; sid <= 24; sid++) assert.strictEqual(P.PUSH_STADIUMS[sid], appStadiums[sid], '場 ' + sid);
  assert.strictEqual(P.PUSH_STADIUMS.length, 25);
  const leads = /var FAV_NOTIFY_CHOICES = \[([^\]]+)\];/.exec(read('src/reporting/fav_notify.js'))[1].split(',').map((x) => Number(x.trim()));
  assert.deepStrictEqual(P.PUSH_LEADS, leads);
  const max = Number(/var FAV_RACER_MAX = (\d+);/.exec(read('src/reporting/racer_fav.js'))[1]);
  assert.strictEqual(P.PUSH_MAX_FAVS, max);
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
