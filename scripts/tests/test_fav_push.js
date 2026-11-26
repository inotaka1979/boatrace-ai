/**
 * 閉じている間も届く締切前通知（Web Push）の、アプリ側（2026-11-27）
 *   src/reporting/fav_push.js / src/discovery/push_client.js
 *   src/reporting/fav_notify.js（端末の通知の重複を避ける・通知から開いた時にそのレースを開く）
 *   sw.js（push を受け取った時）
 *   index.html（設定の「閉じている間も通知」）
 *
 *   - 有効にする: 許可 → 鍵 → ブラウザの購読 → Worker に預ける
 *   - お気に入り・分数を変えたら預けた内容も合わせる。同じなら通信しない。1 日に 1 回は確かめる
 *   - ブラウザ側で購読が無くなっていたら無効に戻す
 *   - service worker は、push を受けたら必ず通知を出す
 *
 *   node scripts/tests/test_fav_push.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeCtx } = require('./_vm_harness');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x));
let pass = 0,
  fail = 0;
const queue = [];
const t = (name, fn) => queue.push({ name, fn });
const section = (title) => queue.push({ title });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE = 'https://boatrace-scrape-trigger.inotaka1979.workers.dev';
// 65 バイトの公開鍵（base64url 87 文字）
const KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const KEY2 = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const EP = 'https://web.push.apple.com/QGuBnQ8Z0a1b2c3d4e5f';
const FAVS = [
  { id: '4320', name: '峰　　　　竜　太', ts: 3 },
  { id: '3897', name: '白井 英治', ts: 2 },
];
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function mk(opt) {
  const o = opt || {};
  const ctx = makeCtx();
  ctx.atob = atob;
  ctx.btoa = btoa;
  // 長い待ち（service worker の待ち 6 秒・同期の間引き 2.5 秒）は縮める
  ctx.setTimeout = (fn, ms, ...rest) => setTimeout(fn, ms >= 600 ? 5 : ms, ...rest);
  ctx.localStorage.setItem('boatrace_fav_racers', JSON.stringify(o.favs || FAVS));
  if (o.min !== undefined) ctx.settings.favNotifyMin = o.min;
  else delete ctx.settings.favNotifyMin;
  if (o.state) ctx.localStorage.setItem('boatrace_push', JSON.stringify(o.state));
  const els = {
    btnFavPush: { textContent: '', disabled: false, style: {} },
    btnFavPushTest: { textContent: '', disabled: false, style: { display: 'none' } },
    favPushNote: { textContent: '' },
  };
  ctx.document.getElementById = (id) => els[id] || null;
  const env = { permission: o.permission || 'default', grant: o.grant === undefined ? 'granted' : o.grant, sub: null, subscribeCalls: [], unsubscribed: 0, requested: 0 };
  const mkSub = (endpoint, key) => ({
    endpoint,
    // new Uint8Array(...) で 65 バイトちょうどの ArrayBuffer にする（Buffer の .buffer は共有領域で、長さが違う）
    options: o.noOptions ? undefined : { applicationServerKey: new Uint8Array(Buffer.from(key, 'base64url')).buffer },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }),
    unsubscribe: () => {
      env.unsubscribed++;
      env.sub = null;
      return o.unsubscribeFails ? Promise.reject(new Error('x')) : Promise.resolve(true);
    },
  });
  if (o.sub) env.sub = mkSub(o.sub.endpoint || EP, o.sub.key || KEY);
  const reg = {
    pushManager: {
      getSubscription: () => (o.getSubFails ? Promise.reject(new Error('x')) : Promise.resolve(env.sub)),
      subscribe: (so) => {
        env.subscribeCalls.push(so);
        if (o.subscribeFails) return Promise.reject(new Error('NotAllowedError'));
        env.sub = mkSub(EP, b64u(so.applicationServerKey));
        return Promise.resolve(env.sub);
      },
    },
  };
  if (o.supported !== false) {
    ctx.PushManager = function () {};
    ctx.Notification = {
      get permission() {
        return env.permission;
      },
      requestPermission: () => {
        env.requested++;
        env.permission = env.grant;
        return Promise.resolve(env.permission);
      },
    };
    ctx.navigator.serviceWorker = { ready: o.noSw ? new Promise(() => {}) : Promise.resolve(reg), addEventListener() {} };
  }
  const calls = [];
  const server = Object.assign(
    {
      key: KEY,
      down: false,
      subscribe: { status: 200, body: { ok: true, id: 'abc', favs: 2, lead: 5 } },
      unsubscribe: { status: 200, body: { ok: true } },
      test: { status: 200, body: { ok: true, status: 201, delay: 10 } },
    },
    o.server || {}
  );
  ctx.fetch = (url, init) => {
    const u = String(url);
    if (u.indexOf(BASE + '/push/') !== 0) return Promise.reject(new Error('other'));
    const p = u.slice(BASE.length);
    calls.push({ path: p, method: (init && init.method) || 'GET', type: init && init.headers && init.headers['content-type'], body: init && init.body ? JSON.parse(init.body) : null });
    if (server.down || (server.subscribeDown && p === '/push/subscribe')) return Promise.reject(new Error('down'));
    const r = p === '/push/key' ? (server.key ? { status: 200, body: { key: server.key } } : { status: 503, body: { error: 'no_key' } }) : server[p.slice(6)];
    const res = { ok: r.status >= 200 && r.status < 300, status: r.status, json: () => (r.body === 'notjson' ? Promise.reject(new Error('x')) : Promise.resolve(r.body)) };
    // 実際の通信は時間がかかる（delayMs を指定したテストだけ）
    return server.delayMs ? new Promise((resolve) => setTimeout(() => resolve(res), server.delayMs)) : Promise.resolve(res);
  };
  const state = () => JSON.parse(ctx.localStorage.getItem('boatrace_push') || 'null');
  const posts = (p) => calls.filter((c) => c.path === p && c.method === 'POST');
  return { ctx, els, env, calls, server, state, posts, mkSub };
}
const ON = (over) => Object.assign({ on: true, key: KEY, ep: EP, sig: 'x', at: Date.now(), keyAt: Date.now() }, over || {});
// 有効な状態から始める（通知は許可済み・ブラウザに購読がある）
const mkOn = (o) => mk(Object.assign({ permission: 'granted', sub: { key: KEY }, state: ON() }, o || {}));

section('[有効にする]');
t('許可 → 鍵 → ブラウザの購読 → Worker に預ける。状態を保存し、画面を切り替える', async () => {
  const { ctx, els, env, calls, state } = mk();
  ctx._syncFavPushUi();
  assert.strictEqual(els.btnFavPush.textContent, '有効にする');
  assert.strictEqual(els.btnFavPushTest.style.display, 'none');
  assert.ok(/サーバ（Cloudflare）に保存します/.test(els.favPushNote.textContent), '何を預けるかを先に書く');
  assert.strictEqual(await ctx._pushEnable(), true);
  assert.strictEqual(env.requested, 1);
  assert.strictEqual(env.subscribeCalls.length, 1);
  assert.strictEqual(env.subscribeCalls[0].userVisibleOnly, true);
  assert.strictEqual(b64u(env.subscribeCalls[0].applicationServerKey), KEY, 'Worker の公開鍵で購読を作る');
  assert.deepStrictEqual(calls.map((c) => c.method + ' ' + c.path), ['GET /push/key', 'POST /push/subscribe']);
  const post = calls[1];
  assert.strictEqual(post.type, 'text/plain;charset=UTF-8', '事前確認 (preflight) の起きない形で送る');
  assert.deepStrictEqual(J(post.body), {
    sub: { endpoint: EP, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } },
    favs: [[3897, '白井 英治'], [4320, '峰 竜太']],
    lead: 5,
  });
  const st = state();
  assert.deepStrictEqual([st.on, st.key, st.ep], [true, KEY, EP]);
  assert.ok(st.sig && Math.abs(st.at - Date.now()) < 5000 && Math.abs(st.keyAt - Date.now()) < 5000);
  assert.strictEqual(els.btnFavPush.textContent, '無効にする');
  assert.strictEqual(els.btnFavPush.disabled, false);
  assert.strictEqual(els.btnFavPushTest.style.display, '');
  assert.ok(/有効にしました/.test(els.favPushNote.textContent));
  assert.strictEqual(ctx._pushIsOn(), true);
});
t('すでに許可済みなら、許可を求め直さない', async () => {
  const { ctx, env } = mk({ permission: 'granted' });
  assert.strictEqual(await ctx._pushEnable(), true);
  assert.strictEqual(env.requested, 0);
});
t('許可されなければ何も作らない・預けない', async () => {
  for (const o of [{ grant: 'denied' }, { grant: 'default' }, { permission: 'denied' }]) {
    const { ctx, els, env, calls, state } = mk(o);
    assert.strictEqual(await ctx._pushEnable(), false);
    assert.strictEqual(env.subscribeCalls.length, 0);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(state(), null);
    assert.ok(/通知が許可されていません/.test(els.favPushNote.textContent));
    assert.strictEqual(els.btnFavPush.textContent, '有効にする');
    assert.strictEqual(els.btnFavPush.disabled, false, 'もう一度押せる');
  }
});
t('うまくいかない時は理由を出し、無効のままにする', async () => {
  const cases = [
    [{ server: { key: null } }, /サーバに接続できませんでした/, 0],
    [{ server: { down: true } }, /サーバに接続できませんでした/, 0],
    [{ server: { subscribeDown: true } }, /サーバに接続できませんでした/, 1],
    [{ subscribeFails: true }, /通知の宛先を作れませんでした/, 1],
    [{ server: { subscribe: { status: 507, body: { error: 'full' } } } }, /上限に達しています/, 1],
    [{ server: { subscribe: { status: 429, body: { error: 'busy' } } } }, /混み合っています/, 1],
    [{ server: { subscribe: { status: 400, body: { error: 'bad_endpoint' } } } }, /サーバに登録できませんでした/, 1],
    [{ server: { subscribe: { status: 200, body: { ok: false } } } }, /サーバに登録できませんでした/, 1],
    [{ server: { subscribe: { status: 500, body: 'notjson' } } }, /サーバに登録できませんでした/, 1],
    [{ noSw: true }, /アプリの準備ができていません/, 0],
  ];
  for (const [o, re, subs] of cases) {
    const { ctx, els, env, state } = mk(o);
    assert.strictEqual(await ctx._pushEnable(), false, String(re));
    assert.ok(re.test(els.favPushNote.textContent), els.favPushNote.textContent);
    assert.strictEqual(env.subscribeCalls.length, subs, String(re));
    assert.ok(!state() || state().on !== true, '有効にしない');
    assert.strictEqual(els.btnFavPush.disabled, false);
    assert.strictEqual(ctx._pushIsOn(), false);
  }
});
t('同じ鍵の購読が残っていれば使い回す。別の鍵の購読は作り直す', async () => {
  const a = mk({ sub: { key: KEY } });
  assert.strictEqual(await a.ctx._pushEnable(), true);
  assert.strictEqual(a.env.subscribeCalls.length, 0);
  assert.strictEqual(a.env.unsubscribed, 0);
  const b = mk({ sub: { key: KEY2, endpoint: 'https://web.push.apple.com/old-old-old-old-old' } });
  assert.strictEqual(await b.ctx._pushEnable(), true);
  assert.strictEqual(b.env.unsubscribed, 1, '古い鍵の購読はやめる');
  assert.strictEqual(b.env.subscribeCalls.length, 1);
  assert.strictEqual(b.posts('/push/subscribe')[0].body.sub.endpoint, EP);
  // 購読から鍵を読めないブラウザ: 覚えている鍵で判断する
  const c = mk({ sub: { key: KEY }, noOptions: true, state: { on: false, key: KEY } });
  await c.ctx._pushEnable();
  assert.strictEqual(c.env.subscribeCalls.length, 0);
  const d = mk({ sub: { key: KEY }, noOptions: true, state: { on: false, key: KEY2 } });
  await d.ctx._pushEnable();
  assert.strictEqual(d.env.subscribeCalls.length, 1);
});
t('設定画面を開いた時に鍵を先に取っておく。「有効にする」を押してからは、購読を作るまで通信しない', async () => {
  const { ctx, calls, env } = mk({ permission: 'granted' });
  ctx._syncFavPushUi(true);
  ctx._syncFavPushUi(true);
  ctx._syncFavPushUi();
  await sleep(20);
  assert.deepStrictEqual(calls.map((c) => c.path), ['/push/key'], '開いた時に 1 回だけ');
  const order = [];
  const realFetch = ctx.fetch;
  ctx.fetch = (u, i) => (order.push('fetch ' + String(u).replace(BASE, '')), realFetch(u, i));
  const realReady = ctx.navigator.serviceWorker.ready;
  ctx.navigator.serviceWorker.ready = realReady.then((reg) => ({
    pushManager: { getSubscription: () => reg.pushManager.getSubscription(), subscribe: (o) => (order.push('subscribe'), reg.pushManager.subscribe(o)) },
  }));
  assert.strictEqual(await ctx._pushEnable(), true);
  assert.deepStrictEqual(order, ['subscribe', 'fetch /push/subscribe'], '購読の前に通信を挟まない');
  assert.strictEqual(env.subscribeCalls.length, 1);
  // 有効な間・対応していない端末では取りに行かない
  const on = mkOn();
  on.ctx._syncFavPushUi(true);
  const un = mk({ supported: false });
  un.ctx._syncFavPushUi(true);
  await sleep(20);
  assert.deepStrictEqual(on.calls, []);
  assert.deepStrictEqual(un.calls, []);
});
t('先に取った鍵が取れていなければ、押した時に取り直す', async () => {
  const { ctx, calls, server } = mk({ permission: 'granted', server: { down: true } });
  ctx._syncFavPushUi(true);
  await sleep(20);
  server.down = false;
  assert.strictEqual(await ctx._pushEnable(), true);
  assert.deepStrictEqual(calls.map((c) => c.path), ['/push/key', '/push/key', '/push/subscribe']);
});
t('処理中にもう一度押しても二重に走らない', async () => {
  const { ctx, env, els } = mk();
  const first = ctx._pushEnable();
  assert.strictEqual(els.btnFavPush.disabled, true);
  assert.strictEqual(await ctx._pushEnable(), false);
  assert.strictEqual(await first, true);
  assert.strictEqual(env.subscribeCalls.length, 1);
});

section('[対応していない端末]');
t('対応していなければ押せず、理由を出す。iPhone の Safari には「ホーム画面に追加」を案内する', async () => {
  const a = mk({ supported: false });
  a.ctx._syncFavPushUi();
  assert.strictEqual(a.els.btnFavPush.disabled, true);
  assert.ok(/対応していません/.test(a.els.favPushNote.textContent));
  assert.strictEqual(await a.ctx._pushEnable(), false);
  assert.deepStrictEqual(a.calls, []);
  const b = mk({ supported: false });
  b.ctx.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
  b.ctx._syncFavPushUi();
  assert.ok(/ホーム画面に追加/.test(b.els.favPushNote.textContent));
  assert.ok(/16\.4/.test(b.els.favPushNote.textContent));
  // ホーム画面に追加済みなのに対応していない iPhone（iOS が古い）には、「追加してください」とは言わない
  const d = mk({ supported: false });
  d.ctx.navigator.userAgent = b.ctx.navigator.userAgent;
  d.ctx.navigator.standalone = true;
  d.ctx._syncFavPushUi();
  assert.ok(/対応していません/.test(d.els.favPushNote.textContent), d.els.favPushNote.textContent);
  assert.ok(!/ホーム画面に追加/.test(d.els.favPushNote.textContent));
  // ホーム画面から開いている iPhone（対応済み）には案内を出さない
  const c = mk();
  c.ctx.navigator.userAgent = b.ctx.navigator.userAgent;
  c.ctx.navigator.standalone = true;
  c.ctx._syncFavPushUi();
  assert.ok(!/ホーム画面に追加/.test(c.els.favPushNote.textContent));
  assert.strictEqual(c.els.btnFavPush.disabled, false);
});

section('[無効にする]');
t('Worker の記録を消し、ブラウザの購読もやめる', async () => {
  const { ctx, els, env, posts, state } = mkOn();
  ctx._syncFavPushUi();
  assert.strictEqual(els.btnFavPush.textContent, '無効にする');
  assert.strictEqual(await ctx._pushDisable(), true);
  assert.deepStrictEqual(J(posts('/push/unsubscribe')[0].body), { endpoint: EP });
  assert.strictEqual(env.unsubscribed, 1);
  assert.deepStrictEqual(state(), { on: false });
  assert.strictEqual(els.btnFavPush.textContent, '有効にする');
  assert.strictEqual(els.btnFavPushTest.style.display, 'none');
  assert.ok(/無効にしました/.test(els.favPushNote.textContent));
});
t('ブラウザの購読がもう無くても、覚えている宛先で Worker の記録を消す。通信できなくても無効にはなる', async () => {
  const a = mkOn({ sub: null });
  await a.ctx._pushDisable();
  assert.deepStrictEqual(J(a.posts('/push/unsubscribe')[0].body), { endpoint: EP });
  assert.deepStrictEqual(a.state(), { on: false });
  const b = mkOn({ server: { down: true }, unsubscribeFails: true });
  assert.strictEqual(await b.ctx._pushDisable(), true);
  assert.deepStrictEqual(b.state(), { on: false });
});
t('ボタンは状態で切り替わる（有効 → 無効にする / 無効 → 有効にする）', async () => {
  const off = mk();
  await off.ctx.ACTION_HANDLERS.favPushToggle();
  assert.strictEqual(off.state().on, true);
  await off.ctx.ACTION_HANDLERS.favPushToggle();
  assert.deepStrictEqual(off.state(), { on: false });
});

section('[預けた内容を合わせる]');
async function enabled(o) {
  const m = mk(o);
  assert.strictEqual(await m.ctx._pushEnable(), true);
  m.calls.length = 0;
  return m;
}
t('内容が同じなら通信しない', async () => {
  const { ctx, calls } = await enabled();
  assert.strictEqual(await ctx._pushSync(false), false);
  assert.deepStrictEqual(calls, []);
});
t('お気に入りを変えたら預け直す（★ を押すと自動で）', async () => {
  const { ctx, posts, calls } = await enabled();
  ctx._toggleFavRacer('3941', '池田 浩二');
  await sleep(80);
  assert.strictEqual(posts('/push/subscribe').length, 1, '★ の操作から自動で');
  assert.deepStrictEqual(J(posts('/push/subscribe')[0].body.favs), [[3897, '白井 英治'], [3941, '池田 浩二'], [4320, '峰 竜太']]);
  assert.deepStrictEqual(calls.map((c) => c.path), ['/push/subscribe'], '鍵は取り直さない');
  assert.strictEqual(await ctx._pushSync(false), false, '預けた後は同じ内容');
});
t('続けて変えても 1 回にまとめて預ける（通信に時間がかかっても、変更のたびには送らない）', async () => {
  const { ctx, posts, calls, server } = await enabled();
  server.delayMs = 25;
  ctx._toggleFavRacer('3941', '池田 浩二');
  ctx._toggleFavRacer('4444', 'A');
  ctx._toggleFavRacer('4445', 'B');
  await sleep(150);
  assert.strictEqual(posts('/push/subscribe').length, 1, JSON.stringify(calls.map((c) => c.path)));
  assert.strictEqual(posts('/push/subscribe')[0].body.favs.length, 5, '最後の状態を送る');
  server.delayMs = 0;
  assert.strictEqual(await ctx._pushSync(false), false);
});
t('何分前かを変えたら預け直す', async () => {
  const { ctx, posts } = await enabled();
  ctx.settings.favNotifyMin = '10';
  assert.strictEqual(await ctx._pushSync(false), true);
  assert.strictEqual(posts('/push/subscribe')[0].body.lead, 10);
  ctx.settings.favNotifyMin = '0';
  assert.strictEqual(await ctx._pushSync(false), true);
  assert.strictEqual(posts('/push/subscribe')[1].body.lead, 0, '「通知しない」も預ける（Worker が送らなくなる）');
});
t('無効のときは何もしない（ブラウザに購読が残っていて通知が許可済みでも、預けない・状態を変えない）', async () => {
  const { ctx, calls, state } = mk({ sub: { key: KEY }, permission: 'granted' });
  assert.strictEqual(await ctx._pushSync(true), false);
  assert.strictEqual(ctx._pushSyncSoon(), false);
  ctx._toggleFavRacer('3941', '池田 浩二');
  await sleep(60);
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(state(), null);
});
t('1 日たったら、内容が同じでも確かめる（鍵も確かめる）', async () => {
  const m = await enabled();
  const st = m.state();
  m.ctx.localStorage.setItem('boatrace_push', JSON.stringify(Object.assign({}, st, { at: Date.now() - 25 * 3600000, keyAt: Date.now() - 25 * 3600000 })));
  assert.strictEqual(await m.ctx._pushSync(false), true);
  assert.deepStrictEqual(m.calls.map((c) => c.path), ['/push/key', '/push/subscribe']);
  assert.ok(Math.abs(m.state().at - Date.now()) < 5000);
  assert.ok(Math.abs(m.state().keyAt - Date.now()) < 5000);
  assert.strictEqual(m.state().on, true);
});
t('Worker の鍵が変わっていたら、無効に戻して知らせる（その宛先にはもう送れない）', async () => {
  const m = await enabled();
  const st = m.state();
  m.ctx.localStorage.setItem('boatrace_push', JSON.stringify(Object.assign({}, st, { keyAt: Date.now() - 25 * 3600000, sig: 'old' })));
  m.server.key = KEY2;
  assert.strictEqual(await m.ctx._pushSync(false), false);
  assert.deepStrictEqual(m.state(), { on: false, lost: true });
  assert.strictEqual(m.posts('/push/subscribe').length, 0);
  assert.ok(/もう一度「有効にする」/.test(m.els.favPushNote.textContent));
  assert.strictEqual(m.els.btnFavPush.textContent, '有効にする');
});
t('ブラウザ側で購読が無くなっていたら・通知を拒否されていたら、無効に戻して知らせる', async () => {
  const a = await enabled();
  a.env.sub = null;
  assert.strictEqual(await a.ctx._pushSync(false), false);
  assert.deepStrictEqual(a.state(), { on: false, lost: true });
  assert.ok(/無効になっています/.test(a.els.favPushNote.textContent));
  assert.deepStrictEqual(a.calls, []);
  const b = await enabled();
  b.env.permission = 'denied';
  await b.ctx._pushSync(false);
  assert.deepStrictEqual(b.state(), { on: false, lost: true });
});
t('service worker がまだ用意できていない時は、状態を変えない（次の機会に）', async () => {
  const m = mkOn({ noSw: true });
  assert.strictEqual(await m.ctx._pushSync(false), false);
  assert.strictEqual(m.state().on, true);
});
t('預け直しに失敗しても有効のまま（次の機会にもう一度）', async () => {
  const m = await enabled();
  m.ctx.settings.favNotifyMin = '15';
  m.server.down = true;
  assert.strictEqual(await m.ctx._pushSync(false), false);
  assert.strictEqual(m.state().on, true);
  m.server.down = false;
  assert.strictEqual(await m.ctx._pushSync(false), true, '通信が戻れば預け直す');
});
t('設定の「何分前」を変えると預け直す（change の配線）', () => {
  const src = read('src/reporting/fav_push.js');
  assert.ok(/document\.addEventListener\('change', function \(ev\) \{[\s\S]{0,200}el\.id === 'setFavNotify'[\s\S]{0,120}_pushSyncSoon\(\)/.test(src));
  assert.ok(/setTimeout\(function \(\) \{\s*_pushSync\(false\);\s*\}, 5000\)/.test(src), '起動のたびに 1 回確かめる');
  assert.ok(/_syncFavPushUi\(true\)/.test(read('assets/app.js').split('function loadSettings(){')[1].split('\nfunction ')[0]), '設定画面を開いたら表示を合わせる（鍵も先に取る）');
});

section('[画面の説明]');
t('有効のとき: 人数と分数。「通知しない」・お気に入りなしのときはその旨', async () => {
  const a = mkOn();
  a.ctx._syncFavPushUi();
  assert.ok(/お気に入り選手（2 人）の出るレースの締切 5 分前/.test(a.els.favPushNote.textContent), a.els.favPushNote.textContent);
  const b = mkOn({ min: '0' });
  b.ctx._syncFavPushUi();
  assert.ok(/「通知しない」のため、通知は届きません/.test(b.els.favPushNote.textContent));
  const c = mkOn({ favs: [], min: '10' });
  c.ctx._syncFavPushUi();
  assert.ok(/お気に入り選手（★）を登録すると/.test(c.els.favPushNote.textContent));
  assert.ok(/10 分前/.test(c.els.favPushNote.textContent));
});
t('保存した状態が壊れていても落ちない', () => {
  for (const bad of ['x', '[1]', '"on"', 'null', '{"on":"yes"}']) {
    const m = mk();
    m.ctx.localStorage.setItem('boatrace_push', bad);
    m.ctx._syncFavPushUi();
    assert.strictEqual(m.ctx._pushIsOn(), false, bad);
    assert.strictEqual(m.els.btnFavPush.textContent, '有効にする');
  }
});

section('[テスト通知]');
t('10 秒後に送ってもらう。その間にアプリを閉じるよう案内する', async () => {
  const { ctx, els, posts } = mkOn();
  const p = ctx._pushTest();
  assert.ok(/10 秒後にテスト通知を送ります。アプリを閉じて/.test(els.favPushNote.textContent));
  assert.strictEqual(els.btnFavPushTest.disabled, true);
  assert.strictEqual(await p, true);
  assert.deepStrictEqual(J(posts('/push/test')[0].body), { endpoint: EP, delay: 10 });
  assert.ok(/テスト通知を送りました/.test(els.favPushNote.textContent));
  assert.strictEqual(els.btnFavPushTest.disabled, false);
});
t('送れなかった時は理由を出す', async () => {
  const cases = [
    [{ test: { status: 200, body: { ok: false, status: 403, delay: 10 } } }, /通知サービスの応答 403/],
    [{ test: { status: 200, body: { ok: false, status: 0, delay: 10 } } }, /通知サービスの応答 0/],
    [{ test: { status: 429, body: { error: 'busy' } } }, /混み合っています/],
    [{ test: { status: 500, body: 'notjson' } }, /サーバに接続できませんでした/],
    [{ down: true }, /サーバに接続できませんでした/],
  ];
  for (const [server, re] of cases) {
    const { ctx, els } = mkOn({ server });
    assert.strictEqual(await ctx._pushTest(), false, String(re));
    assert.ok(re.test(els.favPushNote.textContent), els.favPushNote.textContent);
    assert.strictEqual(els.btnFavPushTest.disabled, false);
  }
});
t('Worker 側に記録が無ければ（404）預け直して、もう一度試すよう案内する', async () => {
  const { ctx, els, posts } = mkOn({ server: { test: { status: 404, body: { error: 'not_registered' } } } });
  assert.strictEqual(await ctx._pushTest(), false);
  assert.strictEqual(posts('/push/subscribe').length, 1);
  assert.ok(/登録し直しました。もう一度「テスト通知」/.test(els.favPushNote.textContent));
});
t('無効のときは送らない', async () => {
  const { ctx, calls } = mk({ sub: { key: KEY } });
  assert.strictEqual(await ctx._pushTest(), false);
  assert.deepStrictEqual(calls, []);
});

section('[アプリを開いている間の通知との重なり]');
const jst = (s) => Date.parse(s + '+09:00');
function withRace(m) {
  m.ctx.programData = {
    8: { 6: { race_closed_at: '2026-11-25 12:45:00', race_title: 'テスト杯', race_grade_number: 5, boats: [{ racer_boat_number: 6, racer_number: 4320, racer_name: '峰 竜太', racer_class_number: 1 }] } },
  };
  m.ctx.resultData = {};
  m.ctx.predictRace = () => null;
  const nodes = [];
  const body = { appendChild: (el) => (nodes.push(el), (el.parentNode = body), el), removeChild: (el) => nodes.splice(nodes.indexOf(el), 1) };
  m.ctx.document.body = body;
  m.ctx.document.createElement = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, innerHTML: '', className: '', id: '' });
  const shown = [];
  m.ctx.navigator.serviceWorker.ready = Promise.resolve({ showNotification: (title) => (shown.push(title), Promise.resolve()) });
  return { nodes, shown };
}
t('「閉じている間も通知」が有効なら、アプリからは端末の通知を出さない（Worker から届く。画面の通知は出す）', async () => {
  const on = mkOn();
  const a = withRace(on);
  assert.strictEqual(on.ctx._favNotifyTick(jst('2026-11-25T12:40:00')), 1);
  await sleep(20);
  assert.strictEqual(a.nodes.length, 1, '画面の通知');
  assert.deepStrictEqual(a.shown, [], '端末の通知は Worker に任せる');
  const off = mk({ permission: 'granted' });
  const b = withRace(off);
  assert.strictEqual(off.ctx._favNotifyTick(jst('2026-11-25T12:40:00')), 1);
  await sleep(20);
  assert.deepStrictEqual(b.shown, ['まもなく締切 常滑 6R（あと 5 分）'], '無効なら従来どおりアプリが出す');
});

section('[通知を押してアプリが開いた時]');
t('?race=<場>-<R> を読む。範囲外・形の違うものは無視する', () => {
  const { ctx } = mk();
  assert.deepStrictEqual(J(ctx._favRaceFromSearch('?race=8-6')), { sid: 8, rno: 6 });
  assert.deepStrictEqual(J(ctx._favRaceFromSearch('?tab=stats&race=24-12')), { sid: 24, rno: 12 });
  assert.deepStrictEqual(J(ctx._favRaceFromSearch('?race=1-1&x=1')), { sid: 1, rno: 1 });
  for (const bad of ['', '?race=', '?race=8', '?race=25-1', '?race=0-1', '?race=8-13', '?race=8-0', '?race=a-b', '?race=8-6x', '?xrace=8-6', '?race=8-6-1', '?race=-8-6', null, undefined]) {
    assert.strictEqual(ctx._favRaceFromSearch(bad), null, String(bad));
  }
});
t('起動時のページ復元がそのレースを開くようにして、URL から指定を外す', () => {
  const { ctx } = mk();
  const saved = {};
  ctx.sessionStorage.setItem = (k, v) => (saved[k] = v);
  const replaced = [];
  ctx.history = { replaceState: (a, b, u) => replaced.push(u) };
  ctx.location.search = '?race=8-6';
  ctx.location.pathname = '/boatrace-ai/';
  assert.deepStrictEqual(J(ctx._favOpenFromUrl()), { sid: 8, rno: 6 });
  const nav = JSON.parse(saved.boatrace_nav);
  assert.deepStrictEqual([nav.page, nav.sid, nav.rn], ['detail', 8, 6], '_restoreNavState が読む形');
  assert.ok(Math.abs(nav.ts - Date.now()) < 5000);
  assert.deepStrictEqual(replaced, ['/boatrace-ai/']);
  ctx.location.search = '';
  assert.strictEqual(ctx._favOpenFromUrl(), null);
  assert.strictEqual(replaced.length, 1);
});
t('復元が先に済んでいた場合は、番組表が届いてから自分で開く。もう表示していれば開き直さない', async () => {
  const a = mk();
  const opened = [];
  a.ctx.ACTION_HANDLERS.openRace = (el) => opened.push([el.dataset.argSid, el.dataset.argRn]);
  a.ctx.history = { replaceState() {} };
  a.ctx.location.search = '?race=8-6';
  a.ctx.programData = { 8: { 6: { boats: [] } } };
  a.ctx._favOpenFromUrl();
  await sleep(700);
  assert.deepStrictEqual(opened, [['8', '6']]);
  const b = mk();
  const opened2 = [];
  b.ctx.ACTION_HANDLERS.openRace = (el) => opened2.push(el);
  b.ctx.history = { replaceState() {} };
  b.ctx.location.search = '?race=8-6';
  b.ctx.programData = { 8: { 6: { boats: [] } } };
  b.ctx.currentStadium = '8';
  b.ctx.currentRace = '6';
  b.ctx.document.querySelector = (sel) => (sel === '.page.active' ? { id: 'pageDetail' } : null);
  b.ctx._favOpenFromUrl();
  await sleep(700);
  assert.deepStrictEqual(opened2, []);
});

section('[service worker: push を受け取った時]');
function loadSw() {
  const handlers = {};
  const shown = [];
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    clients: { matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve(), claim: () => Promise.resolve() },
    skipWaiting: () => {},
    location: { origin: 'https://example.test', href: 'https://example.test/sw.js' },
    registration: { showNotification: (title, opt) => (shown.push({ title, opt }), Promise.resolve()) },
  };
  const sandbox = { self, caches: { open: () => Promise.resolve({}), keys: () => Promise.resolve([]) }, fetch: () => Promise.reject(new Error('x')), URL, Request: function () {}, Response: function () {}, Headers: function () {}, console, Promise, Set, Map, setTimeout, Number, JSON };
  vm.createContext(sandbox);
  vm.runInContext(read('sw.js'), sandbox);
  return { handlers, shown };
}
async function push(sw, data) {
  let waited = null;
  sw.handlers.push({ data, waitUntil: (p) => (waited = p) });
  assert.ok(waited && typeof waited.then === 'function', '通知を出し終わるまで service worker を止めない (waitUntil)');
  await waited;
}
t('Worker の本文どおりに通知を出す（題・本文・tag・開くレース）', async () => {
  const sw = loadSw();
  const payload = { t: 'まもなく締切 常滑 6R（あと 5 分）', b: '6号艇 峰 竜太　締切 12:45', g: 'boatrace-fav-8-6', d: { sid: 8, rno: 6 } };
  await push(sw, { json: () => payload });
  assert.strictEqual(sw.shown.length, 1);
  assert.strictEqual(sw.shown[0].title, payload.t);
  assert.deepStrictEqual(J(sw.shown[0].opt), { body: payload.b, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'boatrace-fav-8-6', data: { sid: 8, rno: 6 } });
});
t('本文が読めなくても必ず通知を出す（出さない push が続くと iPhone は購読を取り消す）', async () => {
  const cases = [null, undefined, { json: () => { throw new Error('bad'); } }, { json: () => null }, { json: () => 'text' }, { json: () => ({}) }, { json: () => ({ t: 5, b: {}, g: [], d: 'x' }) }];
  for (const data of cases) {
    const sw = loadSw();
    await push(sw, data);
    assert.strictEqual(sw.shown.length, 1);
    assert.strictEqual(sw.shown[0].title, 'BoatRace Oracle');
    assert.strictEqual(sw.shown[0].opt.body, 'お気に入り選手のレースがまもなく締切です。');
    assert.strictEqual(sw.shown[0].opt.tag, 'boatrace-push');
  }
});
t('長すぎる文は切る', async () => {
  const sw = loadSw();
  await push(sw, { json: () => ({ t: 'あ'.repeat(500), b: 'い'.repeat(2000), g: 'g'.repeat(300), d: {} }) });
  assert.strictEqual(sw.shown[0].title.length, 120);
  assert.strictEqual(sw.shown[0].opt.body.length, 300);
  assert.strictEqual(sw.shown[0].opt.tag.length, 60);
});
t('アプリ内の通知と同じ tag（同じレースの通知は 1 つにまとまる）', () => {
  const app = read('src/reporting/fav_notify.js');
  const worker = read('cloudflare-worker/push.js');
  assert.ok(/tag: 'boatrace-fav-' \+ x\.sid \+ '-' \+ x\.rno/.test(app));
  assert.ok(/g: 'boatrace-fav-' \+ sid \+ '-' \+ rno/.test(worker));
});

section('[配線]');
t('rest bundle に入り、起動時の bundle には入らない', () => {
  const rest = read('assets/app-rest.js');
  const critical = read('assets/app-critical.js');
  for (const name of ['function _pushEnable', 'function _pushSync', 'function _pushFetchKey', 'function _pushPost']) {
    assert.ok(rest.indexOf(name) >= 0, name + ' が rest に無い');
    assert.ok(critical.indexOf(name) < 0, name + ' が critical に入っている');
  }
});
t('通信は discovery 層だけ。設定のボタンは data-action（inline の handler を使わない）', () => {
  const rep = read('src/reporting/fav_push.js');
  assert.ok(!/\bfetch\(/.test(rep), 'reporting 層は fetch しない');
  assert.ok(!/\son(click|change)=/.test(rep));
  const html = read('index.html');
  assert.ok(/<button class="action-btn" id="btnFavPush" data-action="favPushToggle">有効にする<\/button>/.test(html));
  assert.ok(/<button class="action-btn" id="btnFavPushTest" data-action="favPushTest" style="display:none">テスト通知<\/button>/.test(html));
  assert.ok(/<div class="setting-note" id="favPushNote">[^<]*サーバ（Cloudflare）に保存します。<\/div>/.test(html));
  assert.ok(/connect-src[^;]*https:\/\/boatrace-scrape-trigger\.inotaka1979\.workers\.dev/.test(html), 'CSP が Worker への通信を許している');
});
t('Worker との取り決め: 経路・本文の形・鍵の形', () => {
  const client = read('src/discovery/push_client.js');
  const worker = read('cloudflare-worker/push.js');
  for (const p of ['/push/key', '/push/subscribe', '/push/unsubscribe', '/push/test']) {
    assert.ok(worker.indexOf("'" + p + "'") >= 0, 'Worker に ' + p + ' が無い');
    assert.ok((client + read('src/reporting/fav_push.js')).indexOf("'" + p + "'") >= 0, 'アプリが ' + p + ' を呼んでいない');
  }
  assert.ok(/\[A-Za-z0-9_-\]\{87\}/.test(client), '鍵は 87 文字の base64url');
  const delay = Number(/var PUSH_TEST_DELAY_SEC = (\d+);/.exec(read('src/reporting/fav_push.js'))[1]);
  const max = Number(/export const PUSH_TEST_MAX_DELAY_SEC = (\d+);/.exec(worker)[1]);
  assert.ok(delay <= max, 'テスト通知の待ち時間が Worker の上限以内');
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
