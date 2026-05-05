// Epic 16 (P2-5): i18n 抽象化 — scaffold 段階
//
// 目的: 将来の多言語化に向けた最小フレーム。
//   - 翻訳キー → 文字列テーブル（locale 別）
//   - t(key, params) で翻訳取得、未定義キーは key そのものを返す（fail-soft）
//   - locale は navigator.language 自動判定 + URL ?lang=xx で上書き可能
//
// 現状: ja のみ実装、en は scaffold のみ。
// 将来: 全 UI 文字列を t('xxx') 経由に置換 → en/zh 翻訳テーブル追加

'use strict';

const I18N_KEY = 'boatrace_locale';
const DEFAULT_LOCALE = 'ja';

// 翻訳テーブル — まずは現在ハードコードされている主要キーのみ
const I18N_TABLES = {
  ja: {
    'common.loading': 'データ取得中...',
    'common.refresh': '更新',
    'common.close': '閉じる',
    'common.copy': 'コピー',
    'common.share': '共有',
    'race.honmei': '本命',
    'race.middle': '混戦',
    'race.ana': '穴',
    'race.confidence': '信頼度',
    'page.top': 'トップ',
    'page.stats': '成績',
    'page.backtest': '検証',
    'page.settings': '設定',
    'settings.bet_count_3': '3連単 買い目点数',
    'settings.bet_count_2': '2連単 買い目点数',
    'settings.bet_method': '買い目方式',
    'settings.kpi_mode': 'KPI モード',
    'settings.notify': '的中通知',
    'notify.permission_request': '許可リクエスト',
    'notify.permission_granted': '✓ 許可済',
    'notify.permission_denied': '× 拒否（ブラウザ設定で変更可）',
    'notify.permission_default': '未設定',
    'api.health.fail': 'API 取得失敗',
    'api.health.cached': 'キャッシュ使用中',
    'api.health.warning': '表示が古い可能性があります',
  },
  en: {
    // scaffold のみ。実翻訳は別 PR。
    'common.loading': 'Loading...',
    'common.refresh': 'Refresh',
    'common.close': 'Close',
    'common.copy': 'Copy',
    'common.share': 'Share',
    'race.honmei': 'Favorite',
    'race.middle': 'Mixed',
    'race.ana': 'Long shot',
    'race.confidence': 'Confidence',
    'page.top': 'Top',
    'page.stats': 'Stats',
    'page.backtest': 'Backtest',
    'page.settings': 'Settings',
  },
};

let _currentLocale = DEFAULT_LOCALE;

function _detectLocale() {
  // 優先順: URL ?lang=xx > localStorage > navigator.language の prefix > default
  try {
    const qs = new URLSearchParams(location.search || '');
    const q = qs.get('lang');
    if (q && I18N_TABLES[q]) return q;
  } catch (_) {}
  try {
    const stored = localStorage.getItem(I18N_KEY);
    if (stored && I18N_TABLES[stored]) return stored;
  } catch (_) {}
  try {
    const nav = (navigator.language || '').slice(0, 2);
    if (nav && I18N_TABLES[nav]) return nav;
  } catch (_) {}
  return DEFAULT_LOCALE;
}

function setLocale(locale) {
  if (!I18N_TABLES[locale]) return false;
  _currentLocale = locale;
  try { localStorage.setItem(I18N_KEY, locale); } catch (_) {}
  return true;
}

function getLocale() { return _currentLocale; }

// t(key, params?) — params は {name: value} で {{name}} 置換
function t(key, params) {
  const table = I18N_TABLES[_currentLocale] || I18N_TABLES[DEFAULT_LOCALE];
  let text = table[key];
  if (text == null) {
    // フォールバック: ja を試す → 最後は key そのもの
    text = (I18N_TABLES[DEFAULT_LOCALE] && I18N_TABLES[DEFAULT_LOCALE][key]) || key;
  }
  if (params && typeof params === 'object') {
    text = text.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] != null ? String(params[k]) : '{{' + k + '}}'));
  }
  return text;
}

function availableLocales() { return Object.keys(I18N_TABLES); }

// 起動時に locale 検出
_currentLocale = _detectLocale();

// globalThis export
globalThis.t = t;
globalThis.setLocale = setLocale;
globalThis.getLocale = getLocale;
globalThis.availableLocales = availableLocales;
globalThis.I18N_TABLES = I18N_TABLES;
