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
t('en で 未翻訳キーは ja fallback',
  ctx.t('settings.kpi_mode') === 'KPI モード');
t('未対応 locale は false', ctx.setLocale('zz') === false);

console.log('');
console.log('[params 置換]');
ctx.I18N_TABLES.ja['greet'] = 'こんにちは {{name}} さん';
ctx.setLocale('ja');
t('{{name}} 置換', ctx.t('greet', {name: '太郎'}) === 'こんにちは 太郎 さん');
t('params 欠如時は placeholder 残し', ctx.t('greet', {}) === 'こんにちは {{name}} さん');

console.log('');
console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
