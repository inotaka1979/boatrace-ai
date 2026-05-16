// =============================================================================
// boatrace-scrape-trigger — Cloudflare Worker
//
// 2026-05-16: Path B 簡素化により scheduled() / /trigger 撤去。
//   GITHUB_TOKEN への依存を完全に断ち、PAT 失効による silent halt を根絶。
//   scrape のスケジュールは GHA cron が単独で担当する。
//   この Worker は CORS プロキシ (/odds-proxy) と /health のみを提供。
//
// 提供エンドポイント:
//   GET /health      — 疎通確認 (token 不要)
//   GET /odds-proxy  — boatrace.jp odds HTML を CORS 越しに PWA へ pass-through
// =============================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        ok: true,
        time: new Date().toISOString(),
        // PAT 依存撤去済 (Path B / 2026-05-16)
        mode: 'odds-proxy-only',
      }), { headers: { 'content-type': 'application/json' } });
    }

    // ---------------------------------------------------------------------
    // /odds-proxy — boatrace.jp odds HTML を CORS 越しに PWA へ pass-through
    //
    //   GET /odds-proxy?type=trifecta&sid=22&rno=5&hd=20260510
    //
    //   type: 'win' | 'exacta' | 'trifecta'
    //   sid:  1-24 stadium id
    //   rno:  1-12 race number
    //   hd:   YYYYMMDD
    //
    // edge cache: 15s で boatrace.jp への負荷を抑制
    // ---------------------------------------------------------------------
    if (url.pathname === '/odds-proxy') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, OPTIONS',
            'access-control-max-age': '86400',
          },
        });
      }
      const type = url.searchParams.get('type') || '';
      const sid  = url.searchParams.get('sid') || '';
      const rno  = url.searchParams.get('rno') || '';
      const hd   = url.searchParams.get('hd')  || '';
      const endpoints = { win: 'oddstf', exacta: 'odds2tf', trifecta: 'odds3t' };
      if (!endpoints[type] || !/^\d+$/.test(sid) || !/^\d+$/.test(rno) || !/^\d{8}$/.test(hd)) {
        return new Response('bad params', {
          status: 400,
          headers: { 'access-control-allow-origin': '*' },
        });
      }
      const sidNum = parseInt(sid);
      if (sidNum < 1 || sidNum > 24) {
        return new Response('bad sid', {
          status: 400,
          headers: { 'access-control-allow-origin': '*' },
        });
      }
      const jcd = String(sidNum).padStart(2, '0');
      const upstream = `https://www.boatrace.jp/owpc/pc/race/${endpoints[type]}?rno=${parseInt(rno)}&jcd=${jcd}&hd=${hd}`;
      try {
        const res = await fetch(upstream, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 boatrace-scrape-trigger',
          },
          cf: { cacheTtl: 15, cacheEverything: true },
        });
        if (!res.ok) {
          return new Response(`upstream ${res.status}`, {
            status: 502,
            headers: { 'access-control-allow-origin': '*' },
          });
        }
        const html = await res.text();
        return new Response(html, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=15',
          },
        });
      } catch (e) {
        return new Response(`error: ${e.message}`, {
          status: 502,
          headers: { 'access-control-allow-origin': '*' },
        });
      }
    }

    return new Response('boatrace-scrape-trigger (odds-proxy mode)\n');
  },
};
