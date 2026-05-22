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
      stTimes.push({ boat: ri, val: pvi && pvi.racer_start_timing != null ? pf(pvi.racer_start_timing) : 999 });
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
      var markStr = m ? ' <span style="font-size:10px;color:var(--accent)">' + m.mark + '</span>' : '';
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
      boatsHtml += '<td style="font-size:10px">' + age + '歳/' + escText(branch) + '<br>' + weight + 'kg</td>';
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
        '</span> <span style="font-size:9px;color:var(--text-sub)">' +
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

globalThis._renderRaceDetailBoats = _renderRaceDetailBoats;
