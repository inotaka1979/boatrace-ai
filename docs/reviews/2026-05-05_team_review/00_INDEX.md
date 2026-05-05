# 2026-05-05 チームレビュー原本アーカイブ

PMの指示で 6 名の専門家エージェントが独立に `/home/pi/boatrace-ai` をレビューし、その原本をここに保存する。
統合版は `../../2026-05-05_チーム改善設計書.md` を参照。

## 体制

| 役割 | ファイル | 担当領域 |
|------|---------|----------|
| 設計者A | [01_designer_A_ux_pwa.md](./01_designer_A_ux_pwa.md) | UX / UI / 情報設計 / PWA |
| 設計者B | [02_designer_B_data_backend.md](./02_designer_B_data_backend.md) | データパイプライン / バックエンド / 予測エンジン構造 |
| コーダー | [03_coder_implementation.md](./03_coder_implementation.md) | コード品質 / 実装パターン / テスタビリティ / ビルド |
| QA-A | [04_qa_A_perf_a11y.md](./04_qa_A_perf_a11y.md) | 性能 / アクセシビリティ / テスト品質 |
| QA-B | [05_qa_B_security_resilience.md](./05_qa_B_security_resilience.md) | セキュリティ / 障害耐性 / データ整合性 |
| 競艇プロ | [06_pro_boatrace_domain.md](./06_pro_boatrace_domain.md) | 競艇ドメイン視点 / 予測ロジック妥当性 / ROI |

## 共通指摘（信頼度高）

3 名以上が独立に指摘した論点（統合設計書で最優先扱い）:

1. **localStorage の容量上限・スキーマバージョニング** — 設計者B / QA-B / コーダー
2. **iOS standalone PWA の状態復元・致命バグ再発防止** — 設計者A / QA-A / QA-B
3. **CI / 品質ゲート不足**（Lighthouse / VRT / mypy / size budget） — コーダー / QA-A / 設計者B
4. **EV / ROI ベースの買い目絞り** — 競艇プロ（設計者B も予測層責務分離で同方向）

## 統合設計書

- `../../2026-05-05_チーム改善設計書.md` — P0 11件 / P1 18件 / P2 8件 / 4スプリントロードマップ
