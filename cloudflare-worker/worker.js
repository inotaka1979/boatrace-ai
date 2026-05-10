// =============================================================================
// boatrace-scrape-trigger — Cloudflare Worker
//
// 用途: Cloudflare cron (秒精度) で GitHub Actions workflow_dispatch を叩き、
//       Pi 不要かつ GHA cron 遅延 (5–30 min) を回避して 3 分鮮度を維持する。
//
// cron trigger: '*/3 * * * *' (3 分間隔、24/7)
//   → JST 時刻判定で対象 workflow を選別し dispatch
//
// 環境変数 (Cloudflare Workers Secret):
//   GITHUB_TOKEN     — Fine-grained PAT, actions:write for inotaka1979/boatrace-ai
//   TRIGGER_SECRET   — 手動 /trigger エンドポイント用の合言葉 (任意)
//
// 監視:
//   - GET /health で疎通確認
//   - GET /trigger?secret=XXX&workflow=scrape-odds.yml で手動 dispatch
// =============================================================================

const REPO_OWNER = 'inotaka1979';
const REPO_NAME = 'boatrace-ai';
const GHA_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows`;

async function dispatchWorkflow(workflowFile, token) {
  const url = `${GHA_BASE}/${workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'boatrace-scrape-trigger',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`dispatch ${workflowFile}: ${res.status} ${body.slice(0, 200)}`);
  }
  return true;
}

export default {
  // -----------------------------------------------------------------------
  // Cron entry point — 3 分毎に発火
  // -----------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    const token = env.GITHUB_TOKEN;
    if (!token) {
      console.error('GITHUB_TOKEN not configured');
      return;
    }

    // event.scheduledTime は ms epoch (UTC)。JST = UTC+9h
    const now = new Date(event.scheduledTime);
    const utcMs = now.getTime();
    const jstMs = utcMs + 9 * 3600 * 1000;
    const jst = new Date(jstMs);
    const jstHour = jst.getUTCHours();
    const jstMin = jst.getUTCMinutes();

    const tasks = [];
    const dispatched = [];

    // odds: JST 08:00–21:59、毎 3 分
    if (jstHour >= 8 && jstHour < 22) {
      tasks.push(dispatchWorkflow('scrape-odds.yml', token));
      dispatched.push('odds');
    }

    // previews: JST 08:00–21:59、毎 3 分
    if (jstHour >= 8 && jstHour < 22) {
      tasks.push(dispatchWorkflow('scrape-previews.yml', token));
      dispatched.push('previews');
    }

    // results: JST 10:00–22:59、毎 6 分（cron tick の半分）
    //   minute % 6 < 3 で偶数 tick だけ走らせる: 0,3,6→0/6 にヒット
    if (jstHour >= 10 && jstHour < 23 && jstMin % 6 < 3) {
      tasks.push(dispatchWorkflow('scrape-results.yml', token));
      dispatched.push('results');
    }

    // tide: JST 08:00 の最初の tick だけ
    if (jstHour === 8 && jstMin < 3) {
      tasks.push(dispatchWorkflow('scrape-tide.yml', token));
      dispatched.push('tide');
    }

    const results = await Promise.allSettled(tasks);
    const errors = results.filter(r => r.status === 'rejected');
    for (const e of errors) console.error(e.reason);

    console.log(
      `tick JST ${String(jstHour).padStart(2,'0')}:${String(jstMin).padStart(2,'0')} ` +
      `dispatched=[${dispatched.join(',')}] errors=${errors.length}`
    );
  },

  // -----------------------------------------------------------------------
  // HTTP entry point — ヘルスチェック / 手動 trigger / odds 実時間プロキシ
  // -----------------------------------------------------------------------
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        ok: true,
        time: new Date().toISOString(),
        token_configured: !!env.GITHUB_TOKEN,
      }), { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname === '/trigger') {
      const secret = url.searchParams.get('secret') || '';
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const wf = url.searchParams.get('workflow') || 'scrape-previews.yml';
      try {
        await dispatchWorkflow(wf, env.GITHUB_TOKEN);
        return new Response(`dispatched ${wf}\n`);
      } catch (e) {
        return new Response(`error: ${e.message}\n`, { status: 500 });
      }
    }

    // ---------------------------------------------------------------------
    // /odds-proxy — boatrace.jp odds HTML を CORS 越しに PWA へ pass-through
    //
    // 用途: GH Actions / scrape_odds_fast.py が止まっても、PWA が直接
    //       実時間オッズを取得できるようにする保険。
    //
    //   GET /odds-proxy?type=trifecta&sid=22&rno=5&hd=20260510
    //
    //   type: 'win' | 'exacta' | 'trifecta'
    //   sid:  1-24 stadium id
    //   rno:  1-12 race number
    //   hd:   YYYYMMDD
    //
    // レスポンス: HTML 本文 + CORS allow-origin: *
    //             (PWA 側で DOMParser でパース)
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

    return new Response('boatrace-scrape-trigger is running\n');
  },
};
