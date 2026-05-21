// Phase 2e (Clearwing patterns): src/context/domain_constants.js
//
// Context 層: 副作用なしの状態・設定保持。
// 競艇ドメインの静的データテーブル（場名・級・決まり手・風向・グレード等）を集約。
//
// build/build.mjs が IIFE bundle して assets/app.js の
//   /* BUILD:CONTEXT_DOMAIN:START */ ... /* BUILD:CONTEXT_DOMAIN:END */
// に注入する。
//
// Public (globalThis に export):
//   STADIUMS / CLASS_NAME / CLASS_COLOR / BOAT_COLORS / BOAT_TEXT
//   TECHNIQUE / WIND_DIR / GRADE_CLASS
//
// 設計原則:
//   - 全て読み取り専用テーブル（実行時に変化しない）
//   - Object.freeze で書込防止
//   - 値そのものは旧 app.js の constants から逐字移植（動作互換）

'use strict';

const STADIUMS = Object.freeze({
  1: '桐生',
  2: '戸田',
  3: '江戸川',
  4: '平和島',
  5: '多摩川',
  6: '浜名湖',
  7: '蒲郡',
  8: '常滑',
  9: '津',
  10: '三国',
  11: 'びわこ',
  12: '住之江',
  13: '尼崎',
  14: '鳴門',
  15: '丸亀',
  16: '児島',
  17: '宮島',
  18: '徳山',
  19: '下関',
  20: '若松',
  21: '芦屋',
  22: '福岡',
  23: '唐津',
  24: '大村',
});

const CLASS_NAME = Object.freeze({ 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2' });
const CLASS_COLOR = Object.freeze({ 1: '#FF2244', 2: '#FF6644', 3: '#2288FF', 4: '#888888' });

const BOAT_COLORS = Object.freeze({
  1: '#FFFFFF',
  2: '#000000',
  3: '#FF1122',
  4: '#2255FF',
  5: '#FFD700',
  6: '#22CC44',
});
const BOAT_TEXT = Object.freeze({
  1: '#000000',
  2: '#FFFFFF',
  3: '#FFFFFF',
  4: '#FFFFFF',
  5: '#000000',
  6: '#FFFFFF',
});

const TECHNIQUE = Object.freeze({
  1: '逃げ',
  2: '差し',
  3: 'まくり',
  4: 'まくり差し',
  5: '抜き',
  6: '恵まれ',
});

const WIND_DIR = Object.freeze({
  1: 'N',
  2: 'NNE',
  3: 'NE',
  4: 'ENE',
  5: 'E',
  6: 'ESE',
  7: 'SE',
  8: 'SSE',
  9: 'S',
  10: 'SSW',
  11: 'SW',
  12: 'WSW',
  13: 'W',
  14: 'WNW',
  15: 'NW',
  16: 'NNW',
  17: '無風',
});

const GRADE_CLASS = Object.freeze({
  1: Object.freeze({ name: 'SG', cls: 'grade-sg' }),
  2: Object.freeze({ name: 'G1', cls: 'grade-g1' }),
  3: Object.freeze({ name: 'G2', cls: 'grade-g2' }),
  4: Object.freeze({ name: 'G3', cls: 'grade-g3' }),
  5: Object.freeze({ name: '一般', cls: 'grade-general' }),
});

// globalThis export — 既存コードは大文字定数として参照
globalThis.STADIUMS = STADIUMS;
globalThis.CLASS_NAME = CLASS_NAME;
globalThis.CLASS_COLOR = CLASS_COLOR;
globalThis.BOAT_COLORS = BOAT_COLORS;
globalThis.BOAT_TEXT = BOAT_TEXT;
globalThis.TECHNIQUE = TECHNIQUE;
globalThis.WIND_DIR = WIND_DIR;
globalThis.GRADE_CLASS = GRADE_CLASS;
