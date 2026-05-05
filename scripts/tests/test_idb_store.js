// Epic 13 (P1-B2): IndexedDB store の API 形状テスト
//   IDB は Node.js 標準では使えないため、shim で put/get/delete のシナリオのみ検証。
//   実際の IDB 動作は L1 WebKit smoke / L2 iOS Simulator で確認する。
//
// 実行: node scripts/tests/test_idb_store.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');
const bundleMatch = html.match(/\/\* BUILD:IDB:START \*\/[\s\S]*?\/\* BUILD:IDB:END \*\//);
if(!bundleMatch) throw new Error('BUILD:IDB bundle missing');

// 最小 IDB shim（put/get/delete のみ模倣、トランザクションは無視）
function makeShim(){
  const stores = new Map();
  function fakeReq(value){
    const r = { onsuccess:null, onerror:null, result:value };
    setTimeout(() => r.onsuccess && r.onsuccess(), 0);
    return r;
  }
  return {
    open(name, version){
      const r = { onsuccess:null, onerror:null, onupgradeneeded:null,
        result: { objectStoreNames:{contains:()=>true},
          createObjectStore(){return {}},
          transaction(){return { objectStore(){return {
            put(v,k){ stores.set(k,v); return fakeReq(true); },
            get(k){ return fakeReq(stores.has(k)?stores.get(k):undefined); },
            delete(k){ stores.delete(k); return fakeReq(true); },
            getAllKeys(){ return fakeReq([...stores.keys()]); },
          };}};},
          onversionchange:null, close(){},
        }};
      setTimeout(() => r.onsuccess && r.onsuccess(), 0);
      return r;
    },
    _stores: stores
  };
}

const shim = makeShim();
const ctx = vm.createContext({
  indexedDB: shim,
  navigator: { storage: { estimate: () => Promise.resolve({usage:1024, quota:50*1024*1024}) } },
  setTimeout: setTimeout,
  console: console,
});

vm.runInContext(bundleMatch[0], ctx);

let pass = 0, fail = 0;
function t(name, ok){ if(ok){ console.log('  PASS:', name); pass++; } else { console.log('  FAIL:', name); fail++; } }

(async () => {
  console.log('[IDB store API]');
  t('idbGet で未設定キーは null', (await ctx.idbGet('nonexistent')) === null);
  await ctx.idbPut('boatrace_racerDB', { 4444: { name: '高橋' } });
  const v = await ctx.idbGet('boatrace_racerDB');
  t('idbPut → idbGet で同値', v && v[4444] && v[4444].name === '高橋');
  await ctx.idbDelete('boatrace_racerDB');
  t('idbDelete 後は null', (await ctx.idbGet('boatrace_racerDB')) === null);

  console.log('');
  console.log('[IDB_KEYS_LARGE]');
  t('IDB_KEYS_LARGE は配列', Array.isArray(ctx.IDB_KEYS_LARGE));
  t('boatrace_racerDB を含む', ctx.IDB_KEYS_LARGE.includes('boatrace_racerDB'));
  t('boatrace_stadiumDB を含む', ctx.IDB_KEYS_LARGE.includes('boatrace_stadiumDB'));

  console.log('');
  console.log('[idbBytes (storage estimate shim)]');
  const b = await ctx.idbBytes();
  t('usage と quota を返す', _isFiniteOrZero(b.usage) && _isFiniteOrZero(b.quota));

  console.log('');
  console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})();

function _isFiniteOrZero(v){ return Number.isFinite(v) && v >= 0; }
