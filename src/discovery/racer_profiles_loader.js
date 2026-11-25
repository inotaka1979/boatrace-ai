// 2026-11-25: 選手プロフィール（data/db/racerDB.json の元の形: 名前・かな・支部・級・コース別成績 …）の取得。
//   Discovery 層（network IO はここだけ）。選手ページの lazy chunk (app-rest-racer) に同梱。
//
//   予測用の racerDB（app.js）は起動時に同じファイルを読むが、予測に使う項目しか残さない
//   （かな・支部・年齢・体重・期別勝率・コース別の着順分布は捨てる）。loadDeferredData がそのとき
//   元の形を globalThis._racerProfiles に残すので、通常ここからは取りに行かない。
//   起動時の取得がまだ終わっていなければそれを待ち、失敗していたときだけ 1 回取りに行く
//   （約 800KB を二重に落とさない）。
//
// Public: _loadRacerProfiles / _racerProfiles / _racerProfilesAt (globalThis)

'use strict';

var _racerProfilesLoading = false;

// 届いたら onLoaded() を呼ぶ（開いている選手ページの描き直し用）。既に在れば何もしない。
function _loadRacerProfiles(onLoaded) {
  if (globalThis._racerProfiles || _racerProfilesLoading) return;
  _racerProfilesLoading = true;
  var startup = globalThis._racerProfilesReady; // loadDeferredData の取得（reject しない）
  var wait = startup && typeof startup.then === 'function' ? startup : Promise.resolve();
  wait
    .then(function () {
      if (globalThis._racerProfiles || typeof fetch !== 'function') return null;
      return fetch('data/db/racerDB.json', { cache: 'no-cache' }).then(function (r) {
        return r.ok ? r.json() : null;
      });
    })
    .then(function (j) {
      if (j && j.racers && !globalThis._racerProfiles) {
        globalThis._racerProfiles = j.racers;
        globalThis._racerProfilesAt = j.updated_at || '';
      }
      if (globalThis._racerProfiles && typeof onLoaded === 'function') onLoaded();
    })
    .catch(function () {})
    .then(function () {
      _racerProfilesLoading = false;
    });
}

globalThis._loadRacerProfiles = _loadRacerProfiles;
