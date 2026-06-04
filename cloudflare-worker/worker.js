// =============================================================================
// boatrace-scrape-trigger — Cloudflare Worker (Path C — independent scrape engine)
//
// 2026-05-17 改訂 C5: openapi 経由に加え、boatrace.jp の beforeinfo HTML を
//   直接スクレイプして展示データ (exhibition_time / start_timing / course /
//   tilt / propeller / parts_replaced / adjust_weight) を取得・マージ。
//   これにより上流 mirror が遅い場合でも Worker 単独で展示を提供可能。
//
// アーキテクチャ:
//   [Worker Cron 5min]
//      ├─ openapi {programs,previews,results} → JSON 取得
//      └─ programs から「展示窓内」のレースを判定 → boatrace.jp beforeinfo
//         を直接 fetch → HTML parse → previews にマージ
//   KV (previews:today) ← マージ済 previews
//   /api/previews ← KV
//
// エンドポイント:
//   GET /health         — 疎通確認
//   GET /api/previews   — マージ済 previews
//   GET /api/programs   — programs
//   GET /api/results    — results
//   GET /api/refresh-now — 手動 refresh トリガ (デバッグ用)
//   GET /odds-proxy     — boatrace.jp odds CORS pass-through
// =============================================================================

const UPSTREAM = {
  previews: 'https://boatraceopenapi.github.io/previews/v2/today.json',
  programs: 'https://boatraceopenapi.github.io/programs/v2/today.json',
  results:  'https://boatraceopenapi.github.io/results/v2/today.json',
};
const KV_KEYS = {
  previews: 'previews:today',
  programs: 'programs:today',
  results:  'results:today',
};
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

// 展示窓: 締切時刻の 30 分前 〜 5 分後 (この間に boatrace.jp に展示データ有)
const EXHIBITION_WINDOW_BEFORE_MIN = 30;
const EXHIBITION_WINDOW_AFTER_MIN  = 5;
// 2026-05-24: 12 → 24 へ (= 同時開催最大場数)。CF subrequest 上限 50/invocation:
//   3 openapi fetch + 3 KV writes + exhibition(24) + results(24) = 54 → 50 超
//   → exhibition と results に分けて 20 ずつ (実測 fail なら 18 に下げる)。
// 旧 12 だと 1 run で 12 races しか処理できず、ピーク (12 場同時開催 + モーニング場
// 蓄積) で starve していた。
const MAX_HTML_SCRAPES_PER_RUN     = 20;

function jsonResponse(obj, opts = {}) {
  return new Response(JSON.stringify(obj), {
    status: opts.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': opts.cacheControl || 'public, max-age=30',
      ...CORS,
    },
  });
}

async function fetchUpstream(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'boatrace-scrape-worker/1.1' },
    cf: { cacheTtl: 10, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${url}`);
  return await res.json();
}

// rt-fix P1-6 (2026-06-04): KV write を「内容が変化した時のみ」に変更。
//   Cloudflare 無料枠 = 1000 writes/日。従来は毎 refresh で無条件 put し
//   948/日と上限に貼り付いていた → わずかな超過で put が throw → catch 握り潰し
//   → KV が古いまま /api/* が古いデータを 200 で返し続ける silent halt の主因。
//   data 部分（updated_at を除く）を前回値と比較し、同一なら put をスキップする。
//   これにより深夜帯など変化の少ない時間の write を大幅削減し、枠に余裕を作る。
async function kvWrite(env, key, data) {
  const now = new Date().toISOString();
  const newBody = JSON.stringify(data);
  let changed = true;
  try {
    const prev = await env.BOATRACE_KV.get(key);
    if (prev) {
      const prevObj = JSON.parse(prev);
      if (prevObj && JSON.stringify(prevObj.data) === newBody) {
        changed = false;
      }
    }
  } catch (_) {
    // 比較失敗時は安全側で書き込む
    changed = true;
  }
  const wrapped = { updated_at: now, data, _kv_skipped: !changed };
  if (changed) {
    await env.BOATRACE_KV.put(key, JSON.stringify({ updated_at: now, data }), {
      expirationTtl: 86400 * 2,
    });
  }
  // 鮮度監視は各キーに保存済みの updated_at（serveFromKV が返す）で行うため、
  // ここで別キーへ書き込む必要はない（write 枠を消費しない）。
  return wrapped;
}

// -----------------------------------------------------------------------
// HTML parser for boatrace.jp /owpc/pc/race/beforeinfo
//   Python の scripts/scrape_previews.py parse_beforeinfo() を JS に移植
// -----------------------------------------------------------------------
function stripTags(s) {
  return String(s||'').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseBeforeinfoHTML(html) {
  const boats = {};
  // 出走表+展示テーブル: 1艇 = tbody.is-fs12 (グループ化)
  const tbodyRe = /<tbody[^>]*class="[^"]*is-fs12[^"]*"[^>]*>([\s\S]*?)<\/tbody>/g;
  let tm;
  while ((tm = tbodyRe.exec(html)) !== null) {
    const tbody = tm[1];
    // 全 td を順次取得
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const tds = [];
    let mm;
    while ((mm = tdRe.exec(tbody)) !== null) tds.push(stripTags(mm[1]));
    if (tds.length < 5) continue;
    // tds[0] = 枠 (1-6)、tds[4]=展示タイム、tds[5]=チルト、tds[6]=ペラ、tds[7]=部品交換
    const bn = parseInt(tds[0]);
    if (!(bn >= 1 && bn <= 6)) continue;
    const et   = parseFloat(tds[4]) || 0;
    const tilt = parseFloat(tds[5]) || 0;
    const prop = tds[6] || '';
    const parts = tds[7] || '';
    // 調整重量: メイン行 + 2 行目 (ST 行) の td[0]、tbody 内なので追加 td 走査必要
    // tbody 内の 2 番目以降の <tr> を分解して find
    let adjW = 0;
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const trs = [];
    let trm;
    while ((trm = trRe.exec(tbody)) !== null) trs.push(trm[1]);
    if (trs.length >= 3) {
      const stTr = trs[2];   // 3 行目 = ST 行
      const stTd = /<td[^>]*>([\s\S]*?)<\/td>/.exec(stTr);
      if (stTd) {
        const txt = stripTags(stTd[1]).replace(/kg/g,'').trim();
        if (txt) adjW = parseFloat(txt) || 0;
      }
    }
    boats[bn] = {
      exhibition_time: et,
      tilt: tilt,
      propeller: prop,
      parts_replaced: parts,
      adjust_weight: adjW,
      start_timing: null,
      course: bn,
    };
  }
  if (!Object.keys(boats).length) return null;

  // スタート展示テーブル: class is-w238 の table
  const stTblRe = /<table[^>]*class="[^"]*is-w238[^"]*"[^>]*>([\s\S]*?)<\/table>/;
  const stTblM = stTblRe.exec(html);
  if (stTblM) {
    const stTbl = stTblM[1];
    const stTrRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const stTrs = [];
    let stm;
    while ((stm = stTrRe.exec(stTbl)) !== null) stTrs.push(stm[1]);
    // 先頭 2 行 (ヘッダ) skip、3 行目以降が course 1-6
    const courseRows = stTrs.slice(2, 8);
    courseRows.forEach((tr, ci) => {
      const courseNum = ci + 1;
      // 艇番: span.table1_boatImage1Number
      const bnSpanM = /<span[^>]*class="[^"]*table1_boatImage1Number[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(tr);
      const text = stripTags(tr);
      if (!text || text.indexOf('.') < 0) return;
      const isF = text.indexOf('F') >= 0;
      const clean = text.replace(/F/g, '');
      const parts = clean.split('.');
      if (parts.length !== 2) return;
      let boatNum = NaN;
      let stVal = NaN;
      try {
        const boatFromText = parseInt(parts[0]);
        stVal = parseFloat('0.' + parts[1]);
        if (isF) stVal = -stVal;
        if (bnSpanM) {
          const bnT = parseInt(stripTags(bnSpanM[1]));
          boatNum = isFinite(bnT) ? bnT : boatFromText;
        } else {
          boatNum = boatFromText;
        }
      } catch (_) {}
      if (!isFinite(boatNum) || !boats[boatNum]) return;
      boats[boatNum].course = courseNum;
      boats[boatNum].start_timing = isFinite(stVal) ? stVal : null;
    });
  }

  // 1 艇でも exhibition_time > 0 が無ければデータ無し扱い
  const hasData = Object.values(boats).some(b => (b.exhibition_time||0) > 0);
  return hasData ? boats : null;
}

async function scrapeBeforeinfo(sid, rno, hd) {
  const jcd = String(sid).padStart(2, '0');
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${rno}&jcd=${jcd}&hd=${hd}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-worker/1.1' },
    cf: { cacheTtl: 20, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`beforeinfo ${res.status}: stadium=${sid} race=${rno}`);
  const html = await res.text();
  return parseBeforeinfoHTML(html);
}

// JST 「YYYYMMDD」を Date の race_closed_at "YYYY-MM-DD HH:MM:SS" から導出
// 展示窓判定: now が [close - 30min, close + 5min] にあるか
function isInExhibitionWindow(closedAtStr, nowMs) {
  if (!closedAtStr) return false;
  // "2026-05-17 10:47:00" を JST と解釈
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(closedAtStr);
  if (!m) return false;
  // JST 時刻として組み立て (UTC=JST-9h)
  const closeJstMs = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4]-9, +m[5], +m[6]);
  const startMs = closeJstMs - EXHIBITION_WINDOW_BEFORE_MIN * 60_000;
  const endMs   = closeJstMs + EXHIBITION_WINDOW_AFTER_MIN  * 60_000;
  return nowMs >= startMs && nowMs <= endMs;
}

// レース終了後ウィンドウ判定: 締切後 N 分 〜 締切 + 6 時間 (D5a: 2h→6h 拡張)
// 締切時刻直後にレース開始 → 数分でレース終了 → 結果ページ生成
// D5a: window を 6h に拡張することで、深夜終了 SG/G1 ナイターで openapi mirror
//   の反映が遅れたケースも翌朝までスクレイプ補完可能。
//   既に openapi が finished のレースは scrapeTargets から除外されるので過剰
//   スクレイプは発生しない。
function isInResultWindow(closedAtStr, nowMs) {
  if (!closedAtStr) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(closedAtStr);
  if (!m) return false;
  const closeJstMs = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4]-9, +m[5], +m[6]);
  // 締切 +3分（レース開始〜終了）〜 +360分（6h、深夜帯 openapi 遅延吸収）
  const startMs = closeJstMs + 3 * 60_000;
  const endMs   = closeJstMs + 360 * 60_000;
  return nowMs >= startMs && nowMs <= endMs;
}

// 全角数字 → 半角数字 ("１" → 1)
function toHalfWidthInt(s) {
  if (s == null) return NaN;
  const half = String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  return parseInt(half);
}

// boatrace.jp /owpc/pc/race/raceresult ページを直接 scrape して結果取得
//   着順構造: 各順位が独立 <tbody> (1 tbody=1 tr)、tds[0]=着順 (全角数字),
//             tds[1]=艇番, tds[2]=選手名, tds[3]=タイム
//   払戻構造: <tbody> 内に複数 <tr>、ヘッダ <th> でジャンル ("3連単" 等)、tds[0]=combo, tds[1]=金額
function parseRaceresultHTML(html, stadium, raceNum, raceDate) {
  const out = {
    race_stadium_number: stadium,
    race_number: raceNum,
    race_date: raceDate,
    race_technique_number: null,
    boats: [],
    payouts: { trifecta:[], trio:[], exacta:[], quinella:[], quinella_place:[], win:[], place:[] },
  };
  // 全 tbody を抽出して、各 tbody 内の最初の tr で 着順 + 艇番 が取れるなら採用
  const tbodyRe = /<tbody[^>]*>([\s\S]*?)<\/tbody>/g;
  const tbodies = [];
  let tm;
  while ((tm = tbodyRe.exec(html)) !== null) tbodies.push(tm[1]);

  const placesSeen = new Set();
  const boatsSeen = new Set();
  for (const tbody of tbodies) {
    const trM = /<tr[^>]*>([\s\S]*?)<\/tr>/.exec(tbody);
    if (!trM) continue;
    const tr = trM[1];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const tds = [];
    let mm;
    while ((mm = tdRe.exec(tr)) !== null) tds.push(stripTags(mm[1]));
    if (tds.length < 2) continue;
    const place = toHalfWidthInt(tds[0]);
    const boatNum = toHalfWidthInt(tds[1]);
    if (!(place >= 1 && place <= 6) || !(boatNum >= 1 && boatNum <= 6)) continue;
    if (placesSeen.has(place)) continue;   // 同 place 重複防止
    if (boatsSeen.has(boatNum)) continue;  // 2026-05-24: 同 boat の重複も防止
                                            //  (payouts / 技術 tbody を誤認すると同艇が
                                            //   複数 place に出現する事故 — 常滑 7R 実例)
    placesSeen.add(place);
    boatsSeen.add(boatNum);
    let name = tds.length > 2 ? tds[2] : '';
    // selOr 内 span にレーサー番号 "4199" 等が含まれる場合があるので除去
    name = name.replace(/\s*\d{4,5}\s*/, '').trim();
    out.boats.push({
      racer_boat_number: boatNum,
      racer_place_number: place,
      racer_course_number: boatNum,   // course は raceresult からは取得困難
      racer_name: name,
      racer_start_timing: null,
      racer_number: null,
    });
    if (placesSeen.size >= 6) break;
  }

  // 2026-05-24 (致命): parse sanity check。
  //   レース完走判定 (race_technique_number=1) は以下を満たす場合のみ:
  //   - boats.length >= 3 (上位 3 着まで取得済)
  //   - place=1 (1着) が含まれる (技術タイプ "逃げ" 等は 1着必須)
  //   満たさない場合は parse 失敗扱い (race_technique_number=null) で、
  //   Worker は KV に書かない / openapi の最新を待つ。
  //   これにより常滑 7R で観測された「2着 5, 3着 5, 1着 欠落」のような
  //   garbage data が KV に居座る事故を防止。
  const hasFirstPlace = out.boats.some(b => b.racer_place_number === 1);
  if (out.boats.length >= 3 && hasFirstPlace) {
    out.race_technique_number = 1;
  } else {
    // parse 不完全 → 結果未確定扱い、書き込まない
    out.race_technique_number = null;
    if (out.boats.length > 0) {
      // diag フィールド (KV には保存されないが Worker log で原因追跡)
      out._parse_partial = { boats: out.boats.length, places: Array.from(placesSeen) };
    }
  }

  // 払戻テーブル: tbody 内の <tr> で <th> + <td>×2 を含むもの
  for (const tbody of tbodies) {
    if (tbody.indexOf('払戻') < 0 && tbody.indexOf('配当') < 0
        && tbody.indexOf('連単') < 0 && tbody.indexOf('単勝') < 0) continue;
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let trM;
    while ((trM = trRe.exec(tbody)) !== null) {
      const tr = trM[1];
      const thM = /<th[^>]*>([\s\S]*?)<\/th>/.exec(tr);
      if (!thM) continue;
      const label = stripTags(thM[1]);
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      const tds = [];
      let mm;
      while ((mm = tdRe.exec(tr)) !== null) tds.push(stripTags(mm[1]));
      if (tds.length < 2) continue;
      const combo = tds[0];
      const amountTxt = tds[1].replace(/[,円¥\s&;yen]/g, '');
      const amountM = /\d+/.exec(amountTxt);
      if (!amountM) continue;
      const amount = parseInt(amountM[0]);
      const entry = { combination: combo, amount: amount };
      if (label.indexOf('3連単') >= 0) out.payouts.trifecta.push(entry);
      else if (label.indexOf('3連複') >= 0) out.payouts.trio.push(entry);
      else if (label.indexOf('2連単') >= 0) out.payouts.exacta.push(entry);
      else if (label.indexOf('2連複') >= 0) out.payouts.quinella.push(entry);
      else if (label.indexOf('拡連複') >= 0) out.payouts.quinella_place.push(entry);
      else if (label.indexOf('単勝') >= 0) out.payouts.win.push(entry);
      else if (label.indexOf('複勝') >= 0) out.payouts.place.push(entry);
    }
  }
  return out;
}

async function scrapeRaceresult(sid, rno, hd, raceDate) {
  const jcd = String(sid).padStart(2, '0');
  const url = `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${rno}&jcd=${jcd}&hd=${hd}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-worker/1.2' },
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`raceresult ${res.status}: stadium=${sid} race=${rno}`);
  const html = await res.text();
  return parseRaceresultHTML(html, sid, rno, raceDate);
}

// 終了済かつ openapi が race_technique_number=null のレースを scrape
async function mergeBoatraceJpResults(programs, results, nowMs) {
  // 2026-05-24 fix2: openapi の results entry には race_closed_at が無いため、
  //   旧コードの sort `a.rPtr?.race_closed_at` は常に undefined < undefined === false
  //   で **sort が事実上 noop** (FIFO が機能していなかった)。programs から取った
  //   race_closed_at を target に直接 attach して sort する。
  const scrapeTargets = [];
  for (const p of (programs.programs || [])) {
    const sid = p.race_stadium_number, rno = p.race_number;
    if (!isInResultWindow(p.race_closed_at, nowMs)) continue;
    const hd = String(p.race_date || '').replace(/-/g, '');
    if (!hd) continue;
    // 該当 result entry を確認
    const r = (results.results || []).find(x =>
      x.race_stadium_number === sid && x.race_number === rno
    );
    // 2026-05-24: 完了判定を厳格化。
    //   - race_technique_number が set されている (= 着順は取得済)
    //   - **かつ** 3 連単 payout が取得済 (= 払戻も取得済)
    //   この両方が揃って初めて scrape skip。着順だけで payout 空のレースは
    //   再 scrape 対象 (「3連単的中だが払戻未取得」の警告解消)。
    const hasTechnique = r && r.race_technique_number != null;
    const hasPayouts = r && r.payouts
      && Array.isArray(r.payouts.trifecta) && r.payouts.trifecta.length > 0;
    if (hasTechnique && hasPayouts) continue;
    scrapeTargets.push({ sid, rno, hd, raceDate: p.race_date, rPtr: r, closedAt: p.race_closed_at });
  }
  // FIFO (古い順): 古いレースほど結果が確定している確率が高く + backlog drain 保証
  scrapeTargets.sort((a, b) => {
    const ca = a.closedAt || '';
    const cb = b.closedAt || '';
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return 0;
  });
  const picks = scrapeTargets.slice(0, MAX_HTML_SCRAPES_PER_RUN);
  let mergedCount = 0;
  const settled = await Promise.allSettled(
    picks.map(t => scrapeRaceresult(t.sid, t.rno, t.hd, t.raceDate).then(parsed => ({ t, parsed })))
  );
  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value.parsed) continue;
    const { t, parsed } = r.value;
    if (parsed.race_technique_number == null) continue;   // 結果ページがまだ無い
    if (t.rPtr) {
      // 上流 results 配列内のエントリをマージで上書き
      // 2026-05-24 (致命): payouts を smart merge する。
      //   Object.assign(t.rPtr, parsed) は parsed.payouts (empty arrays) で
      //   openapi の payouts を上書きしていた → 「3連単的中だが払戻未取得」
      //   の警告が大量発生していた (常滑/多摩川 等)。
      //   payouts は Worker 側 parse が空でない種別のみ更新、空なら openapi
      //   保持。
      const rPtr = t.rPtr;
      const oldPayouts = rPtr.payouts || {};
      Object.assign(rPtr, parsed);
      if (parsed.payouts && oldPayouts) {
        const mergedPayouts = {};
        const types = ['trifecta','trio','exacta','quinella','quinella_place','win','place'];
        for (const k of types) {
          const newArr = parsed.payouts[k];
          const oldArr = oldPayouts[k];
          // Worker parse が値ありならそれを採用、empty なら openapi 残存値を優先
          if (Array.isArray(newArr) && newArr.length > 0) {
            mergedPayouts[k] = newArr;
          } else if (Array.isArray(oldArr) && oldArr.length > 0) {
            mergedPayouts[k] = oldArr;
          } else {
            mergedPayouts[k] = newArr || [];
          }
        }
        rPtr.payouts = mergedPayouts;
      }
    } else {
      // results 配列に追加
      (results.results || (results.results = [])).push(parsed);
    }
    mergedCount++;
  }
  return { targets: scrapeTargets.length, scraped: picks.length, merged: mergedCount };
}

// 展示窓内かつ openapi が boats 空のレースを抽出し、boatrace.jp 直スクレイプ
async function mergeBoatraceJpExhibition(programs, previews, nowMs) {
  const scrapeTargets = [];
  const progByKey = new Map();
  for (const p of (programs.programs || [])) {
    const sid = p.race_stadium_number, rno = p.race_number;
    progByKey.set(`${sid}-${rno}`, p);
    if (!isInExhibitionWindow(p.race_closed_at, nowMs)) continue;
    // hd を抽出 ("2026-05-17" → "20260517")
    const hd = String(p.race_date || '').replace(/-/g, '');
    if (!hd) continue;
    // 該当 preview が boats 空 か確認
    const pv = (previews.previews || []).find(r =>
      r.race_stadium_number === sid && r.race_number === rno
    );
    if (!pv) continue;
    const boats = pv.boats || {};
    const hasEx = Object.values(boats).some(b => (b.racer_exhibition_time||0) > 0);
    if (hasEx) continue;   // 既に展示あり → スキップ
    scrapeTargets.push({ sid, rno, hd, pv });
  }

  // CPU 安全圏 (12 件まで)、締切が近い順
  scrapeTargets.sort((a, b) => {
    const ca = progByKey.get(`${a.sid}-${a.rno}`).race_closed_at;
    const cb = progByKey.get(`${b.sid}-${b.rno}`).race_closed_at;
    return ca < cb ? -1 : 1;
  });
  const picks = scrapeTargets.slice(0, MAX_HTML_SCRAPES_PER_RUN);

  let mergedCount = 0;
  // 並列 fetch (Cloudflare のサブリクエスト最大 50 件以内)
  const results = await Promise.allSettled(
    picks.map(t => scrapeBeforeinfo(t.sid, t.rno, t.hd).then(boats => ({ t, boats })))
  );
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.boats) continue;
    const { t, boats } = r.value;
    // pv.boats に注入 (openapi 形式に変換)
    const newBoats = t.pv.boats || {};
    for (const bn of Object.keys(boats)) {
      const src = boats[bn];
      if (!newBoats[bn]) newBoats[bn] = { racer_boat_number: parseInt(bn) };
      newBoats[bn].racer_exhibition_time = src.exhibition_time;
      newBoats[bn].racer_start_timing    = src.start_timing;
      newBoats[bn].racer_course_number   = src.course;
      newBoats[bn].racer_tilt_adjustment = src.tilt;
      newBoats[bn].racer_propeller       = src.propeller;
      newBoats[bn].racer_parts_replaced  = src.parts_replaced;
      newBoats[bn].racer_adjust_weight   = src.adjust_weight;
    }
    t.pv.boats = newBoats;
    mergedCount++;
  }
  return { targets: scrapeTargets.length, scraped: picks.length, merged: mergedCount };
}

// -----------------------------------------------------------------------
// 2026-05-24 (致命バグ修正): KV に保存された "finished" 結果を openapi が
//   巻き戻すのを防ぐ。openapi は時々古いスナップショットを返したり、
//   一時的に race_technique_number=null に戻ったり、レース entry 自体が
//   消えたりする。Worker が素朴に openapi で KV を上書きすると、UI 側で
//   「9/12R → 5/12R」のように完了レースが減ってしまう。
//
// ルール: KV の race_technique_number が non-null (= 結果確定済) なら、
//   openapi が同じレースで null や 不在 を返しても KV 版を保持。
//   openapi が NEW 情報 (KV に無いレース、または KV では null だが
//   openapi で finished) を持っていれば取り込む。
// -----------------------------------------------------------------------
function mergeKVOverOpenapi(openapiResults, kvResults) {
  if (!kvResults || !Array.isArray(kvResults.results)) return openapiResults;
  if (!openapiResults || !Array.isArray(openapiResults.results)) {
    // openapi が空 / 壊れ → KV のままを返す
    return kvResults;
  }
  // openapi の races を key 化
  const openapiByKey = new Map();
  for (const r of openapiResults.results) {
    if (!r || r.race_stadium_number == null || r.race_number == null) continue;
    openapiByKey.set(`${r.race_stadium_number}-${r.race_number}`, r);
  }
  // KV の finished entries を openapi 側に上書き / 追加
  let preserved = 0, added = 0, rejected = 0;
  for (const kvr of kvResults.results) {
    if (!kvr || kvr.race_stadium_number == null || kvr.race_number == null) continue;
    if (kvr.race_technique_number == null) continue; // unfinished は無視
    // 2026-05-24: KV に bogus データ (重複艇 / 1着欠落 / boats < 3) が
    //   居座っていた場合は preserve しない (常滑 7R で観測された事故対策)。
    if (!_isValidResult(kvr)) {
      rejected++;
      continue;
    }
    const key = `${kvr.race_stadium_number}-${kvr.race_number}`;
    const open = openapiByKey.get(key);
    if (open) {
      // openapi にも entry あり: KV が finished で openapi が unfinished なら KV 優先
      if (open.race_technique_number == null) {
        Object.assign(open, kvr);
        preserved++;
      }
      // openapi も finished の場合は openapi 側を尊重 (より新しい上流データ)
    } else {
      // openapi に entry 無し: KV の finished を保持
      openapiResults.results.push(kvr);
      added++;
    }
  }
  openapiResults._kv_merge = { preserved, added, rejected };
  return openapiResults;
}

// 2026-05-24: result entry が valid か判定 (sanity check)
//   - boats.length >= 3
//   - 1着が含まれる
//   - 艇番に重複が無い
function _isValidResult(r) {
  if (!r || !Array.isArray(r.boats)) return false;
  if (r.boats.length < 3) return false;
  let hasFirst = false;
  const seen = new Set();
  for (const b of r.boats) {
    if (!b) continue;
    if (b.racer_place_number === 1) hasFirst = true;
    if (b.racer_boat_number != null) {
      if (seen.has(b.racer_boat_number)) return false; // 重複艇
      seen.add(b.racer_boat_number);
    }
  }
  return hasFirst;
}

// -----------------------------------------------------------------------
// Cron で呼ばれる。openapi + boatrace.jp 直スクレイプを統合して KV に格納
// -----------------------------------------------------------------------
async function refreshAll(env) {
  const out = {};
  let previews = null, programs = null, results = null;
  try { previews = await fetchUpstream(UPSTREAM.previews); out.previews = { ok: true }; }
  catch (e) { out.previews = { ok: false, error: String(e).slice(0,200) }; }
  try { programs = await fetchUpstream(UPSTREAM.programs); out.programs = { ok: true }; }
  catch (e) { out.programs = { ok: false, error: String(e).slice(0,200) }; }
  try { results  = await fetchUpstream(UPSTREAM.results);  out.results  = { ok: true }; }
  catch (e) { out.results  = { ok: false, error: String(e).slice(0,200) }; }

  // 2026-05-24: openapi 巻き戻り対策 — KV に既存 finished があれば preserve
  if (env.BOATRACE_KV && results) {
    try {
      const rawKv = await env.BOATRACE_KV.get(KV_KEYS.results);
      if (rawKv) {
        const kvWrapped = JSON.parse(rawKv);
        if (kvWrapped && kvWrapped.data) {
          // 日跨ぎ判定: KV の updated_at が昨日 (JST) なら preserve しない
          //   (前日 results を本日 results にマージしてしまう事故防止)
          let sameDay = true;
          try {
            const kvDate = new Date(kvWrapped.updated_at);
            const now = new Date();
            const kvJstDay = new Date(kvDate.getTime() + 9*60*60*1000).toISOString().slice(0,10);
            const nowJstDay = new Date(now.getTime() + 9*60*60*1000).toISOString().slice(0,10);
            sameDay = (kvJstDay === nowJstDay);
          } catch (_) { sameDay = true; }
          if (sameDay) {
            results = mergeKVOverOpenapi(results, kvWrapped.data);
            out.results.kv_preserved = results._kv_merge || null;
          } else {
            out.results.kv_skip = 'day_change';
          }
        }
      }
    } catch (e) {
      out.results.kv_merge_err = String(e).slice(0, 100);
    }
  }

  const nowMs = Date.now();
  // boatrace.jp 直スクレイプで展示データを補完
  if (previews && programs) {
    try {
      const mergeStats = await mergeBoatraceJpExhibition(programs, previews, nowMs);
      out.exhibition_scrape = mergeStats;
    } catch (e) {
      out.exhibition_scrape = { error: String(e).slice(0,200) };
    }
  }
  // C6: boatrace.jp 直スクレイプで結果データを補完
  if (results && programs) {
    try {
      const mergeStats = await mergeBoatraceJpResults(programs, results, nowMs);
      out.result_scrape = mergeStats;
    } catch (e) {
      out.result_scrape = { error: String(e).slice(0,200) };
    }
  }

  // KV 書込 (env.BOATRACE_KV があれば)
  if (env.BOATRACE_KV) {
    if (previews) { try { await kvWrite(env, KV_KEYS.previews, previews); out.previews.kv_ok=true; } catch(e) { out.previews.kv_err=String(e).slice(0,100); } }
    if (programs) { try { await kvWrite(env, KV_KEYS.programs, programs); out.programs.kv_ok=true; } catch(e) { out.programs.kv_err=String(e).slice(0,100); } }
    if (results)  {
      // 2026-05-24: 内部診断フィールド _kv_merge を KV/レスポンスから除外
      if (results._kv_merge) delete results._kv_merge;
      try { await kvWrite(env, KV_KEYS.results,  results);  out.results.kv_ok=true;  } catch(e) { out.results.kv_err=String(e).slice(0,100);  }
    }
  }
  return out;
}

// rt-fix (2026-06-04): silent-halt 対策の中核。
//   旧版は「KV にデータがあれば、それが何時間古くても無条件で返す」ため、
//   cron / KV write が失敗 (例: 無料枠 1000 writes/日 の枯渇) すると
//   /api/* が古い KV を 200 で返し続け、クライアントが永久に stale 表示になった。
//   新版は KV の updated_at を見て、STALE_MS より古ければ上流 openapi を
//   live fetch (Cloudflare edge cache 経由 = KV write 枠を一切消費しない) して
//   fresh を返す。これにより KV write が完全に止まっても /api/* は fresh を返す。
const SERVE_STALE_MS = 12 * 60 * 1000; // KV がこれより古ければ live fetch に切替 (cron は 5 分間隔)

async function serveFromKV(env, kind) {
  // D9 (2026-05-17): wrapped.updated_at をレスポンス先頭に merge して
  //   PWA 側の鮮度診断 (j.updated_at) が正しく読めるようにする。
  let kvWrapped = null;
  try {
    const raw = await env.BOATRACE_KV.get(KV_KEYS[kind]);
    if (raw) kvWrapped = JSON.parse(raw);
  } catch (e) {
    console.error('KV read failed:', e);
  }

  // KV が十分新しければ (= cron が正常に書けている) それを返す。
  //   boatrace.jp 直スクレイプの exhibition/results merge を含むリッチ版。
  if (kvWrapped && kvWrapped.updated_at && kvWrapped.data) {
    const ageMs = Date.now() - new Date(kvWrapped.updated_at).getTime();
    if (ageMs >= 0 && ageMs < SERVE_STALE_MS) {
      const merged = { updated_at: kvWrapped.updated_at, ...kvWrapped.data };
      return jsonResponse(merged, { cacheControl: 'public, max-age=30' });
    }
  }

  // KV が無い or STALE (cron/KV write 失敗時の silent-halt を回避):
  //   上流 openapi を live fetch (edge cache、write 枠不要) して fresh を返す。
  try {
    const data = await fetchUpstream(UPSTREAM[kind]);
    // 取得できたら KV 更新も試みる (diff-write なので変化時のみ、失敗は無視)
    if (env.BOATRACE_KV) kvWrite(env, KV_KEYS[kind], data).catch(() => {});
    const merged = { updated_at: new Date().toISOString(), ...data };
    return jsonResponse(merged, { cacheControl: 'public, max-age=30' });
  } catch (e) {
    // live fetch も失敗 → 最後の手段として stale KV を返す (502 より stale の方がマシ)
    if (kvWrapped && kvWrapped.data) {
      const merged = { updated_at: kvWrapped.updated_at, ...kvWrapped.data, _stale: true };
      return jsonResponse(merged, { cacheControl: 'public, max-age=15' });
    }
    return jsonResponse({ error: String(e) }, { status: 502, cacheControl: 'no-store' });
  }
}

export default {
  async scheduled(event, env, ctx) {
    // D1a (2026-05-17): 24/7 動作。cron 側で頻度を分岐するので時間外スキップは不要。
    //   JST 08-22: 5 分間隔, JST 23-07: 30 分間隔 (wrangler.toml triggers 参照)
    if (!env.BOATRACE_KV) {
      console.error('BOATRACE_KV binding missing');
      return;
    }
    const r = await refreshAll(env);
    console.log('refresh:', JSON.stringify(r));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
    }
    if (url.pathname === '/health') {
      return jsonResponse({
        ok: true,
        time: new Date().toISOString(),
        mode: 'scrape-engine-v3-with-html-scrape',
        kv_bound: !!env.BOATRACE_KV,
      });
    }
    if (url.pathname === '/api/previews') return serveFromKV(env, 'previews');
    if (url.pathname === '/api/programs') return serveFromKV(env, 'programs');
    if (url.pathname === '/api/results')  return serveFromKV(env, 'results');
    if (url.pathname === '/api/refresh-now') {
      if (!env.BOATRACE_KV) return jsonResponse({ error: 'KV not bound' }, { status: 500 });
      const r = await refreshAll(env);
      return jsonResponse({ refreshed: r });
    }

    if (url.pathname === '/odds-proxy') {
      const type = url.searchParams.get('type') || '';
      const sid  = url.searchParams.get('sid') || '';
      const rno  = url.searchParams.get('rno') || '';
      const hd   = url.searchParams.get('hd')  || '';
      const endpoints = { win: 'oddstf', exacta: 'odds2tf', trifecta: 'odds3t' };
      if (!endpoints[type] || !/^\d+$/.test(sid) || !/^\d+$/.test(rno) || !/^\d{8}$/.test(hd)) {
        return new Response('bad params', { status: 400, headers: CORS });
      }
      const sidNum = parseInt(sid);
      if (sidNum < 1 || sidNum > 24) return new Response('bad sid', { status: 400, headers: CORS });
      const jcd = String(sidNum).padStart(2, '0');
      const upstream = `https://www.boatrace.jp/owpc/pc/race/${endpoints[type]}?rno=${parseInt(rno)}&jcd=${jcd}&hd=${hd}`;
      try {
        const res = await fetch(upstream, {
          headers: { 'User-Agent': 'Mozilla/5.0 boatrace-scrape-trigger' },
          cf: { cacheTtl: 15, cacheEverything: true },
        });
        if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502, headers: CORS });
        const html = await res.text();
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=15', ...CORS },
        });
      } catch (e) {
        return new Response(`error: ${e.message}`, { status: 502, headers: CORS });
      }
    }
    return new Response('boatrace-scrape-trigger (scrape-engine-v3)\n', { headers: CORS });
  },
};
