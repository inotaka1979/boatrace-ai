/**
 * Web Push のテスト用の小物（受け取る側 = ブラウザの役）。
 *
 *   - makeUa():      ブラウザ側の鍵と購読情報を作る
 *   - decryptPush(): 届いた本文を復号する。Worker 側（cloudflare-worker/push.js、WebCrypto）とは別の書き方
 *                    （Node の crypto モジュール）で RFC 8291 を実装してあり、送る側の誤りを相殺しない
 *   - verifyVapid(): Authorization ヘッダ（RFC 8292）の署名と中身を確かめる
 *   - makeKV():      KV の代役（put の回数を数える）
 */

import crypto from 'node:crypto';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const unb64u = (s) => Buffer.from(String(s), 'base64url');

export function makeUa(endpoint) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    publicKey: ecdh.getPublicKey(), // 65 バイト（0x04 から始まる）
    auth,
    sub: {
      endpoint: endpoint || 'https://fcm.googleapis.com/fcm/send/' + crypto.randomBytes(12).toString('hex'),
      keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) },
    },
  };
}

function hkdf(salt, ikm, info, len) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
}

// RFC 8291 / RFC 8188 (aes128gcm)。ua = { ecdh または privateKey(32 バイト), publicKey, auth }
export function decryptPush(body, ua) {
  const buf = Buffer.from(body);
  if (buf.length < 86 + 17) throw new Error('too short');
  const salt = buf.subarray(0, 16);
  const rs = buf.readUInt32BE(16);
  const idlen = buf.readUInt8(20);
  if (idlen !== 65) throw new Error('keyid length ' + idlen);
  const asPublic = buf.subarray(21, 21 + 65);
  if (asPublic[0] !== 4) throw new Error('keyid is not an uncompressed point');
  const cipher = buf.subarray(86);
  if (cipher.length > rs) throw new Error('record larger than rs');
  let ecdh = ua.ecdh;
  if (!ecdh) {
    ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(ua.privateKey);
  }
  const shared = ecdh.computeSecret(asPublic);
  const uaPublic = ua.publicKey || ecdh.getPublicKey();
  const ikm = hkdf(ua.auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  dec.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([dec.update(cipher.subarray(0, cipher.length - 16)), dec.final()]);
  // 最後のレコードは区切り 0x02、その後ろは 0 だけ
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (end < 0 || plain[end] !== 2) throw new Error('bad padding delimiter');
  return plain.subarray(0, end);
}

// 'vapid t=<jwt>, k=<公開鍵>' を確かめる。返り値 { ok, why, header, claims, k }
export function verifyVapid(authorization, opt) {
  const m = /^vapid t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(String(authorization || ''));
  if (!m) return { ok: false, why: 'format' };
  const [h, c, s] = m[1].split('.');
  const k = unb64u(m[2]);
  if (k.length !== 65 || k[0] !== 4) return { ok: false, why: 'key' };
  let header, claims;
  try {
    header = JSON.parse(unb64u(h).toString('utf8'));
    claims = JSON.parse(unb64u(c).toString('utf8'));
  } catch (_) {
    return { ok: false, why: 'json' };
  }
  const pub = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(k.subarray(1, 33)), y: b64u(k.subarray(33, 65)) },
    format: 'jwk',
  });
  const sig = unb64u(s);
  if (sig.length !== 64) return { ok: false, why: 'signature length ' + sig.length, header, claims };
  const good = crypto.verify('sha256', Buffer.from(h + '.' + c), { key: pub, dsaEncoding: 'ieee-p1363' }, sig);
  if (!good) return { ok: false, why: 'signature', header, claims };
  if (header.alg !== 'ES256' || header.typ !== 'JWT') return { ok: false, why: 'header', header, claims };
  const now = (opt && opt.nowSec) || Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { ok: false, why: 'expired', header, claims };
  if (claims.exp - now > 86400) return { ok: false, why: 'exp more than 24h ahead', header, claims };
  if (opt && opt.aud && claims.aud !== opt.aud) return { ok: false, why: 'aud', header, claims };
  if (!/^(mailto:|https:\/\/)/.test(String(claims.sub || ''))) return { ok: false, why: 'sub', header, claims };
  return { ok: true, header, claims, k: m[2] };
}

export function makeKV(opt) {
  const store = new Map();
  const puts = [];
  const o = opt || {};
  return {
    async get(k) {
      const e = store.get(k);
      return e === undefined ? null : e.value;
    },
    async getWithMetadata(k) {
      const e = store.get(k);
      return e === undefined ? { value: null, metadata: null } : { value: e.value, metadata: e.meta };
    },
    async put(k, v, options) {
      puts.push(k);
      if (o.failPut && (o.failPut === true || o.failPut(k))) throw new Error('KV put() limit exceeded for the day.');
      store.set(k, { value: v, meta: (options && options.metadata) || null });
    },
    async delete(k) {
      store.delete(k);
    },
    json(k) {
      const e = store.get(k);
      return e === undefined ? null : JSON.parse(e.value);
    },
    setJson(k, v) {
      store.set(k, { value: JSON.stringify(v), meta: null });
    },
    countPuts(k) {
      return puts.filter((x) => x === k).length;
    },
    _store: store,
    _puts: puts,
  };
}
