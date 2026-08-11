// Analysis 層: 確率分布 → 買い目の変換。EV/Kelly 選択、Plackett–Luce 分布構築、
// オッズ乖離、穴候補抽出、method 別 (ev/prob/box/formation) 買い目生成。
//
// PR-2 (2026-07-26): assets/app.js / assets/worker_predictor.js に二重に存在して
// いた手動コピーを撲滅するため src 化。build/build.mjs が IIFE bundle して
//   /* BUILD:ANALYSIS_BET_GENERATION:START */ ... :END */
// に注入し、worker twin sources にも登録されるため worker_predictor.js の
// WORKER_TWIN_SYNCED 領域へ自動同期される（手動コピー禁止）。
// split_app.py の REST_ONLY_BUILD_MARKERS 登録済 → critical bundle には載せない。
//
// 依存 (globalThis 経由): TUNING / _plackettLuceTrifectaProb / _plackettLuceExactaProb
//
// Public: selectBetsByEV / calcOddsDivergence / buildTrifectaProbDist /
//         buildExactaProbDist / _pickAnaCandidates / generateBetsV2

'use strict';

/**
 * EV ベースで買い目を選定。
 * @param probs   {Object<combo, prob>}
 * @param odds    {Object<combo, odds>}
 * @param opt     {evMin, maxBets, kellyFrac, bankroll}
 * @returns       Array<{combo, ev, prob, odds, stakeRatio, stakeYen}>
 */
function selectBetsByEV(probs, odds, opt){
  opt = opt || {};
  var K = (typeof TUNING !== 'undefined' && TUNING.KELLY) ? TUNING.KELLY : {};
  var evMin = opt.evMin != null ? opt.evMin : 1.15;
  var maxBets = opt.maxBets != null ? opt.maxBets : 8;
  var kellyFrac = opt.kellyFrac != null ? opt.kellyFrac
                : (K.DEFAULT_FRAC != null ? K.DEFAULT_FRAC : 0.25);
  var bankroll = opt.bankroll != null ? opt.bankroll : 10000;
  if(!probs || !odds) return [];
  var rankedAll = Object.keys(probs)
    .filter(function(k){ return odds[k] && probs[k] > 0; })
    .map(function(k){
      return { combo: k, prob: probs[k], odds: odds[k], ev: probs[k] * odds[k] };
    })
    .filter(function(b){ return b.ev >= evMin; })
    .sort(function(a, b){ return b.ev - a.ev; });
  // P1-A6: 高EV案件は厳選するほど ROI が安定する（プロの定石）。
  //   平均 EV が高いほど maxBets を圧縮（既存 maxBets を上限としつつ更に絞る）
  var avgEv = rankedAll.length ? rankedAll.reduce(function(s,b){return s+b.ev;},0)/rankedAll.length : 0;
  var dynMaxBets = (avgEv >= 1.35) ? 3
                 : (avgEv >= 1.25) ? 5
                 : (avgEv >= 1.20) ? 7
                 : maxBets;
  var ranked = rankedAll.slice(0, Math.min(maxBets, dynMaxBets));
  // Kelly: f* = (b·p - q) / b, ただし b = odds-1, q = 1-p
  ranked.forEach(function(b){
    var bn = b.odds - 1;
    if(bn <= 0){ b.stakeRatio = 0; return; }
    var f = (bn * b.prob - (1 - b.prob)) / bn;
    b.stakeRatio = Math.max(0, f * kellyFrac);
  });
  // PB-9: 排他事象 Kelly — 同一レース内 3連単 N 点は最大 1 点しか当たらない。
  //       単純合計 ∑f_i は資金全投入を超えうるため、上限 MAX_STAKE_RATIO（=0.05）
  //       を超えたら比例縮小。
  var sumRatio = ranked.reduce(function(s,b){return s + (b.stakeRatio||0);}, 0);
  var maxRatio = K.MAX_STAKE_RATIO != null ? K.MAX_STAKE_RATIO : 0.05;
  if(sumRatio > maxRatio && sumRatio > 0){
    var scale = maxRatio / sumRatio;
    ranked.forEach(function(b){ b.stakeRatio *= scale; });
  }
  // S-04 FIX (2026-07-26): 「賭けない」を出力できるようにする。旧 Math.max(100,...)
  //   は f*≈0 の買い目にも ¥100 を強制していた。Kelly の「賭けない」結論を尊重し、
  //   MIN_STAKE_RATIO 未満は候補から除外（¥100 床を撤去）。stakeSuppressed は
  //   ENABLE_STAKE_SUGGESTION が false の間 UI に賭け金を出さないためのフラグ。
  var minRatio = K.MIN_STAKE_RATIO != null ? K.MIN_STAKE_RATIO : 0.005;
  ranked = ranked.filter(function(b){ return (b.stakeRatio||0) >= minRatio; });
  var suppressed = K.ENABLE_STAKE_SUGGESTION !== true;
  ranked.forEach(function(b){
    b.stakeYen = Math.round(bankroll * b.stakeRatio / 100) * 100;   // 床なし
    b.stakeSuppressed = suppressed;
  });
  return ranked;
}

/**
 * 各艇の AI 確率 vs 市場確率（人気）の乖離を計算。
 * delta > 0 → AI が高評価（過小評価＝妙味）
 * delta < 0 → AI が低評価（過大評価＝危険）
 */
function calcOddsDivergence(aiProbsByBoat, oddsWin){
  if(!oddsWin) return null;
  // FIX (2026-08-11): 単勝オッズからの implied probability は「全 6 艇のオッズが
  //   揃っている」ことが前提。欠落艇を確率 0 として扱うと、存在する艇の市場確率が
  //   水増しされ、判定が反転する。実例: win={'1':1.0} のみのとき sumInv=1.0 →
  //   1 号艇 market=1.00 / 他 0.00 となり、本命に「⚠過大評価」、他全艇に
  //   「🎯妙味」が付く。本日データでは 288 レース中 177 レースが部分取得だった。
  //   欠落は「市場の主張」ではなく単なる未取得なので、揃うまで判定しない。
  var have = 0;
  for(var bc=1; bc<=6; bc++){ if(oddsWin[String(bc)] > 0) have++; }
  if(have < 6) return null;
  var sumInv = 0;
  for(var b=1; b<=6; b++){ if(oddsWin[String(b)]) sumInv += 1 / oddsWin[String(b)]; }
  if(sumInv === 0) return null;
  var result = {};
  for(var b2=1; b2<=6; b2++){
    var ai = aiProbsByBoat[b2-1] || 0;
    var market = oddsWin[String(b2)] ? (1/oddsWin[String(b2)]) / sumInv : 0;
    result[b2] = {
      ai_prob: ai,
      market_prob: market,
      delta: ai - market,
      ev: oddsWin[String(b2)] ? ai * oddsWin[String(b2)] : null,
    };
  }
  return result;
}

/**
 * PB-4: Plackett–Luce モデルで 3連単 / 2連単確率を計算
 *   旧: p_i * p_j * p_k * 6 （簡易補正） → 順序付き選択時の系統バイアス
 *   新: p_i * p_j/(1-p_i) * p_k/(1-p_i-p_j)
 *       1 着が決まった後の残り 5 艇に確率を再分配する正攻法
 *   これにより EV/Kelly が「美味しく見える組合せ」を選ぶバイアスを除去
 */
// _plackettLuceTrifectaProb / _plackettLuceExactaProb は src/analysis/backtest.js に移動 (Phase 2c)
// → BUILD:ANALYSIS_BACKTEST bundle 経由で globalThis に export 済

/**
 * 確率順マーク列から { "1-2-3": prob, ... } 形式の3連単確率分布を生成（PL モデル）
 */
function buildTrifectaProbDist(marks){
  var p = marks.map(function(m){return m.prob||0;});
  var dist = {};
  for(var i=0;i<marks.length;i++){
    for(var j=0;j<marks.length;j++){
      if(j===i) continue;
      for(var k=0;k<marks.length;k++){
        if(k===i || k===j) continue;
        var key = marks[i].boat + '-' + marks[j].boat + '-' + marks[k].boat;
        dist[key] = _plackettLuceTrifectaProb(p, i, j, k);
      }
    }
  }
  return dist;
}
function buildExactaProbDist(marks){
  var p = marks.map(function(m){return m.prob||0;});
  var dist = {};
  for(var i=0;i<marks.length;i++){
    for(var j=0;j<marks.length;j++){
      if(j===i) continue;
      var key = marks[i].boat + '-' + marks[j].boat;
      dist[key] = _plackettLuceExactaProb(p, i, j);
    }
  }
  return dist;
}

/**
 * 高 EV 穴買い目を抽出（レースタイプ非依存、全レースで詳細画面に表示）
 * 主候補: オッズ ≥ minOdds かつ EV ≥ minEV
 * フォールバック: 主候補が無いときは オッズ ≥ minOddsLoose の中から EV 降順で topN
 *                （EV<1 でも候補を出して「穴予想0件」を回避）
 * @param {Array} marks - sorted marks (each {boat, prob})
 * @param {Object} oddsMap - { "1-2-3": odds, ... }
 * @param {Object} opts - { minOdds:30, minEV:1.0, minOddsLoose:15, topN:3 }
 * @returns {{primary:Array, fallback:Array}} EV 降順
 */
function _pickAnaCandidates(marks, oddsMap, opts){
  if(!Array.isArray(marks) || marks.length<3 || !oddsMap || typeof oddsMap !== 'object') {
    return { primary: [], fallback: [] };
  }
  var o = opts || {};
  var minOdds = o.minOdds != null ? o.minOdds : 30;
  var minEV = o.minEV != null ? o.minEV : 1.0;
  var minOddsLoose = o.minOddsLoose != null ? o.minOddsLoose : 15;
  var topN = o.topN != null ? o.topN : 3;
  // B13 (2026-05-16): 推奨買い目との重複を排除するための除外 set。
  //   ユーザ報告「推奨と穴予想が同じになる」現象は、prob×odds が両方とも高い
  //   combo (例 1-2-3 odds=35) が両方のリストに出ることが原因。
  //   exclude に含まれる combo は primary/fallback どちらにも入れない。
  var excludeSet = {};
  if(Array.isArray(o.excludeCombos)){
    o.excludeCombos.forEach(function(c){ if(c) excludeSet[String(c)] = true; });
  }
  var dist = buildTrifectaProbDist(marks);
  var primary = [], loose = [];
  for(var combo in dist){
    if(!Object.prototype.hasOwnProperty.call(dist, combo)) continue;
    if(excludeSet[combo]) continue;   // B13: 推奨と重複したら穴からは除外
    var odds = oddsMap[combo];
    if(odds == null) continue;
    var prob = dist[combo];
    if(prob <= 0) continue;
    var ev = prob * odds;
    var pick = {combo: combo, prob: prob, odds: odds, ev: ev};
    if(odds >= minOdds && ev >= minEV) primary.push(pick);
    if(odds >= minOddsLoose) loose.push(pick);
  }
  primary.sort(function(a,b){ return b.ev - a.ev; });
  loose.sort(function(a,b){ return b.ev - a.ev; });
  return {
    primary: primary.slice(0, topN),
    fallback: loose.slice(0, topN),
  };
}

// ===============================================
// BET GENERATION V2 (PRESERVED)
// ===============================================
function generateBetsV2(marks,method,count3,count2){
  // S-02 FIX (2026-07-26): 1着/2着/3着を独立事象として積を取り任意定数 (×6/×2) を
  //   掛ける旧実装は Σp が race shape 依存で 0.82〜3.33 に振れていた（混戦で約 3 倍
  //   過大、超本命で約 0.8 倍過小）。さらに EV mode だけが Plackett–Luce を使い、
  //   同一 combo が mode 次第で違う確率を表示していた。両者を PL に一本化する（Σ=1）。
  var triDist = buildTrifectaProbDist(marks);   // Σ=1 (排反かつ網羅)
  var exaDist = buildExactaProbDist(marks);     // Σ=1
  var trifecta = Object.keys(triDist).map(function(c){ return {combo:c, prob:triDist[c]}; });
  var exacta = Object.keys(exaDist).map(function(c){ return {combo:c, prob:exaDist[c]}; });
  // 2連複: P(i=j) = P(i→j) + P(j→i)。旧 (p_i*p_j + p_j*p_i)*2 は同項を 2 回足した
  //   実質 4*p_i*p_j で、順序無関係という定義を満たしていなかった。
  var quinella = [];
  for(var qi=0; qi<marks.length; qi++){
    for(var qj=qi+1; qj<marks.length; qj++){
      var qa=marks[qi].boat, qb=marks[qj].boat;
      quinella.push({
        combo: Math.min(qa,qb)+'='+Math.max(qa,qb),
        prob: (exaDist[qa+'-'+qb]||0) + (exaDist[qb+'-'+qa]||0),
      });
    }
  }
  trifecta.sort(function(a,b){return b.prob-a.prob});
  exacta.sort(function(a,b){return b.prob-a.prob});
  quinella.sort(function(a,b){return b.prob-a.prob});

  var selTri,methodLabel;

  // X1: EV モード（triDist/exaDist は上で構築済 → 再計算しない）
  if(method==='ev' && arguments.length>=5){
    var raceOdds = arguments[4];   // { trifecta: {...}, exacta: {...}, win: {...} }
    var evOpt = arguments[5] || {};
    if(raceOdds && raceOdds.trifecta){
      selTri = selectBetsByEV(triDist, raceOdds.trifecta, evOpt);
    } else {
      selTri = trifecta.slice(0, count3);   // オッズ未取得時は確率順フォールバック
    }
    var selExa = [];
    if(raceOdds && raceOdds.exacta){
      selExa = selectBetsByEV(exaDist, raceOdds.exacta, evOpt);
    } else {
      selExa = exacta.slice(0, count2);
    }
    return {
      trifecta: selTri,
      exacta: selExa.slice(0, count2),
      quinella: quinella.slice(0, count2),
      methodLabel: 'EV(≥' + (evOpt.evMin||1.15) + ')',
    };
  } else if(method==='formation'){
    var top2=marks.slice(0,2).map(function(m){return m.boat});
    var top4=marks.slice(0,4).map(function(m){return m.boat});
    var top5=marks.slice(0,5).map(function(m){return m.boat});
    var formBets={};
    top2.forEach(function(a){
      top4.forEach(function(b){
        if(b===a) return;
        top5.forEach(function(c){
          if(c===a||c===b) return;
          var key=a+'-'+b+'-'+c;
          var tp=trifecta.find(function(t){return t.combo===key});
          formBets[key]=tp?tp.prob:0;
        });
      });
    });
    selTri=Object.keys(formBets).map(function(k){return{combo:k,prob:formBets[k]}}).sort(function(a,b){return b.prob-a.prob}).slice(0,count3);
    methodLabel='フォーメーション';
  } else if(method==='box'){
    var topN=count3<=6?3:4;
    var boxBoats=marks.slice(0,topN).map(function(m){return m.boat});
    var boxBets=[];
    for(var bi=0;bi<boxBoats.length;bi++){
      for(var bj=0;bj<boxBoats.length;bj++){
        if(bj===bi) continue;
        for(var bk=0;bk<boxBoats.length;bk++){
          if(bk===bi||bk===bj) continue;
          var key=boxBoats[bi]+'-'+boxBoats[bj]+'-'+boxBoats[bk];
          var tp=trifecta.find(function(t){return t.combo===key});
          boxBets.push({combo:key,prob:tp?tp.prob:0});
        }
      }
    }
    selTri=boxBets.sort(function(a,b){return b.prob-a.prob}).slice(0,count3);
    methodLabel='BOX('+topN+'艇)';
  } else {
    selTri=trifecta.slice(0,count3);
    methodLabel='確率順';
  }

  return{
    trifecta:selTri,
    exacta:exacta.slice(0,count2),
    quinella:quinella.slice(0,count2),
    methodLabel:methodLabel
  };
}
// globalThis export (REST_ONLY)
globalThis.selectBetsByEV = selectBetsByEV;
globalThis.calcOddsDivergence = calcOddsDivergence;
globalThis.buildTrifectaProbDist = buildTrifectaProbDist;
globalThis.buildExactaProbDist = buildExactaProbDist;
globalThis._pickAnaCandidates = _pickAnaCandidates;
globalThis.generateBetsV2 = generateBetsV2;
