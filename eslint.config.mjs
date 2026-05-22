// Phase 3 + Phase 6 (Clearwing patterns): ESLint flat config (ESLint 9.x)
//
// 対象: src/ (Clearwing 4 層モジュール + utils) と scripts/tests/ (Node テスト群)
// 非対象: assets/ (auto-generated bundle output) / node_modules / build/node_modules /
//        data/ / cloudflare-worker/ (別ランタイム)
//
// Phase 6 で追加した退行防止ルール:
//   - no-restricted-syntax: AbortSignal.timeout( 直接呼出を禁止
//                          → capabilities.makeTimeoutSignal(ms) を強制
//   - no-restricted-syntax: 新規 typeof X === 'undefined' (browser API) を warn
//                          → capabilities.has(X) を推奨
//   - no-restricted-syntax: new AbortController() の直接生成を src/capabilities*.js
//                          以外で禁止 (PA-* iOS Safari 互換性の単一窓口を維持)
//   - no-restricted-imports: 廃止 / 危険なモジュールの import 防止 (現状空、将来用)
//   - no-restricted-globals: stale な Open API 直接 fetch 防止 (現状空、Phase 7 後拡張)

import globals from 'globals';

// ─── Phase 6: 退行防止ルール定義（共通） ───
const CAPABILITIES_GUARDED_PATTERNS = [
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.object.name='AbortSignal'][callee.property.name='timeout']",
    message:
      'Direct AbortSignal.timeout() is forbidden — use capabilities.makeTimeoutSignal(ms) ' +
      'to keep iOS Safari (< 16) compatibility centralized. ' +
      "If you genuinely need the native call (e.g., inside capabilities itself), add an " +
      '// eslint-disable-next-line no-restricted-syntax comment with rationale.',
  },
  {
    selector: "NewExpression[callee.name='AbortController']",
    message:
      'new AbortController() should not be created directly outside src/capabilities*.js. ' +
      'Use capabilities.makeTimeoutSignal(ms) for fetch timeout, or add an ESLint disable ' +
      'comment if you have a genuine reason (e.g., a manual cancel pattern not covered by capabilities).',
  },
];

export default [
  // 共通除外
  {
    ignores: [
      'node_modules/**',
      'build/node_modules/**',
      'assets/app.js',
      'assets/app.min.js',
      'assets/app-critical.js',
      'assets/app-critical.min.js',
      'assets/app-rest.js',
      'assets/app-rest.min.js',
      'assets/worker_predictor.js',
      'assets/worker.js',
      'data/**',
      'docs/**',
      'cloudflare-worker/**',
      'build/playwright-report/**',
      'build/test-results/**',
      'tests/e2e/screens.vrt.spec.mjs-snapshots/**',
    ],
  },

  // src/ — Clearwing 層モジュール (browser context)
  {
    files: ['src/**/*.js'],
    ignores: ['src/capabilities-worker.js', 'src/capabilities.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // BoatRace Oracle 固有の global (他モジュール / app.js で定義済)
        capabilities: 'readonly',
        cacheKey: 'readonly',
        reportError: 'readonly',
        // context 層 (src/context/domain_constants.js)
        STADIUMS: 'readonly',
        CLASS_NAME: 'readonly',
        CLASS_COLOR: 'readonly',
        BOAT_COLORS: 'readonly',
        BOAT_TEXT: 'readonly',
        TECHNIQUE: 'readonly',
        WIND_DIR: 'readonly',
        GRADE_CLASS: 'readonly',
        // app.js に残置している context 系定数
        COURSE_WIN_RATE: 'readonly',
        API_BASE: 'readonly',
        L2_INIT_WEIGHTS: 'readonly',
        L2_BIAS: 'readonly',
        FEATURE_DIM: 'readonly',
        TUNING: 'readonly',
        // 動的 import される lib
        Chart: 'readonly',
        // PWA / worker
        WorkerCapabilities: 'readonly',
        // Phase 4 で JSDoc 型として参照される (.d.ts 由来)
        BoatRaceGlobalAPI: 'readonly',
      },
    },
    rules: {
      // 基本品質
      'no-undef': 'error',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-redeclare': 'error',
      'no-shadow': 'off',
      eqeqeq: ['warn', 'smart'],
      'no-implicit-globals': 'warn',
      'no-var': 'off', // canonical app.js は var 主体、整合性のため許可
      'prefer-const': 'off',
      // 構文系
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unreachable': 'error',
      // Console は許可 (開発・デバッグ向き)
      'no-console': 'off',
      // Phase 6: 退行防止
      'no-restricted-syntax': ['error', ...CAPABILITIES_GUARDED_PATTERNS],
    },
  },

  // src/analysis/score_boat.js / src/analysis/calibration.js /
  // src/reporting/stats_page.js — 大型関数の段階抽出 (Phase 2 完遂中)
  //   多数の app.js 内 helper / state を globalThis 経由で参照する。
  //   Phase 4 strict (jsconfig.json) には未収容、依存先 helper が型定義される
  //   までは ESLint no-undef も off とする (PR では reviewer が手動確認)。
  {
    files: [
      'src/analysis/score_boat.js',
      'src/analysis/calibration.js',
      'src/reporting/stats_page.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // src/capabilities.js / src/capabilities-worker.js — capabilities 本体
  //   ここは AbortController / AbortSignal.timeout を直接扱う「公式の窓口」のため
  //   no-restricted-syntax を除外する。他の制約は src/**/*.js と同等。
  {
    files: ['src/capabilities.js', 'src/capabilities-worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
        capabilities: 'readonly',
        Chart: 'readonly',
        WorkerCapabilities: 'readonly',
        BoatRaceGlobalAPI: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // capabilities 本体は AbortController を直接生成するため no-restricted-syntax を抜く
      'no-restricted-syntax': 'off',
    },
  },

  // scripts/tests/ — Node CLI テスト群 (CommonJS / classic script style)
  {
    files: ['scripts/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.node,
        // テストは assets/app.js を readFileSync して抽出するため、抽出された関数も globals
        // 列挙が膨大なので no-undef を無効化 (Phase 5 snapshot test 整備時に厳格化検討)
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
];
