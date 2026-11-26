// =============================================================================
// push.js — Web Push（お気に入り選手の締切前通知を、アプリを閉じていても届ける）
// 2026-11-27（選手機能 第 3 段階 C の続き）
//
// 仕組み:
//   1. アプリが端末の「通知の宛先」(push subscription) と、お気に入り選手・何分前かを
//      POST /push/subscribe で預ける。KV の push:subs に保存する。
//   2. 本体 Worker の cron（5 分毎）が番組表を KV に書くとき、締切時刻と出場選手だけを抜き出した
//      小さな索引 push:index も書く（番組表は 600KB あり、毎分は読めない）。
//   3. 毎分の cron（PUSH_CRON）が pushTick を呼ぶ。締切の N 分前になったレースに、預かっている
//      お気に入り選手が出ていれば、その端末に通知を送る。
//
// 送信は標準仕様どおり: 本文の暗号化は RFC 8291 (aes128gcm)、送信元の証明は RFC 8292 (VAPID)。
// ライブラリは使わず WebCrypto だけで書いている（テスト: scripts/tests/test_push_crypto.mjs が
// RFC 8291 の例と 1 バイトも違わないことを確かめる）。
//
// KV のキー（本体と同じ namespace）:
//   push:subs   { v, subs: [{ id, e, p, a, f: [[登録番号, 名前]], l: 分, t }], w: { d, n } }
//   push:index  { v, r: [[場, R, 締切 (分単位の epoch), [1〜6 号艇の登録番号]]] }
//   push:sent:0 / push:sent:1
//               { d: 'YYYYMMDD', k: ['<宛先 id>:<場>_<R>'], n: 書いた回数 }   送った記録（重ねて送らないため）
//               分の偶奇で 2 つに分ける（理由は「毎分の確認」の節）
//   push:vapid  { jwk, pub, created }   送信元の鍵（初回に Worker が自分で作る。手動設定は不要）
//   push:tick   { at }                  毎分の cron が動いている記録（6 時間に 1 回だけ書く）
//
// KV の書込（無料枠 1,000 回/日を本体と共用。使い切ると本体のデータ更新まで止まるので、どれにも上限がある）:
//   索引 1〜3 回/日 / 生存記録 4 回/日 / 鍵 1 回きり
//   宛先 (push:subs): 登録・変更・解除・無くなった宛先の掃除を合わせて 1 日 PUSH_SUBS_WRITES_PER_DAY 回まで
//   送った記録: 送った回だけ。1 日 PUSH_SENT_WRITES_PER_DAY 回まで（超えたら「ちょうどの回だけ送る」に落とす）
//   毎分の確認そのものは読むだけ。
// =============================================================================

// 本体 Worker の cron（cloudflare-worker/wrangler.toml の [triggers] crons と同じ文字列。テストで一致を確かめる）。
//   worker.js の scheduled() が event.cron で振り分ける: MAIN_CRONS = データ更新、PUSH_CRON = 締切前通知の確認。
//   worker.js（入口のモジュール）には default 以外の export を置かないため、ここに置く。
export const MAIN_CRONS = ['*/5 23,0-13 * * *', '*/30 14-22 * * *'];
export const PUSH_CRON = '* * * * *';
export const PUSH_KEYS = {
  subs: 'push:subs',
  index: 'push:index',
  sent: 'push:sent',
  vapid: 'push:vapid',
  tick: 'push:tick',
};
// 何分前に知らせるか（アプリの設定と同じ選択肢。0 = 通知しない）
export const PUSH_LEADS = [0, 3, 5, 10, 15];
export const PUSH_MAX_SUBS = 30; // 預かる宛先の数
export const PUSH_MAX_FAVS = 100; // 1 宛先のお気に入り（アプリの上限と同じ）
export const PUSH_MAX_BODY = 16384; // POST 本文の上限（バイト）
export const PUSH_SUBS_WRITES_PER_DAY = 60; // push:subs を書ける回数（1 日 = UTC。KV の枠が戻る区切りと同じ）
export const PUSH_SENT_WRITES_PER_DAY = 100; // 送った記録を書ける回数（1 日、2 つの記録の合計）
export const PUSH_MAX_SENDS_PER_TICK = 6; // 1 回の確認で送る数（無料プランの CPU 10ms に収める）
export const PUSH_ATTEMPT_EVERY_MS = 120000; // 同じ通知を試すのは 2 分おき（ちょうどの回・2 分後・4 分後 …）
export const PUSH_TICK_RECORD_MS = 6 * 3600000;
export const PUSH_TEST_MAX_DELAY_SEC = 20;
export const PUSH_TEST_MIN_INTERVAL_MS = 15000;
export const PUSH_HTTP_MAX_PER_MIN = 30;
const PUSH_FETCH_TIMEOUT_MS = 8000;
const PUSH_JWT_TTL_SEC = 12 * 3600; // 送信元の証明の有効期間（仕様の上限は 24 時間）
const PUSH_NAME_MAX = 24;

// 通知の宛先として受け付けるサービス（ブラウザの push service）。これ以外の URL には送らない
//   （登録口は誰でも呼べるので、Worker を任意の URL への送信に使わせない）。
const PUSH_HOST_RULES = [
  /^fcm\.googleapis\.com$/, // Chrome / Edge / Android
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/, // Safari / iPhone（web.push.apple.com）
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/, // Edge (Windows)
];

export const PUSH_STADIUMS = [
  '', '桐生', '戸田', '江戸川', '平和島', '多摩川', '浜名湖', '蒲郡', '常滑', '津', '三国', 'びわこ', '住之江',
  '尼崎', '鳴門', '丸亀', '児島', '宮島', '徳山', '下関', '若松', '芦屋', '福岡', '唐津', '大村',
];

// ─── 小物 ─────────────────────────────────────────────────
const _enc = new TextEncoder();
export function utf8(s) {
  return _enc.encode(s);
}

export function concatBytes() {
  let n = 0;
  for (let i = 0; i < arguments.length; i++) n += arguments[i].length;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < arguments.length; i++) {
    out.set(arguments[i], o);
    o += arguments[i].length;
  }
  return out;
}

export function b64uEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// base64url（= や + / が混じっていても受ける）→ バイト列。読めなければ null
export function b64uDecode(str) {
  if (typeof str !== 'string') return null;
  const s = str.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  let bin;
  try {
    bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  } catch (_) {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jstYmd(ms) {
  return new Date(ms + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
}

function utcYmd(ms) {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}

function jstHm(ms) {
  return new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
}

// 番組表の締切 'YYYY-MM-DD HH:MM:SS'（日本時間）→ epoch ms。読めなければ null
export function parseJstMs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(typeof s === 'string' ? s : '');
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+09:00`);
  return Number.isFinite(ms) ? ms : null;
}

function jsonRes(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function kvGetJson(env, key) {
  try {
    const raw = await env.BOATRACE_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

// 読んでから書き戻す文書（宛先・送った記録・鍵）用。{ ok: 読めたか, value: 中身（無ければ null）}。
//   「読めなかった」（KV の障害・読込枠切れ）と「まだ無い」を区別する。読めなかったのに空として扱うと、
//   次の書込で、それまでの中身（預かっている宛先の全部・送信元の鍵）を消してしまう。
//   中身が JSON として読めない場合は、無いものとして作り直す（残しても使えない）。
async function kvRead(env, key) {
  let raw;
  try {
    raw = await env.BOATRACE_KV.get(key);
  } catch (_) {
    return { ok: false, value: null };
  }
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (_) {
    return { ok: true, value: null };
  }
}

// ─── 本文の暗号化（RFC 8291）──────────────────────────────────
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// p256dh / auth は宛先（ブラウザ）の公開鍵と認証用の値。plaintext は Uint8Array。
//   fixed = { salt, asJwk } はテスト専用（RFC の例と同じ値で同じ出力になることを確かめる）。
//   返り値は push service に POST する本文（Content-Encoding: aes128gcm）。
export async function encryptPushPayload(p256dh, auth, plaintext, fixed) {
  const uaPub = typeof p256dh === 'string' ? b64uDecode(p256dh) : p256dh;
  const authSecret = typeof auth === 'string' ? b64uDecode(auth) : auth;
  if (!uaPub || uaPub.length !== 65 || uaPub[0] !== 4) throw new Error('bad p256dh');
  if (!authSecret || authSecret.length !== 16) throw new Error('bad auth');
  if (plaintext.length > 3993) throw new Error('payload too large');
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  let asPriv;
  let asPub;
  if (fixed && fixed.asJwk) {
    asPriv = await crypto.subtle.importKey('jwk', fixed.asJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    asPub = concatBytes(new Uint8Array([4]), b64uDecode(fixed.asJwk.x), b64uDecode(fixed.asJwk.y));
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPriv = pair.privateKey;
    asPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  // 共有した値と認証用の値を混ぜる: HKDF(salt = auth, IKM = ecdh, info = "WebPush: info" 0x00 ua as)
  const ikm = await hkdf(authSecret, ecdh, concatBytes(utf8('WebPush: info\0'), uaPub, asPub), 32);
  const salt = fixed && fixed.salt ? fixed.salt : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // 1 レコードだけ。平文の後ろに区切りの 0x02（最後のレコードの印）
  const record = concatBytes(plaintext, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, record));
  // 先頭 86 バイト: salt(16) | レコード長 4096 (4) | 鍵の長さ 65 (1) | 送信側の公開鍵 (65)
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = 65;
  return concatBytes(head, asPub, cipher);
}

// RFC 8291 の例（付録 A）。本番の実行環境でも同じ出力になることを /push/selftest で確かめる
export const RFC8291_EXAMPLE = {
  plaintext: 'When I grow up, I want to be a watermelon',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_' +
    'yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

export async function pushSelfTest() {
  const ex = RFC8291_EXAMPLE;
  const pub = b64uDecode(ex.asPublic);
  const asJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: ex.asPrivate,
  };
  const body = await encryptPushPayload(ex.p256dh, ex.auth, utf8(ex.plaintext), { salt: b64uDecode(ex.salt), asJwk });
  return b64uEncode(body) === ex.body;
}

// ─── 送信元の鍵と証明（RFC 8292 VAPID）─────────────────────────────
let _vapid = null; // { jwk, pub, key }（isolate の中だけの控え）

function vapidFromJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) return null;
  const x = b64uDecode(jwk.x);
  const y = b64uDecode(jwk.y);
  if (!x || !y || x.length !== 32 || y.length !== 32) return null;
  return { jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, pub: b64uEncode(concatBytes(new Uint8Array([4]), x, y)) };
}

// 鍵を返す。無ければ create のときだけ作って KV に書く（1 回きり）。
//   secret VAPID_JWK があればそちらを使う（任意。入れなくても動く）。
export async function getVapid(env, create) {
  if (_vapid) return _vapid;
  let v = null;
  let fresh = false;
  if (env && typeof env.VAPID_JWK === 'string' && env.VAPID_JWK) {
    try {
      v = vapidFromJwk(JSON.parse(env.VAPID_JWK));
    } catch (_) {
      v = null;
    }
  }
  if (!v && env && env.BOATRACE_KV) {
    const got = await kvRead(env, PUSH_KEYS.vapid);
    // 読めなかった時は作らない（鍵を作り直すと、それまでの宛先すべてに送れなくなる）
    if (!got.ok) return null;
    v = got.value ? vapidFromJwk(got.value.jwk) : null;
    if (!v && create) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      v = vapidFromJwk(await crypto.subtle.exportKey('jwk', pair.privateKey));
      await env.BOATRACE_KV.put(PUSH_KEYS.vapid, JSON.stringify({ jwk: v.jwk, pub: v.pub, created: new Date().toISOString() }));
      fresh = true;
    }
  }
  if (!v) return null;
  v.key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  v.tokens = {};
  // 作ったばかりの鍵は控えない。別の isolate が同時に作っていた場合、KV に残るのは片方だけなので、
  //   次の呼出で KV を読み直して「残ったほう」に揃える（負けた鍵で送り続けない）。
  if (!fresh) _vapid = v;
  return v;
}

export function _resetPushStateForTest() {
  _vapid = null;
  _sentLocal = new Map();
  _httpLog = [];
  _testAt = new Map();
  _tickSeenAt = 0;
}

// 連絡先（仕様で必須。mailto: か https:）。メールアドレスは使わず、アプリの公開 URL にする
function pushContact(env) {
  const c = env && typeof env.PUSH_CONTACT === 'string' ? env.PUSH_CONTACT : '';
  return /^(https:\/\/|mailto:)/.test(c) ? c : 'https://inotaka1979.github.io/boatrace-ai/';
}

// Authorization ヘッダの値。audience は宛先の origin（https://fcm.googleapis.com など）
//   鍵はここでは作らない（作るのは /push/key だけ）。鍵が無いのに送ろうとしているなら、預かっている宛先は
//   別の鍵で作られたもので、新しい鍵で送っても push service に断られる。
export async function vapidAuthorization(env, audience, nowMs) {
  const v = await getVapid(env, false);
  if (!v) throw new Error('no vapid key');
  const nowSec = Math.floor(nowMs / 1000);
  const hit = v.tokens[audience];
  if (hit && hit.exp - nowSec > 600) return 'vapid t=' + hit.jwt + ', k=' + v.pub;
  const exp = nowSec + PUSH_JWT_TTL_SEC;
  const head = b64uEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(utf8(JSON.stringify({ aud: audience, exp, sub: pushContact(env) })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, utf8(head + '.' + claims)));
  const jwt = head + '.' + claims + '.' + b64uEncode(sig);
  v.tokens[audience] = { jwt, exp };
  return 'vapid t=' + jwt + ', k=' + v.pub;
}

// ─── 宛先の検証と保存 ───────────────────────────────────────
function extraHosts(env) {
  // テスト用（手元の疑似 push service）。本番では設定しない
  const s = env && typeof env.PUSH_EXTRA_HOSTS === 'string' ? env.PUSH_EXTRA_HOSTS : '';
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
}

export function pushEndpointOk(endpoint, env) {
  if (typeof endpoint !== 'string' || endpoint.length < 20 || endpoint.length > 1024) return false;
  let u;
  try {
    u = new URL(endpoint);
  } catch (_) {
    return false;
  }
  if (u.username || u.password) return false;
  const extra = extraHosts(env);
  if (extra.indexOf(u.host) >= 0) return true; // host は port を含む（テストの http://127.0.0.1:PORT 用）
  if (u.protocol !== 'https:' || u.port) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOST_RULES.some((re) => re.test(host));
}

export async function pushSubId(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(endpoint)));
  let s = '';
  for (let i = 0; i < 16; i++) s += (h[i] < 16 ? '0' : '') + h[i].toString(16);
  return s;
}

function cleanName(n) {
  let s = typeof n === 'string' ? n : '';
  // 制御文字を落として 1 行に
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > PUSH_NAME_MAX ? s.slice(0, PUSH_NAME_MAX) : s;
}

// アプリから届いた登録内容 → 保存する形。おかしければ { error }
export async function normalizePushRecord(body, env, nowMs) {
  if (!body || typeof body !== 'object') return { error: 'bad_body' };
  const sub = body.sub && typeof body.sub === 'object' ? body.sub : null;
  const keys = sub && sub.keys && typeof sub.keys === 'object' ? sub.keys : null;
  if (!sub || !keys) return { error: 'bad_subscription' };
  if (!pushEndpointOk(sub.endpoint, env)) return { error: 'bad_endpoint' };
  const p = b64uDecode(keys.p256dh);
  const a = b64uDecode(keys.auth);
  if (!p || p.length !== 65 || p[0] !== 4) return { error: 'bad_key' };
  if (!a || a.length !== 16) return { error: 'bad_auth' };
  const lead = typeof body.lead === 'number' ? body.lead : typeof body.lead === 'string' && /^\d+$/.test(body.lead) ? parseInt(body.lead, 10) : NaN;
  if (PUSH_LEADS.indexOf(lead) < 0) return { error: 'bad_lead' };
  if (!Array.isArray(body.favs) || body.favs.length > PUSH_MAX_FAVS) return { error: 'bad_favs' };
  const seen = {};
  const favs = [];
  for (const f of body.favs) {
    const idRaw = Array.isArray(f) ? f[0] : f && typeof f === 'object' ? f.id : f;
    const idStr = typeof idRaw === 'number' ? String(idRaw) : typeof idRaw === 'string' ? idRaw : '';
    if (!/^\d{1,6}$/.test(idStr)) return { error: 'bad_favs' };
    const id = parseInt(idStr, 10);
    if (!id || seen[id]) continue;
    seen[id] = 1;
    favs.push([id, cleanName(Array.isArray(f) ? f[1] : f && typeof f === 'object' ? f.name : '')]);
  }
  favs.sort((x, y) => x[0] - y[0]);
  return {
    rec: { id: await pushSubId(sub.endpoint), e: sub.endpoint, p: b64uEncode(p), a: b64uEncode(a), f: favs, l: lead, t: nowMs },
  };
}

function sameRecord(x, y) {
  return x.e === y.e && x.p === y.p && x.a === y.a && x.l === y.l && JSON.stringify(x.f) === JSON.stringify(y.f);
}

// ok = 読めたか。読めなかった文書は書き戻さない（預かっている宛先を消さない）
async function loadSubs(env) {
  const got = await kvRead(env, PUSH_KEYS.subs);
  const d = got.value;
  const subs = d && Array.isArray(d.subs) ? d.subs.filter((s) => s && typeof s.id === 'string' && typeof s.e === 'string') : [];
  const w = d && d.w && typeof d.w === 'object' ? { d: String(d.w.d || ''), n: Number(d.w.n) || 0 } : { d: '', n: 0 };
  return { v: 1, subs, w, ok: got.ok };
}

// push:subs を書けるのは 1 日 PUSH_SUBS_WRITES_PER_DAY 回まで（KV の無料枠を本体と共用しているため）。
//   登録・変更・解除だけでなく、無くなった宛先の掃除もここで数える（登録口は誰でも呼べるので、
//   「登録 → 送信で 410 → 掃除」を繰り返させて枠を使わせない）。
//   日付は UTC（KV の枠が戻るのは UTC の 0 時 = 日本時間の 9 時）。
function takeSubsWrite(doc, nowMs) {
  const day = utcYmd(nowMs);
  if (doc.w.d !== day) doc.w = { d: day, n: 0 };
  if (doc.w.n >= PUSH_SUBS_WRITES_PER_DAY) return false;
  doc.w.n++;
  return true;
}

// 無くなった宛先（404 / 410）を消す。読み直してから消す（その間の登録を巻き戻さない）。
//   返り値: 'removed' / 'none'（もう無かった）/ 'skipped'（今日はもう書けない。次に 410 が返った日に消す）
async function removeGoneSubs(env, goneIds, nowMs) {
  const fresh = await loadSubs(env);
  if (!fresh.ok) return 'skipped';
  const kept = fresh.subs.filter((s) => !goneIds.has(s.id));
  if (kept.length === fresh.subs.length) return 'none';
  if (!takeSubsWrite(fresh, nowMs)) return 'skipped';
  fresh.subs = kept;
  await saveSubs(env, fresh);
  return 'removed';
}

async function saveSubs(env, doc) {
  await env.BOATRACE_KV.put(PUSH_KEYS.subs, JSON.stringify({ v: 1, subs: doc.subs, w: doc.w }));
}

// ─── 送信 ─────────────────────────────────────────────────
// 1 通送る。返り値は push service の HTTP ステータス（届かなければ 0）
export async function sendPush(env, rec, payload, opt) {
  const nowMs = (opt && opt.nowMs) || Date.now();
  let status = 0;
  try {
    const body = await encryptPushPayload(rec.p, rec.a, utf8(JSON.stringify(payload)));
    const headers = {
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(Math.max(0, Math.min(3600, Math.round((opt && opt.ttl) || 60)))),
      urgency: 'high',
      authorization: await vapidAuthorization(env, new URL(rec.e).origin, nowMs),
    };
    if (opt && opt.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opt.topic)) headers.topic = opt.topic;
    // redirect は追わない（宛先は決まった push service だけ、という検証を転送で抜けさせない）。
    //   3xx は「届かなかった」として次の回にやり直す。
    const init = { method: 'POST', headers, body, redirect: 'manual' };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(PUSH_FETCH_TIMEOUT_MS);
    }
    const res = await fetch(rec.e, init);
    status = res.status;
    try {
      if (res.body && res.body.cancel) await res.body.cancel();
    } catch (_) {}
  } catch (_) {
    status = 0;
  }
  return status;
}

// 宛先が無くなった（ブラウザが購読をやめた・期限切れ）ときの応答
function isGone(status) {
  return status === 404 || status === 410;
}
// もう一度送っても同じ結果になる応答（やり直さない）
function isFinal(status) {
  return (status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 408 && status !== 429);
}

// ─── 番組表から索引を作る ─────────────────────────────────────
export function buildPushIndex(programs) {
  const list = programs && Array.isArray(programs.programs) ? programs.programs : [];
  const rows = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const sid = Number(p.race_stadium_number);
    const rno = Number(p.race_number);
    const ms = parseJstMs(p.race_closed_at);
    if (!Number.isInteger(sid) || sid < 1 || sid > 24 || !Number.isInteger(rno) || rno < 1 || rno > 12 || ms == null) continue;
    const boats = [0, 0, 0, 0, 0, 0];
    for (const b of Array.isArray(p.boats) ? p.boats : []) {
      const bn = b ? Number(b.racer_boat_number) : 0;
      const t = b ? Number(b.racer_number) : 0;
      if (Number.isInteger(bn) && bn >= 1 && bn <= 6 && Number.isInteger(t) && t > 0) boats[bn - 1] = t;
    }
    rows.push([sid, rno, Math.round(ms / 60000), boats]);
  }
  rows.sort((x, y) => x[2] - y[2] || x[0] - y[0] || x[1] - y[1]);
  return { v: 1, r: rows };
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// 本体の cron から呼ぶ。中身が変わった時だけ書く。返り値は { races, wrote }
export async function writePushIndex(env, programs) {
  const idx = buildPushIndex(programs);
  if (!idx.r.length) return { races: 0, wrote: false };
  const body = JSON.stringify(idx);
  const hash = fnv1a(body);
  try {
    const prev = await env.BOATRACE_KV.getWithMetadata(PUSH_KEYS.index, { type: 'stream' });
    if (prev && prev.value && prev.value.cancel) prev.value.cancel().catch(() => {});
    if (prev && prev.metadata && prev.metadata.hash === hash) return { races: idx.r.length, wrote: false };
  } catch (_) {
    // 比べられない（KV を読めない）時は書かない。索引はめったに変わらないので、読めるようになってから書けば足りる。
    //   書くことにすると、読めない間はデータ更新のたび（5 分毎）に 1 回書き、本体と共用の書込枠を使ってしまう。
    return { races: idx.r.length, wrote: false, unreadable: true };
  }
  await env.BOATRACE_KV.put(PUSH_KEYS.index, body, { expirationTtl: 86400 * 3, metadata: { hash, wrote_at: new Date().toISOString() } });
  return { races: idx.r.length, wrote: true };
}

// ─── 毎分の確認 ────────────────────────────────────────────
let _sentLocal = new Map(); // '<id>:<場>_<R>' → 締切 (ms)。同じ isolate で続けて動いた時の控え

function notificationFor(sid, rno, closedMs, tickMs, who) {
  const mins = Math.max(0, Math.round((closedMs - tickMs) / 60000));
  const venue = PUSH_STADIUMS[sid] || '場' + sid;
  return {
    t: 'まもなく締切 ' + venue + ' ' + rno + 'R（あと ' + mins + ' 分）',
    b: who.map((w) => w[0] + '号艇' + (w[1] ? ' ' + w[1] : '')).join('、') + '　締切 ' + jstHm(closedMs),
    g: 'boatrace-fav-' + sid + '-' + rno,
    d: { sid, rno },
  };
}

// いま送るもの。subs / index は KV の中身、sentKeys は送った記録（Set か null）。
//   締切の N 分前ちょうどの回に送る。送り損ね（cron の欠け・登録が直前だった・一時的な失敗）は、
//   その 2 分後・4 分後 … の回に、締切まで拾い直す（late = ちょうどの回からの経過 ms）。
//   拾い直しで送るのは 1 回きり（pushTick が、送る前に記録する）。
//   同じ通知を試す回を 2 分おきにしているのは、送った記録 (KV) の読み遅れに備えるため:
//   KV は、書いた内容がほかの場所から読めるようになるまで 60 秒ほどかかることがある（Cloudflare の説明では
//   「60 秒かそれ以上」）。次に試すのを 2 分後にしておけば、前の回が書いた記録はまず読める
//   （isolate が替わっても重ねて送らない）。それより遅れた場合でも、拾い直しは 1 回きりなので重なるのは 1 通まで。
//   返り値は締切の近い順。
export function duePushes(subs, index, tickMs, sentKeys) {
  const rows = index && Array.isArray(index.r) ? index.r : [];
  const out = [];
  for (const s of subs) {
    const lead = Number(s.l);
    if (!(lead > 0) || !Array.isArray(s.f) || !s.f.length) continue;
    const fav = new Map();
    for (const f of s.f) fav.set(Number(f[0]), typeof f[1] === 'string' ? f[1] : '');
    for (const r of rows) {
      // 形のおかしい行は飛ばす（1 行のせいで、その回の通知が全部止まらないように）
      if (!Array.isArray(r) || !Array.isArray(r[3]) || !Number.isFinite(r[2])) continue;
      const closedMs = r[2] * 60000;
      if (closedMs <= tickMs) continue; // 締切を過ぎた
      const dueMs = closedMs - lead * 60000;
      if (dueMs > tickMs) continue; // まだ
      const late = tickMs - dueMs;
      if (late % PUSH_ATTEMPT_EVERY_MS !== 0) continue; // 試す回ではない（上の説明）
      const key = s.id + ':' + r[0] + '_' + r[1];
      if (sentKeys && sentKeys.has(key)) continue;
      const who = [];
      for (let i = 0; i < 6; i++) if (fav.has(r[3][i])) who.push([i + 1, fav.get(r[3][i])]);
      if (!who.length) continue;
      out.push({ key, sub: s, sid: r[0], rno: r[1], closedMs, late, payload: notificationFor(r[0], r[1], closedMs, tickMs, who) });
    }
  }
  out.sort((x, y) => x.closedMs - y.closedMs || x.sid - y.sid || x.rno - y.rno);
  return out;
}

let _tickSeenAt = 0; // この isolate が知っている最後の記録時刻（KV を毎分読まないため）

async function recordTick(env, nowMs) {
  if (_tickSeenAt && nowMs - _tickSeenAt >= 0 && nowMs - _tickSeenAt < PUSH_TICK_RECORD_MS) return false;
  try {
    const got = await kvRead(env, PUSH_KEYS.tick);
    // 読めない時は書かない（読めない間、isolate が替わるたびに 1 回ずつ書いて、本体と共用の書込枠を使わないように）
    if (!got.ok) return false;
    const prev = got.value;
    const at = prev && prev.at ? Date.parse(prev.at) : NaN;
    if (Number.isFinite(at) && nowMs - at >= 0 && nowMs - at < PUSH_TICK_RECORD_MS) {
      _tickSeenAt = at;
      return false;
    }
    await env.BOATRACE_KV.put(PUSH_KEYS.tick, JSON.stringify({ at: new Date(nowMs).toISOString() }));
    _tickSeenAt = nowMs;
    return true;
  } catch (_) {
    return false;
  }
}

// 送った記録。分の偶奇で 2 つの文書に分ける（push:sent:0 / push:sent:1）。
//   ある回が書くのは、その回の分の偶奇の文書だけ。同じ文書を次に読み書きするのは 2 分後の回になるので、
//   KV の読み遅れ（60 秒ほど）で「前の回の記録が入っていない古い中身」を読んで上書きすることを避けられる。
//   1 つの文書にまとめると、続く 2 つの回（別のレースを 1 分違いで送った時）が同じ文書を読み書きし、
//   後の回が古い中身に自分の分だけ足して書き戻して、前の回の記録を消すことがある。
//   読むのは 2 つとも（何分前かを奇数分だけ変えると、同じレースの記録がもう一方に入っているため）。
function sentKey(parity) {
  return PUSH_KEYS.sent + ':' + parity;
}

// その日（日本時間）の記録 { k: [キー], n: 書いた回数, ok: 読めたか }。前日の文書は空として扱う
async function loadSent(env, parity, day) {
  const got = await kvRead(env, sentKey(parity));
  const d = got.value;
  if (!d || d.d !== day) return { k: [], n: 0, ok: got.ok };
  const n = Number(d.n);
  return { k: Array.isArray(d.k) ? d.k.filter((x) => typeof x === 'string') : [], n: Number.isFinite(n) && n > 0 ? n : 0, ok: true };
}

// 毎分の cron から呼ぶ。scheduledTime は cron の予定時刻 (ms)。
export async function pushTick(env, scheduledTime) {
  const out = { subs: 0, due: 0, sent: 0, failed: 0, gone: 0 };
  if (!env || !env.BOATRACE_KV) return out;
  const nowMs = typeof scheduledTime === 'number' && scheduledTime > 0 ? scheduledTime : Date.now();
  const tickMs = Math.floor(nowMs / 60000) * 60000;
  await recordTick(env, nowMs);
  const doc = await loadSubs(env);
  out.subs = doc.subs.length;
  if (!doc.subs.length) return out;
  const index = await kvGetJson(env, PUSH_KEYS.index);
  if (!index) return out;

  // 記録を読むのは、送るものがありそうな時だけ
  let due = duePushes(doc.subs, index, tickMs, null);
  if (!due.length) return out;
  const day = jstYmd(tickMs);
  const parity = Math.floor(tickMs / 60000) % 2;
  const docs = await Promise.all([loadSent(env, 0, day), loadSent(env, 1, day)]);
  const mine = docs[parity];
  const sent = new Set(docs[0].k.concat(docs[1].k));
  const local = [];
  for (const [k, closed] of _sentLocal) {
    if (closed <= tickMs) _sentLocal.delete(k);
    else {
      sent.add(k);
      local.push(k);
    }
  }
  due = due.filter((x) => !sent.has(x.key));
  // 記録を書けない回（今日の上限に達した・記録を読めなかった）: ちょうどの回の通知だけ送る。
  //   拾い直しは、送ったかどうかを記録で確かめられないので行わない（同じ通知を重ねて送らないことを優先する）。
  //   読めなかった文書には書かない（それまでの記録を消してしまう）。
  const cap = PUSH_SENT_WRITES_PER_DAY / 2;
  const canRecord = mine.ok && mine.n < cap;
  if (!canRecord) {
    if (mine.ok) out.sent_cap = true;
    else out.sent_unreadable = true;
    due = due.filter((x) => x.late === 0);
  }
  out.due = due.length;
  if (!due.length) return out;

  let batch = due.slice(0, PUSH_MAX_SENDS_PER_TICK);
  // 記録に入れるキー。この isolate が覚えている分も入れる（前に書けなかった記録を、書ける時に残す）
  let keys = Array.from(new Set(mine.k.concat(local)));
  let writes = canRecord ? mine.n : cap; // 書けない回は、後の記録も書かない
  const record = async (more) => {
    const next = Array.from(new Set(keys.concat(more)));
    await env.BOATRACE_KV.put(sentKey(parity), JSON.stringify({ d: day, k: next, n: writes + 1 }), { expirationTtl: 86400 * 2 });
    keys = next;
    writes++;
  };

  // 拾い直し（ちょうどの回より後に送るもの）は、先に記録してから送る。記録を書けなければ送らない。
  //   後から記録する形だと、KV に書けない間（1 日の書込枠を使い切った日など）、isolate が替わるたびに
  //   「まだ送っていない」と見えて 2 分おきに送り直す。先に書けば、何があっても拾い直しは 1 回きり。
  //   （ちょうどの回は逆に、送ってから記録する: 記録を書けなくても、通知そのものは届ける。）
  const retry = batch.filter((x) => x.late > 0);
  if (retry.length) {
    try {
      await record(retry.map((x) => x.key));
      for (const x of retry) _sentLocal.set(x.key, x.closedMs);
    } catch (_) {
      out.sent_record_failed = true;
      batch = batch.filter((x) => x.late === 0);
    }
  }
  if (!batch.length) return out;

  const statuses = await Promise.all(
    batch.map((x) =>
      sendPush(env, x.sub, x.payload, {
        nowMs,
        ttl: Math.max(30, Math.round((x.closedMs - nowMs) / 1000)),
        topic: 'r' + x.sid + '-' + x.rno,
      })
    )
  );
  const gone = new Set();
  const done = [];
  batch.forEach((x, i) => {
    const st = statuses[i];
    if (isGone(st)) gone.add(x.sub.id);
    if (st >= 200 && st < 300) out.sent++;
    else out.failed++;
    // ちょうどの回: 送れた・やり直しても同じ結果のものは覚える。一時的な失敗（5xx・時間切れ）は覚えず、
    //   2 分後の回に 1 回だけ拾い直す
    if (x.late === 0 && isFinal(st)) {
      _sentLocal.set(x.key, x.closedMs);
      done.push(x.key);
    }
  });
  out.gone = gone.size;
  if (done.length && writes < cap) {
    try {
      await record(done);
    } catch (_) {
      out.sent_record_failed = true;
    }
  }
  if (gone.size) {
    try {
      if ((await removeGoneSubs(env, gone, nowMs)) === 'skipped') out.gone_cleanup_skipped = true;
    } catch (_) {
      out.gone_cleanup_failed = true;
    }
  }
  return out;
}

// ─── HTTP の口（/push/*）────────────────────────────────────
let _httpLog = [];
let _testAt = new Map();

function httpAllowed(nowMs) {
  _httpLog = _httpLog.filter((t) => nowMs - t < 60000);
  if (_httpLog.length >= PUSH_HTTP_MAX_PER_MIN) return false;
  _httpLog.push(nowMs);
  return true;
}

async function readBody(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > PUSH_MAX_BODY) return { error: 'too_large' };
  let text;
  try {
    text = await request.text();
  } catch (_) {
    return { error: 'bad_body' };
  }
  if (text.length > PUSH_MAX_BODY) return { error: 'too_large' };
  try {
    return { body: JSON.parse(text) };
  } catch (_) {
    return { error: 'bad_json' };
  }
}

// opt.allowedOrigins: ブラウザから呼べる origin（worker.js の許可リスト）
export async function handlePush(request, env, ctx, url, opt) {
  const path = url.pathname;
  const nowMs = Date.now();
  if (!env || !env.BOATRACE_KV) return jsonRes({ error: 'kv_not_bound' }, 500);

  if (request.method === 'GET') {
    if (path === '/push/key') {
      const v = await getVapid(env, true);
      return v ? jsonRes({ key: v.pub }) : jsonRes({ error: 'no_key' }, 503);
    }
    if (path === '/push/selftest') {
      let ok = false;
      let error = null;
      try {
        ok = await pushSelfTest();
      } catch (e) {
        error = String(e && e.message ? e.message : e).slice(0, 120);
      }
      return jsonRes({ ok, error }, ok ? 200 : 500);
    }
    if (path === '/push/status') {
      const doc = await loadSubs(env);
      const index = await kvGetJson(env, PUSH_KEYS.index);
      const tick = await kvGetJson(env, PUSH_KEYS.tick);
      const sentDocs = await Promise.all([loadSent(env, 0, jstYmd(nowMs)), loadSent(env, 1, jstYmd(nowMs))]);
      const vapid = await getVapid(env, false);
      const tickAt = tick && tick.at ? tick.at : null;
      return jsonRes({
        ok: true,
        // false = KV を読めていない（下の数は当てにならない。読めない間は登録・解除を受け付けない）
        kv_readable: doc.ok && sentDocs[0].ok && sentDocs[1].ok,
        key: !!vapid,
        subs: doc.subs.length,
        max_subs: PUSH_MAX_SUBS,
        index_races: index && Array.isArray(index.r) ? index.r.length : 0,
        tick_at: tickAt,
        tick_age_sec: tickAt ? Math.round((nowMs - Date.parse(tickAt)) / 1000) : null,
        sent_today: new Set(sentDocs[0].k.concat(sentDocs[1].k)).size,
        sent_writes_today: sentDocs[0].n + sentDocs[1].n,
        max_sent_writes: PUSH_SENT_WRITES_PER_DAY,
        subs_writes_today: doc.w.d === utcYmd(nowMs) ? doc.w.n : 0,
        max_subs_writes: PUSH_SUBS_WRITES_PER_DAY,
      });
    }
    return jsonRes({ error: 'not_found' }, 404);
  }

  if (request.method !== 'POST') return jsonRes({ error: 'method_not_allowed' }, 405);
  // ブラウザからは、許可した origin のアプリだけ（よそのサイトに登録を書かせない）。
  //   Origin の無い呼出（curl・デプロイ後の確認）はそのまま通す。
  const origin = request.headers.get('origin');
  if (origin && (!opt || !Array.isArray(opt.allowedOrigins) || opt.allowedOrigins.indexOf(origin) < 0)) {
    return jsonRes({ error: 'forbidden_origin' }, 403);
  }
  if (!httpAllowed(nowMs)) return jsonRes({ error: 'busy' }, 429);
  const parsed = await readBody(request);
  if (parsed.error) return jsonRes({ error: parsed.error }, parsed.error === 'too_large' ? 413 : 400);
  const body = parsed.body;

  if (path === '/push/subscribe') {
    const n = await normalizePushRecord(body, env, nowMs);
    if (n.error) return jsonRes({ error: n.error }, 400);
    const doc = await loadSubs(env);
    if (!doc.ok) return jsonRes({ error: 'kv_unavailable' }, 503);
    const i = doc.subs.findIndex((s) => s.id === n.rec.id);
    if (i >= 0 && sameRecord(doc.subs[i], n.rec)) {
      return jsonRes({ ok: true, unchanged: true, id: n.rec.id, favs: n.rec.f.length, lead: n.rec.l });
    }
    if (i < 0 && doc.subs.length >= PUSH_MAX_SUBS) return jsonRes({ error: 'full' }, 507);
    if (!takeSubsWrite(doc, nowMs)) return jsonRes({ error: 'busy' }, 429);
    if (i >= 0) doc.subs[i] = n.rec;
    else doc.subs.push(n.rec);
    await saveSubs(env, doc);
    return jsonRes({ ok: true, id: n.rec.id, favs: n.rec.f.length, lead: n.rec.l });
  }

  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint : '';
  if (!pushEndpointOk(endpoint, env)) return jsonRes({ error: 'bad_endpoint' }, 400);
  const id = await pushSubId(endpoint);

  if (path === '/push/unsubscribe') {
    const doc = await loadSubs(env);
    if (!doc.ok) return jsonRes({ error: 'kv_unavailable' }, 503);
    const kept = doc.subs.filter((s) => s.id !== id);
    if (kept.length === doc.subs.length) return jsonRes({ ok: true, unchanged: true });
    if (!takeSubsWrite(doc, nowMs)) return jsonRes({ error: 'busy' }, 429);
    doc.subs = kept;
    await saveSubs(env, doc);
    return jsonRes({ ok: true });
  }

  if (path === '/push/test') {
    const doc = await loadSubs(env);
    // 読めなかった時に「登録が無い」(404) と答えると、アプリが登録し直そうとする
    if (!doc.ok) return jsonRes({ error: 'kv_unavailable' }, 503);
    const rec = doc.subs.find((s) => s.id === id);
    if (!rec) return jsonRes({ error: 'not_registered' }, 404);
    const last = _testAt.get(id) || 0;
    if (nowMs - last < PUSH_TEST_MIN_INTERVAL_MS) return jsonRes({ error: 'busy' }, 429);
    _testAt.set(id, nowMs);
    const d = Number(body.delay);
    const delaySec = Number.isFinite(d) ? Math.max(0, Math.min(PUSH_TEST_MAX_DELAY_SEC, Math.round(d))) : 0;
    // アプリを閉じて（= この応答を待たずに）確かめられるよう、送るところまでを waitUntil に載せる
    const job = (async () => {
      if (delaySec) await new Promise((r) => setTimeout(r, delaySec * 1000));
      return sendPush(
        env,
        rec,
        { t: 'テスト通知', b: 'この通知が届けば設定は完了です。', g: 'boatrace-test', d: {} },
        { ttl: 120, topic: 'test' }
      );
    })();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job.catch(() => 0));
    const status = await job.catch(() => 0);
    if (isGone(status)) {
      // 宛先が無くなっていた（アプリ側で登録し直してもらう）
      try {
        await removeGoneSubs(env, new Set([id]), Date.now());
      } catch (_) {}
    }
    return jsonRes({ ok: status >= 200 && status < 300, status, delay: delaySec });
  }

  return jsonRes({ error: 'not_found' }, 404);
}
