/**
 * Web Push: 本文の暗号化（RFC 8291）と送信元の証明（RFC 8292 VAPID）（2026-11-27）
 *   cloudflare-worker/push.js
 *
 *   - RFC 8291 の例（付録 A）と 1 バイトも違わない本文を作ること
 *   - 受け取る側（別の書き方の実装。_push_helpers.mjs）で復号でき、元の文に戻ること
 *   - Authorization ヘッダの署名が正しく、宛先・期限・連絡先が仕様どおりであること
 *   - 送信元の鍵は 1 回だけ作って KV に置くこと
 *
 *   node scripts/tests/test_push_crypto.mjs
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { b64u, unb64u, makeUa, decryptPush, verifyVapid, makeKV } from './_push_helpers.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = await import(pathToFileURL(path.join(ROOT, 'cloudflare-worker', 'push.js')).href);

let pass = 0,
  fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  PASS:', name);
    pass++;
  } catch (e) {
    console.log('  FAIL:', name, '\n    ', e && e.message);
    fail++;
  }
}
const EX = P.RFC8291_EXAMPLE;
const exAsJwk = () => {
  const pub = unb64u(EX.asPublic);
  return { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: EX.asPrivate };
};

console.log('[本文の暗号化: RFC 8291 の例]');
await t('例と同じ鍵・salt で、例と 1 バイトも違わない本文になる', async () => {
  const body = await P.encryptPushPayload(EX.p256dh, EX.auth, P.utf8(EX.plaintext), { salt: unb64u(EX.salt), asJwk: exAsJwk() });
  assert.strictEqual(b64u(body), EX.body);
  // 86（先頭）+ 41（平文）+ 1（区切り）+ 16（認証タグ）。RFC の例の Content-Length は 145 と書かれているが、
  //   例の本文そのものは 144 バイト（base64url 192 文字）
  assert.strictEqual(body.length, 144);
  assert.strictEqual(unb64u(EX.body).length, 144);
  assert.strictEqual(await P.pushSelfTest(), true);
});
await t('例の本文を、受け取る側の実装（別の書き方）で復号すると元の文に戻る', async () => {
  const ua = { privateKey: unb64u('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'), publicKey: unb64u(EX.p256dh), auth: unb64u(EX.auth) };
  assert.strictEqual(decryptPush(unb64u(EX.body), ua).toString('utf8'), EX.plaintext);
});
await t('先頭 86 バイト: salt 16 + レコード長 4096 + 鍵の長さ 65 + 送信側の公開鍵 65', async () => {
  const ua = makeUa();
  const body = Buffer.from(await P.encryptPushPayload(ua.sub.keys.p256dh, ua.sub.keys.auth, P.utf8('x')));
  assert.strictEqual(body.readUInt32BE(16), 4096);
  assert.strictEqual(body[20], 65);
  assert.strictEqual(body[21], 4);
  assert.strictEqual(body.length, 86 + 1 + 1 + 16, '平文 1 + 区切り 1 + 認証タグ 16');
});

console.log('[本文の暗号化: 送って受け取る]');
await t('いろいろな長さ・日本語の文を、受け取る側で復号できる', async () => {
  const texts = ['', 'a', 'x'.repeat(15), 'x'.repeat(16), 'x'.repeat(17), 'x'.repeat(255), 'x'.repeat(1000),
    JSON.stringify({ t: 'まもなく締切 常滑 6R（あと 5 分）', b: '6号艇 峰 竜太　締切 12:45', g: 'boatrace-fav-8-6', d: { sid: 8, rno: 6 } }),
    '😀🚤'.repeat(200)];
  for (const s of texts) {
    const ua = makeUa();
    const body = await P.encryptPushPayload(ua.sub.keys.p256dh, ua.sub.keys.auth, P.utf8(s));
    assert.strictEqual(decryptPush(body, ua).toString('utf8'), s, '長さ ' + s.length);
  }
});
await t('上限は平文 3,993 バイト（本文 4,096 バイト）。それを超えると送らない', async () => {
  const ua = makeUa();
  const max = new Uint8Array(3993).fill(0x61);
  const body = await P.encryptPushPayload(ua.sub.keys.p256dh, ua.sub.keys.auth, max);
  assert.strictEqual(body.length, 4096);
  assert.strictEqual(decryptPush(body, ua).length, 3993);
  await assert.rejects(() => P.encryptPushPayload(ua.sub.keys.p256dh, ua.sub.keys.auth, new Uint8Array(3994)), /too large/);
});
await t('同じ文でも毎回ちがう本文になる（salt と送信側の鍵は毎回新しい）', async () => {
  const ua = makeUa();
  const a = Buffer.from(await P.encryptPushPayload(ua.sub.keys.p256dh, ua.sub.keys.auth, P.utf8('same')));
  const b = Buffer.from(await P.encryptPushPayload(ua.sub.keys.p256dh, ua.sub.keys.auth, P.utf8('same')));
  assert.ok(!a.subarray(0, 16).equals(b.subarray(0, 16)), 'salt');
  assert.ok(!a.subarray(21, 86).equals(b.subarray(21, 86)), '送信側の公開鍵');
  assert.ok(!a.subarray(86).equals(b.subarray(86)), '暗号文');
});
await t('別の端末の鍵・認証値では復号できない。途中を書き換えた本文も復号できない', async () => {
  const ua = makeUa();
  const other = makeUa();
  const body = Buffer.from(await P.encryptPushPayload(ua.sub.keys.p256dh, ua.sub.keys.auth, P.utf8('secret')));
  assert.throws(() => decryptPush(body, other));
  assert.throws(() => decryptPush(body, { ecdh: ua.ecdh, publicKey: ua.publicKey, auth: crypto.randomBytes(16) }));
  const broken = Buffer.from(body);
  broken[90] ^= 1;
  assert.throws(() => decryptPush(broken, ua));
});
await t('おかしな鍵は受け付けない', async () => {
  const ua = makeUa();
  const good = ua.sub.keys;
  const bad = [
    [b64u(ua.publicKey.subarray(0, 64)), good.auth, /p256dh/],
    [b64u(Buffer.concat([Buffer.from([2]), ua.publicKey.subarray(1)])), good.auth, /p256dh/],
    ['', good.auth, /p256dh/],
    ['!!!', good.auth, /p256dh/],
    [good.p256dh, b64u(crypto.randomBytes(15)), /auth/],
    [good.p256dh, b64u(crypto.randomBytes(17)), /auth/],
    [good.p256dh, '', /auth/],
  ];
  for (const [p, a, re] of bad) await assert.rejects(() => P.encryptPushPayload(p, a, P.utf8('x')), re, p.slice(0, 8) + ' / ' + a.slice(0, 8));
  // 曲線の上に無い点（長さと先頭は正しい）は WebCrypto が拒む
  const off = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]);
  await assert.rejects(() => P.encryptPushPayload(b64u(off), good.auth, P.utf8('x')));
});

console.log('[base64url]');
await t('相互に変換できる。= や + / が混じっていても読める。おかしな文字は null', () => {
  for (const n of [0, 1, 2, 3, 4, 16, 65, 200]) {
    const raw = crypto.randomBytes(n);
    const s = P.b64uEncode(raw);
    assert.ok(/^[A-Za-z0-9_-]*$/.test(s));
    assert.strictEqual(s, b64u(raw));
    assert.ok(Buffer.from(P.b64uDecode(s)).equals(raw), 'n=' + n);
    assert.ok(Buffer.from(P.b64uDecode(raw.toString('base64'))).equals(raw), '標準の base64 n=' + n);
  }
  for (const bad of ['a', 'abc*', 'あ', ' abcd', null, undefined, 5, {}]) assert.strictEqual(P.b64uDecode(bad), null, String(bad));
});

console.log('[送信元の鍵]');
await t('最初に 1 回だけ作って KV に置く。次からは同じ鍵', async () => {
  P._resetPushStateForTest();
  const kv = makeKV();
  const env = { BOATRACE_KV: kv };
  assert.strictEqual(await P.getVapid(env, false), null, '作らない指定なら作らない');
  assert.strictEqual(kv.countPuts('push:vapid'), 0);
  const a = await P.getVapid(env, true);
  assert.strictEqual(kv.countPuts('push:vapid'), 1);
  assert.strictEqual(unb64u(a.pub).length, 65);
  assert.strictEqual(unb64u(a.pub)[0], 4);
  const saved = kv.json('push:vapid');
  assert.strictEqual(saved.pub, a.pub);
  assert.ok(saved.jwk.d && saved.jwk.x && saved.jwk.y);
  const b = await P.getVapid(env, true);
  const c = await P.getVapid(env, true);
  assert.strictEqual(b.pub, a.pub);
  assert.strictEqual(c.pub, a.pub);
  assert.strictEqual(kv.countPuts('push:vapid'), 1, '作り直さない');
});
await t('作ったばかりの鍵は控えず、次の呼出で KV の鍵に揃える（同時に 2 つ作られた場合の備え）', async () => {
  // 別の isolate が作った鍵（KV に最後に残るのはこちら、という状況を作る）
  P._resetPushStateForTest();
  const otherKv = makeKV();
  const theirs = await P.getVapid({ BOATRACE_KV: otherKv }, true);
  P._resetPushStateForTest();
  const kv = makeKV();
  const env = { BOATRACE_KV: kv };
  const mine = await P.getVapid(env, true); // この isolate が作って書いた
  assert.notStrictEqual(mine.pub, theirs.pub);
  kv.setJson('push:vapid', otherKv.json('push:vapid')); // 後から別の isolate の鍵で上書きされた
  const next = await P.getVapid(env, true);
  assert.strictEqual(next.pub, theirs.pub, 'KV に残ったほうに揃う（作った鍵で送り続けない）');
  // KV から読んだ鍵は控える（毎回は読まない）
  kv.setJson('push:vapid', { jwk: mine.jwk, pub: mine.pub });
  assert.strictEqual((await P.getVapid(env, true)).pub, theirs.pub);
  assert.strictEqual(kv.countPuts('push:vapid'), 1);
});
await t('secret VAPID_JWK があればそれを使い、KV には書かない', async () => {
  P._resetPushStateForTest();
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.privateKey.export({ format: 'jwk' });
  const kv = makeKV();
  const v = await P.getVapid({ BOATRACE_KV: kv, VAPID_JWK: JSON.stringify(jwk) }, true);
  assert.strictEqual(v.jwk.d, jwk.d);
  assert.strictEqual(kv._puts.length, 0);
  // 壊れた secret は無視して KV の鍵を使う
  P._resetPushStateForTest();
  const v2 = await P.getVapid({ BOATRACE_KV: kv, VAPID_JWK: '{broken' }, true);
  assert.ok(v2 && v2.pub);
  assert.strictEqual(kv.countPuts('push:vapid'), 1);
});
await t('KV の中身が壊れていたら作り直す', async () => {
  P._resetPushStateForTest();
  const kv = makeKV();
  kv._store.set('push:vapid', { value: '{"jwk":{"kty":"EC"}}', meta: null });
  const v = await P.getVapid({ BOATRACE_KV: kv }, true);
  assert.ok(v && unb64u(v.pub).length === 65);
  assert.strictEqual(kv.countPuts('push:vapid'), 1);
});

console.log('[送信元の証明: Authorization ヘッダ]');
const NOW = Date.parse('2026-11-27T03:00:00Z');
await t('署名が正しく、宛先・期限・連絡先が仕様どおり', async () => {
  P._resetPushStateForTest();
  const kv = makeKV();
  const env = { BOATRACE_KV: kv };
  const key = (await P.getVapid(env, true)).pub;
  const h = await P.vapidAuthorization(env, 'https://fcm.googleapis.com', NOW);
  const v = verifyVapid(h, { aud: 'https://fcm.googleapis.com', nowSec: NOW / 1000 });
  assert.ok(v.ok, v.why);
  assert.strictEqual(v.k, key, 'k は /push/key と同じ鍵');
  assert.deepStrictEqual(Object.keys(v.claims).sort(), ['aud', 'exp', 'sub']);
  assert.strictEqual(v.claims.exp - NOW / 1000, 12 * 3600, '期限は 12 時間（仕様の上限は 24 時間）');
  assert.ok(/^https:\/\//.test(v.claims.sub), '連絡先は https の URL');
  assert.ok(v.claims.sub.indexOf('@') < 0, 'メールアドレスは入れない');
});
await t('別の鍵で確かめると署名が合わない（確かめる側が何でも通すわけではない）', async () => {
  P._resetPushStateForTest();
  const env = { BOATRACE_KV: makeKV() };
  await P.getVapid(env, true);
  const h = await P.vapidAuthorization(env, 'https://web.push.apple.com', NOW);
  const other = b64u(makeUa().publicKey);
  const forged = h.replace(/k=[A-Za-z0-9_-]+$/, 'k=' + other);
  assert.strictEqual(verifyVapid(forged, { nowSec: NOW / 1000 }).why, 'signature');
  assert.strictEqual(verifyVapid(h, { aud: 'https://fcm.googleapis.com', nowSec: NOW / 1000 }).why, 'aud');
  assert.strictEqual(verifyVapid(h, { nowSec: NOW / 1000 + 13 * 3600 }).why, 'expired');
});
await t('同じ宛先には同じ証明を使い回す。期限が近づいたら作り直す。宛先が違えば別の証明', async () => {
  P._resetPushStateForTest();
  const kv = makeKV();
  const env = { BOATRACE_KV: kv };
  await P.getVapid(env, true); // KV に置く（次の呼出から isolate に控える）
  const a = await P.vapidAuthorization(env, 'https://fcm.googleapis.com', NOW);
  const b = await P.vapidAuthorization(env, 'https://fcm.googleapis.com', NOW + 3600000);
  assert.strictEqual(a, b, '1 時間後も使い回す');
  const c = await P.vapidAuthorization(env, 'https://fcm.googleapis.com', NOW + 12 * 3600000 - 5 * 60000);
  assert.notStrictEqual(a, c, '残り 5 分なら作り直す');
  assert.ok(verifyVapid(c, { nowSec: (NOW + 12 * 3600000 - 5 * 60000) / 1000 }).ok);
  const d = await P.vapidAuthorization(env, 'https://web.push.apple.com', NOW);
  assert.strictEqual(verifyVapid(d, { nowSec: NOW / 1000 }).claims.aud, 'https://web.push.apple.com');
  assert.notStrictEqual(a, d);
});
await t('連絡先は env で差し替えられる。mailto / https 以外は使わない', async () => {
  P._resetPushStateForTest();
  const kv = makeKV();
  await P.getVapid({ BOATRACE_KV: kv }, true);
  const h1 = await P.vapidAuthorization({ BOATRACE_KV: kv, PUSH_CONTACT: 'https://example.test/app/' }, 'https://fcm.googleapis.com', NOW);
  assert.strictEqual(verifyVapid(h1, { nowSec: NOW / 1000 }).claims.sub, 'https://example.test/app/');
  P._resetPushStateForTest();
  const h2 = await P.vapidAuthorization({ BOATRACE_KV: kv, PUSH_CONTACT: 'javascript:alert(1)' }, 'https://fcm.googleapis.com', NOW);
  assert.ok(/^https:\/\//.test(verifyVapid(h2, { nowSec: NOW / 1000 }).claims.sub));
});

await t('鍵が無ければ証明は作れない（送信の時に鍵を作らない）', async () => {
  P._resetPushStateForTest();
  const kv = makeKV();
  await assert.rejects(() => P.vapidAuthorization({ BOATRACE_KV: kv }, 'https://fcm.googleapis.com', NOW), /no vapid key/);
  assert.strictEqual(kv._puts.length, 0);
});

console.log(`\n合計: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
