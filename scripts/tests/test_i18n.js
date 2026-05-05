// Epic 16 (P2-5): i18n scaffold テスト
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');
const bundleMatch = html.match(/\/\* BUILD:I18N:START \*\/[\s\S]*?\/\* BUILD:I18N:END \*\//);
if(!bundleMatch) throw new Error('BUILD:I18N bundle missing');

const lsMock = (function(){
  const store = new Map();
  return {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
})();

const ctx = vm.createContext({
  localStorage: lsMock,
  navigator: { language: 'ja-JP' },
  location: { search: '' },
  URLSearchParams: URLSearchParams,
});
vm.runInContext(bundleMatch[0], ctx);

let pass = 0, fail = 0;
function t(name, ok){ if(ok){ console.log('  PASS:', name); pass++; } else { console.log('  FAIL:', name); fail++; } }

console.log('[locale 検出]');
t('navigator.language=ja-JP → ja', ctx.getLocale() === 'ja');
t('availableLocales に ja/en を含む',
  ctx.availableLocales().includes('ja') && ctx.availableLocales().includes('en'));

console.log('');
console.log('[t() 翻訳]');
t('既知キーで ja 翻訳', ctx.t('common.loading') === 'データ取得中...');
t('未定義キーは key そのもの', ctx.t('foo.bar.unknown') === 'foo.bar.unknown');
t('race.honmei = 本命', ctx.t('race.honmei') === '本命');

console.log('');
console.log('[setLocale]');
t('en に切替成功', ctx.setLocale('en') === true);
t('en で common.refresh = Refresh', ctx.t('common.refresh') === 'Refresh');
t('en で en 専用キーが en 翻訳',
  ctx.t('settings.kpi_mode') === 'KPI mode');
t('en に存在せず ja に存在するキーは ja fallback', (function(){
  // 一時的に en テーブルから1件削除して fallback 動作を確認
  var saved = ctx.I18N_TABLES.en['common.loading'];
  delete ctx.I18N_TABLES.en['common.loading'];
  var result = ctx.t('common.loading');
  ctx.I18N_TABLES.en['common.loading'] = saved;
  return result === 'データ取得中...';
})());
t('未対応 locale は false', ctx.setLocale('zz') === false);

console.log('');
console.log('[params 置換]');
ctx.I18N_TABLES.ja['greet'] = 'こんにちは {{name}} さん';
ctx.setLocale('ja');
t('{{name}} 置換', ctx.t('greet', {name: '太郎'}) === 'こんにちは 太郎 さん');
t('params 欠如時は placeholder 残し', ctx.t('greet', {}) === 'こんにちは {{name}} さん');

console.log('');
console.log('[Epic 22+25: 翻訳テーブル充実 (ja/en/zh-CN)]');
const jaKeys = Object.keys(ctx.I18N_TABLES.ja);
const enKeys = Object.keys(ctx.I18N_TABLES.en);
const zhKeys = Object.keys(ctx.I18N_TABLES['zh-CN'] || {});
t('ja に 60+ キー (motor/form 含む)', jaKeys.length >= 60);
t('en に 60+ キー (ja と同等)', enKeys.length >= 60);
t('Epic 25: zh-CN に 60+ キー (ja/en と同等)', zhKeys.length >= 60);
t('Epic 25: zh-CN UI 翻訳が機能する', (function(){
  ctx.setLocale('zh-CN');
  return ctx.t('settings.language') === '显示语言' && ctx.t('motor.超抜') === '极佳';
})());
t('Epic 25: motor/form ラベル (zh) は 中国語', (function(){
  ctx.setLocale('zh-CN');
  return ctx.t('motor.整備要') === '需检修' && ctx.t('form.絶不調') === '极差';
})());
t('Epic 25: motor/form ラベル (en) は 英語', (function(){
  ctx.setLocale('en');
  return ctx.t('motor.整備要') === 'Maintenance' && ctx.t('form.絶不調') === 'Terrible';
})());
t('en で UI 必須キーが完全翻訳',
  (function(){
    ctx.setLocale('en');
    return ctx.t('settings.language') === 'Display language' && ctx.t('race.lineup') === 'Lineup';
  })());
t('ja に戻して確認', (function(){ ctx.setLocale('ja'); return ctx.t('settings.language') === '表示言語'; })());

console.log('');
console.log('[translatePage / applyLocale]');
t('translatePage は document 不在環境で 0', (function(){
  // ctx に document 無し → 0 を返す
  return ctx.translatePage(null) === 0;
})());
t('applyLocale で setLocale が走る',
  ctx.applyLocale('en') === true && ctx.getLocale() === 'en');
t('applyLocale 未対応 locale は false',
  ctx.applyLocale('zz') === false);

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
