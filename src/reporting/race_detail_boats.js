// Phase 2 完遂続編 (Clearwing patterns): src/reporting/race_detail_boats.js
//
// Reporting 層: レース詳細ページの「出走表」(Macour-style horizontal table)
// セクション (#detailBoats)。race_detail.js から内部分割 (400 行制限遵守)。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:REPORTING_RACE_DETAIL_BOATS:START */ ... /* :END */
// に注入する。REST_ONLY (詳細ページ開いた時のみ)。
//
// 呼出シグネチャ:
//   _renderRaceDetailBoats(ctx)
//     ctx = { race, preview, pred, rdForRace }
//   副作用: ctx.boatMap / ctx.pvMap / ctx.etRankMap / ctx.stRankMap を SET する
//          (続く _renderRaceDetailExhibition が共有して使う)
//
// 依存: BOAT_COLORS / BOAT_TEXT / CLASS_COLOR / CLASS_NAME / pf / escText /
//   getRacerForm / racerBadges / motorEvalGrade / renderSeriesCell
//
// Public: _renderRaceDetailBoats

'use strict';

function _renderRaceDetailBoats(ctx) {
  var race = ctx.race;
  var preview = ctx.preview;
  var pred = ctx.pred;
  var rdForRace = ctx.rdForRace;

  // ==========================================
  // 3a. Macour-style 出走表テーブル (horizontal, label column on right, sticky)
  // ==========================================
  var boatsHtml = '';
  if (race && race.boats && Array.isArray(race.boats)) {
    var boatMap = {};
    // D8 (2026-05-17): D6 と同様の null guard。race.boats に null entry 混入時の防御
    race.boats.forEach(function (bt) {
      if (bt && bt.racer_boat_number) boatMap[bt.racer_boat_number] = bt;
    });
    var pvMap = {};
    if (preview && preview.boats) {
      for (var pi = 1; pi <= 6; pi++) {
        if (preview.boats[String(pi)]) pvMap[pi] = preview.boats[String(pi)];
      }
    }

    // Compute ET/ST ranks for highlighting
    var etTimes = [],
      stTimes = [];
    for (var ri = 1; ri <= 6; ri++) {
      var pvi = pvMap[ri];
      etTimes.push({
        boat: ri,
        val:
          pvi && pvi.racer_exhibition_time != null && pvi.racer_exhibition_time > 0
            ? pf(pvi.racer_exhibition_time)
            : 999,
      });
      // ST は 0 以上で小さいほど良い。フライング(負)は最良ではなく失格＝最悪なので
      //   999 に飛ばして上位色付けの対象外にする(従来は負が最速扱いで誤色付けされていた)。
      var _stv = pvi && pvi.racer_start_timing != null ? pf(pvi.racer_start_timing) : 999;
      if (_stv < 0) _stv = 999;
      stTimes.push({ boat: ri, val: _stv });
    }
    etTimes.sort(function (a, b) {
      return a.val - b.val;
    });
    stTimes.sort(function (a, b) {
      return a.val - b.val;
    });
    var etRankMap = {},
      stRankMap = {};
    etTimes.forEach(function (e, i) {
      etRankMap[e.boat] = i;
    });
    stTimes.forEach(function (e, i) {
      stRankMap[e.boat] = i;
    });

    boatsHtml = '<div class="section-title">出走表</div>';
    boatsHtml += '<div class="detail-table-wrap"><table class="detail-table">';

    // Row 0: 枠番ヘッダー (boat colors)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      boatsHtml +=
        '<td class="boat-col-header" style="background:' +
        BOAT_COLORS[bn] +
        ';color:' +
        BOAT_TEXT[bn] +
        ';border:1px solid ' +
        (bn === 1 ? '#ccc' : 'transparent') +
        '">' +
        bn +
        '号艇</td>';
    }
    boatsHtml += '<th>枠</th></tr>';

    // Row 1: 級別
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var cn = bt.racer_class_number || 4;
      boatsHtml +=
        '<td><span style="background:' +
        CLASS_COLOR[cn] +
        ';color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:700">' +
        CLASS_NAME[cn] +
        '</span></td>';
    }
    boatsHtml += '<th>級</th></tr>';

    // Row 2: 登番 + 期(unavailable, show "-")
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var rid = bt.racer_number || 0;
      boatsHtml += '<td><b>' + rid + '</b> <span class="fs-9 c-dim">-期</span></td>';
    }
    boatsHtml += '<th>登番</th></tr>';

    // Row 3: 選手名 (bold, colored by boat number, 16px)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var nameColor = bn === 1 ? 'var(--text)' : BOAT_COLORS[bn];
      if (bn === 5) nameColor = '#B8860B';
      var m = pred
        ? pred.marks.find(function (x) {
            return x.boat === bn;
          })
        : null;
      var markStr = m ? ' <span style="font-size:11px;color:var(--accent)">' + m.mark + '</span>' : '';
      var rid = bt.racer_number || 0;
      var photoHtml = rid
        ? '<img class="racer-photo" src="data/photos/' +
          rid +
          '.jpg" loading="lazy" alt="" onerror="this.dataset.broken=\'1\'">'
        : '';
      boatsHtml +=
        '<td>' +
        photoHtml +
        '<span style="font-weight:700;font-size:13px;color:' +
        nameColor +
        '">' +
        escText(bt.racer_name || '') +
        '</span>' +
        markStr +
        '</td>';
    }
    boatsHtml += '<th>選手</th></tr>';

    // Row 4: 年齢 + 支部 + 体重
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var age = bt.racer_age || '-';
      var branch = bt.racer_branch_name || '-';
      var weight = bt.racer_weight || '-';
      boatsHtml += '<td style="font-size:11px">' + age + '歳/' + escText(branch) + '<br>' + weight + 'kg</td>';
    }
    boatsHtml += '<th>年齢等</th></tr>';

    // Row 5: バッジ
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var form = getRacerForm(bt.racer_number || 0);
      // X1: 妙味バッジ用に divergence を渡す
      var div = pred && pred.divergence ? pred.divergence[bn] : null;
      var badges = racerBadges(bt, form, div);
      boatsHtml += '<td>' + (badges || '-') + '</td>';
    }
    boatsHtml += '<th>特徴</th></tr>';

    // Row 6: モーター評価 A-E
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var mr = pf(bt.racer_assigned_motor_top_2_percent);
      var me = motorEvalGrade(mr);
      boatsHtml +=
        '<td><span class="' +
        me.cls +
        '">' +
        me.grade +
        '</span> <span style="font-size:11px;color:var(--text-sub)">' +
        me.label +
        '</span></td>';
    }
    boatsHtml += '<th>モーター</th></tr>';

    // Row 7: 全国勝率 + 2連率 (highlight pink if >=6.0)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var wr = pf(bt.racer_national_top_1_percent);
      var t2 = pf(bt.racer_national_top_2_percent);
      var hlCls = wr >= 6.0 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' +
        hlCls +
        '"><b>' +
        wr.toFixed(2) +
        '</b><br><span class="fs-9">2連:' +
        t2.toFixed(1) +
        '%</span></td>';
    }
    boatsHtml += '<th>全国勝率</th></tr>';

    // Row 8: 当地勝率 + 2連率
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var lwr = pf(bt.racer_local_top_1_percent);
      var lt2 = pf(bt.racer_local_top_2_percent);
      var hlCls = lwr >= 6.0 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' +
        hlCls +
        '"><b>' +
        lwr.toFixed(2) +
        '</b><br><span class="fs-9">2連:' +
        lt2.toFixed(1) +
        '%</span></td>';
    }
    boatsHtml += '<th>当地勝率</th></tr>';

    // Row 9: 平均ST
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var avgSt = pf(bt.racer_average_start_timing);
      boatsHtml += '<td>' + (bt.racer_average_start_timing != null ? avgSt.toFixed(2) : '---') + '</td>';
    }
    boatsHtml += '<th>平均ST</th></tr>';

    // Row 10: モーター番号 + 2連率 (highlight pink if >=40%)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var mNum = bt.racer_assigned_motor_number || '-';
      var mr2 = pf(bt.racer_assigned_motor_top_2_percent);
      var hlCls = mr2 >= 40 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' + hlCls + '"><b>' + mNum + '</b><br><span class="fs-9">' + mr2.toFixed(1) + '%</span></td>';
    }
    boatsHtml += '<th>モーター</th></tr>';

    // Row 11: ボート番号 + 2連率 (highlight pink if >=40%)
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var bNum = bt.racer_assigned_boat_number || '-';
      var br2 = pf(bt.racer_assigned_boat_top_2_percent);
      var hlCls = br2 >= 40 ? 'hl-pink' : '';
      boatsHtml +=
        '<td class="' + hlCls + '"><b>' + bNum + '</b><br><span class="fs-9">' + br2.toFixed(1) + '%</span></td>';
    }
    boatsHtml += '<th>ボート</th></tr>';

    // Row 12: F/L count
    boatsHtml += '<tr>';
    for (var bn = 1; bn <= 6; bn++) {
      var bt = boatMap[bn];
      if (!bt) {
        boatsHtml += '<td>-</td>';
        continue;
      }
      var fc = bt.racer_flying_count || 0;
      var lc = bt.racer_late_start_count_in_current_term || 0;
      var flStr = 'F' + fc + '/L' + lc;
      if (fc > 0) flStr = '<span style="color:var(--danger);font-weight:700">F' + fc + '</span>/L' + lc;
      boatsHtml += '<td>' + flStr + '</td>';
    }
    boatsHtml += '<th>F/L</th></tr>';

    // 2026-11-20: 長期集計（scripts/aggregate_racer_stats.py → data/db/racer_stats_view.json）
    boatsHtml += _racerStatsRows(boatMap, pvMap, ctx.sid);

    // F16: 今節成績 (Macool 風) — 14 cells (= 7 days × 2 slots) を縦並べ
    if (rdForRace && rdForRace.boats) {
      var boatsSeries = [];
      var maxNonNull = 0;
      for (var bn = 1; bn <= 6; bn++) {
        var bt = boatMap[bn];
        var rid = bt ? bt.racer_number || 0 : 0;
        var rdBoat = rdForRace.boats
          ? rdForRace.boats.find(function (rb) {
              return rb.boat_number === bn || rb.racer_number === rid;
            })
          : null;
        var arr = rdBoat ? rdBoat.current_series_results || [] : [];
        boatsSeries.push(arr);
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] != null && i + 1 > maxNonNull) maxNonNull = i + 1;
        }
      }
      if (maxNonNull > 0) {
        var pairs = Math.ceil(maxNonNull / 2);
        var DAY_LABELS = ['初日', '2日目', '3日目', '4日目', '5日目', '準優', '最終'];
        for (var p = 0; p < pairs; p++) {
          for (var slot = 0; slot < 2; slot++) {
            var idx = p * 2 + slot;
            if (idx >= maxNonNull) break;
            boatsHtml += '<tr>';
            for (var bi = 0; bi < 6; bi++) {
              boatsHtml += renderSeriesCell(boatsSeries[bi][idx]);
            }
            if (slot === 0) {
              var rs = idx + 1 < maxNonNull ? 2 : 1;
              boatsHtml +=
                '<th rowspan="' + rs + '" class="series-day-th">' + (DAY_LABELS[p] || p + 1 + '日目') + '</th>';
            }
            boatsHtml += '</tr>';
          }
        }
      }
    }

    boatsHtml += '</table></div>';
  }
  document.getElementById('detailBoats').innerHTML = boatsHtml;

  // ctx に boats/exhibition で共有する map を書き戻し (続く exhibition section が利用)
  ctx.boatMap = boatMap;
  ctx.pvMap = pvMap;
  ctx.etRankMap = etRankMap;
  ctx.stRankMap = stRankMap;
}

// ---------------------------------------------------------------------------
// 2026-11-20: 選手・モーターの長期集計（直近 12 か月 / モーター 6 か月）
//   取得は discovery 層 (src/discovery/racer_stats_loader.js)、ここは globalThis._racerStatsView を読むだけ。
var TECH_SHORT = { 1: '逃げ', 2: '差し', 3: 'まくり', 4: 'まくり差し', 5: '抜き', 6: '恵まれ' };
var LOSS_SHORT = { 2: '差され', 3: '捲られ', 4: '捲られ差し', 5: '抜かれ', 6: '恵まれ' };

// 集計が届いたら、開いているレース詳細を描き直す（届く前に描いた分は 4 行が無いため）
function _onRacerStatsLoaded() {
  try {
    var page = document.querySelector('.page.active');
    if (page && page.id === 'pageDetail' && currentStadium && currentRace && typeof openRace === 'function') {
      openRace(currentStadium, currentRace);
    }
  } catch (_) {}
}

function _pct(a, b) {
  return b > 0 ? Math.round((a / b) * 100) + '%' : '-';
}

// 出走表の追加 4 行（コース成績 / 決まり手 / ST / モーター）
function _racerStatsRows(boatMap, pvMap, sid) {
  var V = globalThis._racerStatsView;
  if (!V) {
    if (typeof _loadRacerStatsView === 'function') _loadRacerStatsView(_onRacerStatsLoaded);
    return '';
  }
  var rows = { course: '', tech: '', st: '', motor: '' };
  for (var bn = 1; bn <= 6; bn++) {
    var bt = boatMap[bn];
    var pv = pvMap[bn];
    var course = pv && pv.racer_course_number >= 1 && pv.racer_course_number <= 6 ? pv.racer_course_number : bn;
    var rs = bt && bt.racer_number ? V.racers[String(bt.racer_number)] : null;
    var c = rs && rs.c ? rs.c[String(course)] : null;
    // コース成績: 1着率 / 2連対率（出走数）
    rows.course += c
      ? '<td>' + _pct(c[1], c[0]) + '<br><span class="fs-9">2連' + _pct(c[2], c[0]) + ' (' + c[0] + ')</span></td>'
      : '<td>-</td>';
    // 決まり手: 1 コースは逃げ率と負け方、他は勝ち決まり手の内訳
    var tech = '-';
    if (rs && c && c[0] > 0) {
      var kw = (rs.kw && rs.kw[String(course)]) || {};
      if (course === 1) {
        tech = '逃げ' + _pct(kw['1'] || 0, c[0]);
        var l1 = rs.l1 || {};
        var parts = [];
        Object.keys(l1)
          .sort(function (a, b) {
            return l1[b] - l1[a];
          })
          .slice(0, 2)
          .forEach(function (k) {
            parts.push((LOSS_SHORT[k] || '他') + _pct(l1[k], c[0]));
          });
        if (parts.length) tech += '<br><span class="fs-9">' + parts.join(' ') + '</span>';
      } else {
        var ks = Object.keys(kw).sort(function (a, b) {
          return kw[b] - kw[a];
        });
        tech = ks.length
          ? ks
              .slice(0, 2)
              .map(function (k) {
                return (TECH_SHORT[k] || '他') + kw[k];
              })
              .join('<br>')
          : '勝ちなし';
      }
    }
    rows.tech += '<td>' + tech + '</td>';
    // ST: 平均 ST / 展示との平均ズレ / F 回数
    var st = rs && rs.st;
    var sz = rs && rs.sz;
    var stCell = st && st[0] != null ? st[0].toFixed(2) : '-';
    if (sz && sz[2] >= 3)
      stCell += '<br><span class="fs-9">展示比' + (sz[0] >= 0 ? '+' : '') + sz[0].toFixed(2) + '</span>';
    if (st && st[2] > 0) stCell += '<br><span style="color:var(--danger);font-size:11px">F' + st[2] + '</span>';
    rows.st += '<td>' + stCell + '</td>';
    // モーター（場 × 番号、直近 6 か月）: 2連対率（出走数）
    var mno = bt && bt.racer_assigned_motor_number;
    var mv = mno && V.motors && V.motors[String(sid)] ? V.motors[String(sid)][String(mno)] : null;
    rows.motor += mv
      ? '<td>' + _pct(mv[2], mv[0]) + '<br><span class="fs-9">(' + mv[0] + ')</span></td>'
      : '<td>-</td>';
  }
  var win = V.window && V.window.racer_months ? V.window.racer_months : 12;
  return (
    '<tr>' +
    rows.course +
    '<th>コース<br>成績<br><span class="fs-9">' +
    win +
    'か月</span></th></tr>' +
    '<tr>' +
    rows.tech +
    '<th>決まり手</th></tr>' +
    '<tr>' +
    rows.st +
    '<th>平均ST</th></tr>' +
    '<tr>' +
    rows.motor +
    '<th>モーター<br>2連率<br><span class="fs-9">' +
    ((V.window && V.window.motor_months) || 6) +
    'か月</span></th></tr>'
  );
}

globalThis._renderRaceDetailBoats = _renderRaceDetailBoats;
globalThis._racerStatsRows = _racerStatsRows;
