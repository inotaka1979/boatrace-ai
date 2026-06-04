// Phase 4 (Clearwing patterns): ambient global declarations for tsc --noEmit
//
// 目的:
//   - Clearwing 4 層 (capabilities / discovery / analysis / reporting / context) の
//     モジュールは IIFE bundle として assets/app.js に注入され、globalThis に値を
//     公開する設計。tsc にこの runtime 形を伝えるための ambient .d.ts。
//   - 本ファイルは jsconfig.json の include 対象内ファイルからのみ参照される。
//     runtime には全く影響しない (interface / type 宣言だけで実体は持たない)。
//
// 設計:
//   - `interface Window` 拡張だと TS が DOM lib 経由で各プロパティを「グローバル
//     識別子」として公開し、`const capabilities = new Capabilities()` 等の
//     ローカル const と衝突する (TS2451)。
//   - そこで `BoatRaceGlobalAPI` インタフェースに集約し、各 src/ モジュールは
//     `/** @type {BoatRaceGlobalAPI & typeof globalThis} */ const _g = globalThis`
//     で型付きハンドルを作って `_g.X` 経由で型チェックを受ける。
//   - これでローカル識別子と global 拡張が衝突せず、JSDoc strict が通る。

// ─── Chart.js (動的 import / 起動時に存在しない) ───
declare const Chart: unknown;

// ─── capabilities 共通 API ───
interface CapabilitiesLike {
  has(name: string): boolean;
  refresh(name?: string): void;
  list(): string[];
  makeTimeoutSignal(ms: number): AbortSignal;
  runIdle?(fn: () => void, opts?: { delay?: number; timeout?: number; priority?: string }): unknown;
  probe?(name: string, opts?: { url?: string; ttlMs?: number }): Promise<boolean>;
}

// ─── BoatRace Oracle が globalThis に乗せる全 API surface ───
//
// 命名規則: src/ の各モジュールが globalThis に export する値はここに集約。
// 型を厳密化したい時はモジュール側 JSDoc と本ファイル両方を更新する。
interface BoatRaceGlobalAPI {
  // context layer (src/context/domain_constants.js)
  STADIUMS: Readonly<Record<number, string>>;
  CLASS_NAME: Readonly<Record<number, string>>;
  CLASS_COLOR: Readonly<Record<number, string>>;
  BOAT_COLORS: Readonly<Record<number, string>>;
  BOAT_TEXT: Readonly<Record<number, string>>;
  TECHNIQUE: Readonly<Record<number, string>>;
  WIND_DIR: Readonly<Record<number, string>>;
  GRADE_CLASS: Readonly<Record<number, { name: string; cls: string }>>;

  // capabilities (src/capabilities.js / src/capabilities-worker.js)
  capabilities: CapabilitiesLike;

  // discovery layer (src/discovery/openapi_client.js)
  BC_MAX_BYTES: number;
  WORKER_BASE: string;
  _apiHealth: Record<string, string>;
  _setApiHealth: (url: string, state: string) => void;
  _mapToWorkerUrl: (url: string) => string | null;
  _fetchOne: (url: string, timeoutMs?: number) => Promise<unknown>;
  fetchWithFallback: (url: string) => Promise<unknown>;
  validateApiPayload: (apiJson: unknown, key: string) => boolean;
  indexByStadiumRace: (apiJson: unknown, key: string) => Record<string, Record<string, unknown>> | null;
  indexPreviews: (apiJson: unknown) => Record<string, Record<string, unknown>> | null;
  indexResults: (apiJson: unknown) => Record<string, Record<string, unknown>> | null;
  _filterStalePreviews: (raw: unknown) => unknown;

  // reporting layer (src/reporting/status_banner.js)
  _renderApiHealthBanner: () => void;
  _renderFreshness: () => void;
  _dataLatestUpdatedAt: number;
  _dataTodayConfirmedAt: number;
  /** rt-fix P0-1: 最終 fetch 成功時刻 (epoch ms)。鮮度バッジが参照。 */
  _lastFetchOkAt: number;

  // analysis layer (src/analysis/backtest.js)
  _btParseDate: (s: string | null | undefined) => Date | null;
  runBacktestEngine: (history: unknown[], opts?: { periodDays?: number; stakePerBet?: number }) => unknown;
  runForwardChainBacktest: (history: unknown[], opts?: { warmupRaces?: number }) => unknown;
  _computeCalibrationMetrics: (entries: unknown[]) => {
    logLoss: number;
    brier: number;
    ece: number;
    n: number;
  };

  // app.js に残置している utility (src/ 外で定義)
  cacheKey: (url: string) => string;
  reportError: (info: { type?: string; message?: string; [k: string]: unknown }) => void;
  todayStr: () => string;
}
