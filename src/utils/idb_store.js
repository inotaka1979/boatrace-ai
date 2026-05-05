// P1-B2 (Epic 13): IndexedDB ベース KV store
//
// 目的: localStorage 5MB クォータを racerDB(~1.5MB) + 他で圧迫している。
//       大型データを IDB に逃がし、localStorage は小型 settings/history 専用に。
//
// 設計:
//   - 単一 DB "boatrace_idb"、単一 store "kv"（key/value 形式）
//   - Promise ベース API: idbGet / idbPut / idbDelete / idbKeys / idbBytes
//   - 起動時 migration: localStorage に大型データがあれば IDB に移して LS から削除
//   - failure-soft: IDB 不可環境（古い iOS 等）では何もしない（呼出側は LS fallback）
//
// 利用方針:
//   IDB に置く: racerDB / stadiumDB / pairwiseDB / motorStats / exhibitionStats
//   LS のまま : settings / history / weights / featurestats / platt / errors
//
// 書込パターン:
//   既存コードは同期 saveDB() を呼ぶ → IDB は async なので fire-and-forget。
//   失敗時は reportError で UI 露出。

'use strict';

const IDB_NAME = 'boatrace_idb';
const IDB_STORE = 'kv';
const IDB_VERSION = 1;
const IDB_KEYS_LARGE = ['boatrace_racerDB', 'boatrace_stadiumDB', 'boatrace_pairwiseDB',
                        'boatrace_motorStats', 'boatrace_exhibitionStats'];

let _idbInstance = null;
let _idbAvailable = (typeof indexedDB !== 'undefined');

function _openIDB() {
  if (_idbInstance) return Promise.resolve(_idbInstance);
  if (!_idbAvailable) return Promise.reject(new Error('IDB unavailable'));
  return new Promise(function (resolve, reject) {
    let req;
    try { req = indexedDB.open(IDB_NAME, IDB_VERSION); }
    catch (e) { _idbAvailable = false; reject(e); return; }
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = function () {
      _idbInstance = req.result;
      _idbInstance.onversionchange = function () { try { _idbInstance.close(); } catch (_) {} _idbInstance = null; };
      resolve(_idbInstance);
    };
    req.onerror = function () { reject(req.error); };
    req.onblocked = function () { reject(new Error('IDB blocked')); };
  });
}

function idbGet(key) {
  return _openIDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = function () { resolve(req.result === undefined ? null : req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }).catch(function () { return null; });
}

function idbPut(key, value) {
  return _openIDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(value, key);
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { reject(req.error); };
    });
  }).catch(function (e) {
    try { if (typeof reportError === 'function') reportError({ type:'warn', msg:'idbPut failed: '+(e&&e.message||'unknown'), key:key }); } catch (_) {}
    return false;
  });
}

function idbDelete(key) {
  return _openIDB().then(function (db) {
    return new Promise(function (resolve) {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).delete(key);
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { resolve(false); };
    });
  }).catch(function () { return false; });
}

function idbKeys() {
  return _openIDB().then(function (db) {
    return new Promise(function (resolve) {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { resolve([]); };
    });
  }).catch(function () { return []; });
}

function idbBytes() {
  // 概算: navigator.storage.estimate を使う（精密ではないが localStorage 容量バー UI 補完用）
  if (navigator && navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate().then(function (e) {
      return { usage: e.usage || 0, quota: e.quota || 0 };
    }).catch(function () { return { usage: 0, quota: 0 }; });
  }
  return Promise.resolve({ usage: 0, quota: 0 });
}

// 起動時 migration: localStorage の大型キーを IDB に移して LS を解放。
//   結果: IDB に存在 → そちらを使う / IDB 無 LS あり → IDB に書き写して LS 削除
//   呼び出し側は load → migrate → 必要なら in-memory に再代入。
function idbMigrateFromLS() {
  if (!_idbAvailable) return Promise.resolve({ migrated: [], skipped: ['idb_unavailable'], deduped: [] });
  const migrated = [];
  const errors = [];
  const deduped = [];   // Epic 28g: 既に IDB にあって LS にも残ってた重複を削除した key
  const tasks = IDB_KEYS_LARGE.map(function (key) {
    return idbGet(key).then(function (existing) {
      if (existing != null) {
        // Epic 28g: 既に IDB にあるなら LS の重複コピーを必ず削除
        //   旧コードのコメントは「削除のみ」と言ってたが return だけで何もしていなかった (バグ)
        let lsHas = false;
        try { lsHas = (localStorage.getItem(key) != null); } catch (_) {}
        if (lsHas) {
          try { localStorage.removeItem(key); deduped.push(key); } catch (_) {}
        }
        return;
      }
      let lsRaw = null;
      try { lsRaw = localStorage.getItem(key); } catch (_) {}
      if (lsRaw == null) return;
      let parsed;
      try { parsed = JSON.parse(lsRaw); } catch (_) { return; }
      if (parsed == null) return;
      return idbPut(key, parsed).then(function (ok) {
        if (ok) {
          try { localStorage.removeItem(key); } catch (_) {}
          migrated.push(key);
        } else {
          errors.push(key);
        }
      });
    });
  });
  return Promise.all(tasks).then(function () {
    return { migrated: migrated, errors: errors, deduped: deduped };
  });
}

// globalThis export
globalThis.idbGet = idbGet;
globalThis.idbPut = idbPut;
globalThis.idbDelete = idbDelete;
globalThis.idbKeys = idbKeys;
globalThis.idbBytes = idbBytes;
globalThis.idbMigrateFromLS = idbMigrateFromLS;
globalThis.IDB_KEYS_LARGE = IDB_KEYS_LARGE;
globalThis._idbAvailable = _idbAvailable;
