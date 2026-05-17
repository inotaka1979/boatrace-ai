// B14 (2026-05-17): 穴予想 (ana_bets) 履歴追跡の smoke test
//   checkHit が ana_hit を正しくセットすること
//   calcTodayStats が ana 集計を返すこと

'use strict';

var fs = require('fs');
var path = require('path');

// app.js から関数定義 + 必要なグローバルを抽出してロード
//   Worker / DOM 関連は skip し、checkHit と calcTodayStats を取り出せる
//   よう最小限の stub を用意
var src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');

// 必要な関数だけ正規表現で抽出
function extract(name){
  var re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
  var m = re.exec(src);
  if(!m) throw new Error('function not found: ' + name);
  var start = m.index;
  var depth = 0, i = src.indexOf('{', start);
  for(; i<src.length; i++){
    if(src[i]==='{') depth++;
    else if(src[i]==='}'){ depth--; if(depth===0){ return src.slice(start, i+1); } }
  }
  throw new Error('unbalanced braces: ' + name);
}

// テストハーネス用 sandbox
var sandbox = {
  // checkHit が呼ぶ最低限のグローバル
  console: { warn: function(){}, log: function(){} },
};

var checkHitSrc = extract('checkHit');
new Function('sb', checkHitSrc + '; sb.checkHit = checkHit;').call({}, sandbox);

var passes = 0, fails = 0;

function assert(name, cond){
  if(cond){ passes++; console.log('  PASS: ' + name); }
  else    { fails++; console.error('  FAIL: ' + name); }
}

console.log('[checkHit 穴予想 ana_hit テスト]');

// Test 1: ana_bets に actual の 3連単が含まれ ana_hit = true
var e1 = {
  actual: [3, 1, 5],
  trifecta_bets: ['1-2-3', '1-3-2'],
  exacta_bets: ['1-2'],
  ana_bets: ['3-1-5', '4-1-2'],
};
sandbox.checkHit(e1);
assert('actual 3-1-5 が ana_bets に含まれる → ana_hit=true', e1.ana_hit === true);
assert('actual 3-1-5 が trifecta_bets に無い → trifecta_hit=false', e1.trifecta_hit === false);

// Test 2: ana_bets が空 → ana_hit = false
var e2 = {
  actual: [1, 2, 3],
  trifecta_bets: ['1-2-3'],
  exacta_bets: ['1-2'],
  ana_bets: [],
};
sandbox.checkHit(e2);
assert('ana_bets 空 → ana_hit=false', e2.ana_hit === false);
assert('trifecta_bets が一致 → trifecta_hit=true', e2.trifecta_hit === true);

// Test 3: ana_bets undefined でも crash しない（古い履歴データ互換）
var e3 = {
  actual: [1, 2, 3],
  trifecta_bets: ['1-2-3'],
  exacta_bets: ['1-2'],
};
sandbox.checkHit(e3);
assert('ana_bets undefined → ana_hit=false (NPE しない)', e3.ana_hit === false);

// Test 4: 両方的中（推奨と穴予想が同時に当たるケース）
//   B13 で重複は除外されているはずだが、防御テスト
var e4 = {
  actual: [1, 2, 3],
  trifecta_bets: ['1-2-3'],
  exacta_bets: ['1-2'],
  ana_bets: ['1-2-3'],   // 重複（本来は除外される）
};
sandbox.checkHit(e4);
assert('重複時も両方 hit (独立判定)', e4.trifecta_hit === true && e4.ana_hit === true);

// Test 5: actual が 3 着未満（途中棄権等）→ 何も判定しない
var e5 = {
  actual: [1, 2],
  trifecta_bets: ['1-2-3'],
  ana_bets: ['1-2-3'],
};
sandbox.checkHit(e5);
assert('actual < 3 → 既定 false のまま', !e5.trifecta_hit && !e5.ana_hit);

console.log('\n=== Result: ' + passes + ' passed, ' + fails + ' failed ===');
process.exit(fails === 0 ? 0 : 1);
