/**
 * テストを「別の日時」に走らせるための時計の差し替え（2026-11-25）
 *
 *   FAKE_NOW=2027-07-02T23:55:00+09:00 node -r ./scripts/tests/_fake_clock.js scripts/tests/test_racer_page.js
 *
 * Date を、FAKE_NOW から実時間どおりに進む時計に差し替える。_vm_harness.js は host の Date を
 * そのまま vm に渡すので、アプリのコード（assets/app.js）も同じ時計を読む。
 *
 * 目的: 「書いた日にだけ通るテスト」を残さない。日付の入ったデータ（出場予定・級の適用期間など）を
 * 使うテストは、コードが実時計を直接読んでいると、ある日を境に落ち始める（2026-11-19 の
 * test_status_banner_freshness.js、2026-11-25 の選手ページ 第 2 段階で実際に起きた）。
 */
const RealDate = Date;
const base = RealDate.parse(process.env.FAKE_NOW || '');
if (!Number.isFinite(base)) throw new Error('FAKE_NOW に日時を入れてください（例: 2027-07-02T23:55:00+09:00）');
const t0 = RealDate.now();
const now = () => base + (RealDate.now() - t0);
class FakeDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(now());
    else super(...a);
  }
  static now() {
    return now();
  }
}
globalThis.Date = FakeDate;
