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

// 翻訳テーブル — Epic 22 (P2-5 完全化): ja 完全 + en 完全
const I18N_TABLES = {
  ja: {
    // common
    'common.loading': 'データ取得中...',
    'common.refresh': '更新',
    'common.close': '閉じる',
    'common.copy': 'コピー',
    'common.share': '共有',
    'common.delete': '削除',
    'common.cancel': 'キャンセル',
    'common.ok': 'OK',
    'common.yes': 'はい',
    'common.no': 'いいえ',
    'common.reset': 'リセット',
    'common.show': '表示',
    'common.execute': '実行',
    // race
    'race.honmei': '本命',
    'race.middle': '混戦',
    'race.ana': '穴',
    'race.confidence': '信頼度',
    'race.lineup': '出走表',
    'race.ai_reasoning': 'AI予想・買い目',
    'race.odds_picks': 'オッズ',
    'race.back_to_list': '← レース一覧に戻る',
    'race.back_to_top': '← 場選択に戻る',
    'race.refresh_this': '🔄 このレースを更新',
    // page
    'page.top': 'トップ',
    'page.stats': '成績',
    'page.backtest': '検証',
    'page.settings': '設定',
    // settings
    'settings.bet_count_3': '3連単 買い目点数',
    'settings.bet_count_2': '2連単 買い目点数',
    'settings.bet_method': '買い目方式',
    'settings.kpi_mode': 'KPI モード',
    'settings.ev_mode': 'EV モード',
    'settings.ev_min': 'EV 最低閾値',
    'settings.kelly_frac': 'Kelly 比率',
    'settings.bankroll': '資金 (円)',
    'settings.notify': '的中通知',
    'settings.coi': 'SAB高速化(実験)',
    'settings.cache': 'データキャッシュ',
    'settings.history': '成績履歴',
    'settings.racer_db': '選手/場DB',
    'settings.weights': '学習重み',
    'settings.errors': 'エラーログ',
    'settings.platt': '確率校正 (Platt)',
    'settings.csv_export': '履歴 CSV エクスポート',
    'settings.forward_chain': 'Forward-chain 評価',
    'settings.language': '表示言語',
    // notify
    'notify.permission_request': '許可リクエスト',
    'notify.permission_granted': '✓ 許可済',
    'notify.permission_denied': '× 拒否（ブラウザ設定で変更可）',
    'notify.permission_default': '未設定',
    'notify.title': 'お気に入りレースの結果が確定',
    // api
    'api.health.fail': 'API 取得失敗',
    'api.health.cached': 'キャッシュ使用中',
    'api.health.warning': '表示が古い可能性があります',
    'api.health.retry': '再試行',
    // backtest
    'backtest.run': '▶ バックテスト実行',
    'backtest.period': '期間',
    'backtest.title': 'バックテスト',
    // stats
    'stats.today_total': '本日 判定済',
    'stats.tri_hits': '3連単的中',
    'stats.tri_recovery': '3連単回収率',
    'stats.loading': '読込中...',
    // confidence stars
    'confidence.label': '信頼度',
    // motor evaluation labels
    'motor.超抜': '超抜',
    'motor.好機': '好機',
    'motor.並機': '並機',
    'motor.低調': '低調',
    'motor.整備要': '整備要',
    // form labels
    'form.絶好調': '絶好調',
    'form.好調': '好調',
    'form.普通': '普通',
    'form.不調': '不調',
    'form.絶不調': '絶不調',
    // misc
    'misc.no_data': 'データなし',
  },
  en: {
    // common
    'common.loading': 'Loading...',
    'common.refresh': 'Refresh',
    'common.close': 'Close',
    'common.copy': 'Copy',
    'common.share': 'Share',
    'common.delete': 'Delete',
    'common.cancel': 'Cancel',
    'common.ok': 'OK',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.reset': 'Reset',
    'common.show': 'Show',
    'common.execute': 'Run',
    // race
    'race.honmei': 'Favorite',
    'race.middle': 'Mixed',
    'race.ana': 'Long shot',
    'race.confidence': 'Confidence',
    'race.lineup': 'Lineup',
    'race.ai_reasoning': 'AI prediction & picks',
    'race.odds_picks': 'Odds',
    'race.back_to_list': '← Back to race list',
    'race.back_to_top': '← Back to stadiums',
    'race.refresh_this': '🔄 Refresh this race',
    // page
    'page.top': 'Top',
    'page.stats': 'Stats',
    'page.backtest': 'Backtest',
    'page.settings': 'Settings',
    // settings
    'settings.bet_count_3': 'Trifecta # of bets',
    'settings.bet_count_2': 'Exacta # of bets',
    'settings.bet_method': 'Betting method',
    'settings.kpi_mode': 'KPI mode',
    'settings.ev_mode': 'EV mode',
    'settings.ev_min': 'Min EV threshold',
    'settings.kelly_frac': 'Kelly fraction',
    'settings.bankroll': 'Bankroll (JPY)',
    'settings.notify': 'Win notification',
    'settings.coi': 'SAB acceleration (exp.)',
    'settings.cache': 'Data cache',
    'settings.history': 'Bet history',
    'settings.racer_db': 'Racer / stadium DB',
    'settings.weights': 'Learned weights',
    'settings.errors': 'Error log',
    'settings.platt': 'Probability calibration (Platt)',
    'settings.csv_export': 'CSV export',
    'settings.forward_chain': 'Forward-chain eval',
    'settings.language': 'Display language',
    // notify
    'notify.permission_request': 'Request permission',
    'notify.permission_granted': '✓ Granted',
    'notify.permission_denied': '× Denied (change in browser settings)',
    'notify.permission_default': 'Not set',
    'notify.title': 'Watched race result confirmed',
    // api
    'api.health.fail': 'API fetch failed',
    'api.health.cached': 'Using cached data',
    'api.health.warning': 'Displayed data may be stale',
    'api.health.retry': 'Retry',
    // backtest
    'backtest.run': '▶ Run backtest',
    'backtest.period': 'Period',
    'backtest.title': 'Backtest',
    // stats
    'stats.today_total': 'Today judged',
    'stats.tri_hits': 'Trifecta hits',
    'stats.tri_recovery': 'Trifecta ROI',
    'stats.loading': 'Loading...',
    // confidence
    'confidence.label': 'Confidence',
    // motor evaluation labels
    'motor.超抜': 'Top-tier',
    'motor.好機': 'Good',
    'motor.並機': 'Average',
    'motor.低調': 'Poor',
    'motor.整備要': 'Maintenance',
    // form labels
    'form.絶好調': 'Excellent',
    'form.好調': 'Good',
    'form.普通': 'Average',
    'form.不調': 'Poor',
    'form.絶不調': 'Terrible',
    // misc
    'misc.no_data': 'No data',
  },
  // Epic 25: zh-CN (簡体中文) — UI 60キー完全翻訳
  'zh-CN': {
    // common
    'common.loading': '加载中...',
    'common.refresh': '刷新',
    'common.close': '关闭',
    'common.copy': '复制',
    'common.share': '分享',
    'common.delete': '删除',
    'common.cancel': '取消',
    'common.ok': '确定',
    'common.yes': '是',
    'common.no': '否',
    'common.reset': '重置',
    'common.show': '显示',
    'common.execute': '执行',
    // race
    'race.honmei': '本命',
    'race.middle': '混战',
    'race.ana': '冷门',
    'race.confidence': '可信度',
    'race.lineup': '出场表',
    'race.ai_reasoning': 'AI 推理与买点',
    'race.odds_picks': '赔率',
    'race.back_to_list': '← 返回比赛列表',
    'race.back_to_top': '← 返回赛场选择',
    'race.refresh_this': '🔄 刷新此场比赛',
    // page
    'page.top': '首页',
    'page.stats': '业绩',
    'page.backtest': '回测',
    'page.settings': '设置',
    // settings
    'settings.bet_count_3': '三连单注数',
    'settings.bet_count_2': '二连单注数',
    'settings.bet_method': '投注方式',
    'settings.kpi_mode': 'KPI 模式',
    'settings.ev_mode': 'EV 模式',
    'settings.ev_min': 'EV 最低阈值',
    'settings.kelly_frac': 'Kelly 比率',
    'settings.bankroll': '资金 (日元)',
    'settings.notify': '中奖通知',
    'settings.coi': 'SAB 加速 (实验)',
    'settings.cache': '数据缓存',
    'settings.history': '投注历史',
    'settings.racer_db': '选手 / 赛场 DB',
    'settings.weights': '学习权重',
    'settings.errors': '错误日志',
    'settings.platt': '概率校准 (Platt)',
    'settings.csv_export': 'CSV 导出',
    'settings.forward_chain': 'Forward-chain 评估',
    'settings.language': '显示语言',
    // notify
    'notify.permission_request': '请求权限',
    'notify.permission_granted': '✓ 已授权',
    'notify.permission_denied': '× 已拒绝（在浏览器设置中更改）',
    'notify.permission_default': '未设置',
    'notify.title': '关注比赛结果已确认',
    // api
    'api.health.fail': 'API 获取失败',
    'api.health.cached': '使用缓存数据',
    'api.health.warning': '显示数据可能过时',
    'api.health.retry': '重试',
    // backtest
    'backtest.run': '▶ 运行回测',
    'backtest.period': '期间',
    'backtest.title': '回测',
    // stats
    'stats.today_total': '今日已判定',
    'stats.tri_hits': '三连单中奖',
    'stats.tri_recovery': '三连单回收率',
    'stats.loading': '加载中...',
    // confidence
    'confidence.label': '可信度',
    // motor evaluation labels
    'motor.超抜': '极佳',
    'motor.好機': '良好',
    'motor.並機': '一般',
    'motor.低調': '较差',
    'motor.整備要': '需检修',
    // form labels
    'form.絶好調': '极佳',
    'form.好調': '良好',
    'form.普通': '一般',
    'form.不調': '较差',
    'form.絶不調': '极差',
    // misc
    'misc.no_data': '无数据',
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
  try {
    localStorage.setItem(I18N_KEY, locale);
  } catch (_) {}
  return true;
}

function getLocale() {
  return _currentLocale;
}

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

function availableLocales() {
  return Object.keys(I18N_TABLES);
}

// Epic 22: data-i18n 属性を持つ要素を一括翻訳
//   <button data-i18n="common.refresh">更新</button> → 現 locale で置換
//   data-i18n-attr="title:foo,aria-label:bar" で属性翻訳も可能
function translatePage(root) {
  const r = root || (typeof document !== 'undefined' ? document : null);
  if (!r || typeof r.querySelectorAll !== 'function') return 0;
  let n = 0;
  r.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const text = t(key);
    if (text !== key) {
      el.textContent = text;
      n++;
    }
  });
  r.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const spec = el.getAttribute('data-i18n-attr') || '';
    spec.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (!attr || !key) return;
      const text = t(key);
      if (text !== key) {
        el.setAttribute(attr, text);
        n++;
      }
    });
  });
  return n;
}

// locale 切替後に再翻訳して通知
function applyLocale(locale) {
  if (!setLocale(locale)) return false;
  translatePage();
  return true;
}

// 起動時に locale 検出
_currentLocale = _detectLocale();

// DOMContentLoaded で初回翻訳
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => translatePage(), { once: true });
  } else {
    // 既に loaded なら遅延実行（i18n bundle 後の他関数定義と競合しないよう）
    setTimeout(() => translatePage(), 0);
  }
}

// globalThis export
globalThis.t = t;
globalThis.setLocale = setLocale;
globalThis.getLocale = getLocale;
globalThis.availableLocales = availableLocales;
globalThis.I18N_TABLES = I18N_TABLES;
globalThis.translatePage = translatePage;
globalThis.applyLocale = applyLocale;
