// Phase 3 (Clearwing patterns): ESLint flat config (ESLint 9.x)
//
// 対象: src/ (Clearwing 4 層モジュール + utils) と scripts/tests/ (Node テスト群)
// 非対象: assets/ (auto-generated bundle output) / node_modules / build/node_modules /
//        data/ / cloudflare-worker/ (別ランタイム)
//
// Phase 6 で「AbortSignal.timeout 直接呼出禁止」「typeof X === 'undefined' を
// browser API について書くのは禁止 → capabilities.has(X) 強制」などのカスタムルールを追加予定。

import globals from 'globals';

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
    ignores: ['src/capabilities-worker.js'],
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
      },
    },
    rules: {
      // 基本品質
      'no-undef': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-redeclare': 'error',
      'no-shadow': 'off',
      'eqeqeq': ['warn', 'smart'],
      'no-implicit-globals': 'warn',
      'no-var': 'off',                // canonical app.js は var 主体、整合性のため許可
      'prefer-const': 'off',
      // 構文系
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unreachable': 'error',
      // Console は許可 (開発・デバッグ向き)
      'no-console': 'off',
    },
  },

  // src/capabilities-worker.js — Worker context
  {
    files: ['src/capabilities-worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.worker,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
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
