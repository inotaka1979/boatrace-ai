# CSP `unsafe-inline` 撤去 — 段階移行ロードマップ (Epic 10)

## 現状（2026-05-05）

```
script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;
```

`'unsafe-inline'` は **inline event handler** (`onclick="..."`) と **inline `<script>`** の両方を許可するための妥協。

### 現状の inline 依存

| 場所 | 数 | 目的 |
|------|-----|------|
| `index.html` 内 `onclick=` | 23 | nav-btn / card / button |
| `scripts/prerender_top.py` 出力 | 24カード | iOS standalone PWA で `data-sid` delegation が不発になるケース対策 (PJ Phase) |
| `<script>` タグ自体 | 0 | すでに全て外部ファイル化済 (PE-5) |

## なぜ即座に撤去できないか

1. **PJ Phase の致命バグの再発リスク** — iOS ホーム画面追加 PWA で `_setupStadiumDelegation()` が不発になる事例があり、`onclick` を inline で書くことで救済している。これを撤去すると tap が無反応になる端末がある。
2. **delegation だけに依存すると iOS 一部バージョンで bubble しない** — 検証された WebKit エンジンの fallback パターン。
3. **大規模 onclick 削減は CI safety net 必須** — Epic 8 で導入した L1 WebKit smoke / L2 iOS Simulator nightly が稼働してベースラインが取れてから。

## 段階移行プラン

### Phase 1（実装済み・本 Epic 10）— scaffold + 計測

- [x] 本ドキュメント追加（移行計画明文化）
- [x] `build/build.mjs` に nonce 生成ヘルパ追加（feature flag、デフォルト OFF）
- [x] index.html に `<!-- CSP-NONCE-PLACEHOLDER -->` マーカー追加
- [x] CSP の現状理由を inline コメント化

### Phase 2（次PR）— inline onclick の削減

- [ ] `index.html` の onclick 23件を `data-action="xxx"` + delegation に置換
- [ ] `scripts/prerender_top.py` の 24カード onclick を `data-sid` のみに（delegation 一本化）
- [ ] L1 WebKit smoke で全動作確認 → green を 7日連続維持
- [ ] L2 iOS Simulator nightly で実環境検証

### Phase 3（次々PR）— `unsafe-inline` 撤去

- [ ] `script-src 'self' 'nonce-XXX' 'strict-dynamic'` に切替
- [ ] `<script>` タグ全てに nonce 付与（build 時注入）
- [ ] sw.js キャッシュ戦略変更（nonce 毎回変わるため）
- [ ] iOS 16.4 / 17 / 18 各バージョンで動作確認

### Phase 4（将来）— `style-src 'unsafe-inline'` も撤去

- [ ] CSS-in-JS / 動的 style 利用箇所を整理
- [ ] hash ベースまたは nonce ベースに移行

## 計測方針

毎 PR で `grep -c 'onclick=' index.html` の数を CI が比較し、増えていたら warn。

## 参考

- [MDN: CSP script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src)
- [PJ Phase 真因記録](../CLAUDE.md) — iOS standalone PWA タップ不能の経緯
