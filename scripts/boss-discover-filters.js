/**
 * Discover BOSS desktop filter URL params from a live logged-in Chrome (raw CDP, no Playwright).
 * Writes test-results/boss-filter-params.json (gitignored).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { ensureBossChrome } = require('../dist/crawler/bossBrowser.js');

const OUT = path.join(__dirname, '..', 'test-results', 'boss-filter-params.json');

function httpJson(method, reqPath, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: reqPath, method }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error('CDP timeout ' + method));
    }, 25000);
    ws.on('open', () => ws.send(JSON.stringify({ id, method, params })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === id) {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

(async () => {
  const userDataDir =
    process.env.BOSS_USER_DATA_DIR ||
    path.join(process.env.USERPROFILE || '', '.cursor-boss-zhipin-profile');
  const session = await ensureBossChrome(userDataDir);
  const port = session.port;
  const url =
    'https://www.zhipin.com/web/geek/job?query=' +
    encodeURIComponent('用户研究') +
    '&city=101010100';
  const opened = await httpJson('PUT', '/json/new?' + encodeURIComponent(url), port);
  await new Promise((r) => setTimeout(r, 5000));
  const list = await httpJson('GET', '/json/list', port);
  const page =
    (list || []).find((t) => t.id === opened?.id) ||
    (list || []).find((t) => t.type === 'page' && /zhipin\.com/.test(t.url || ''));
  if (!page?.webSocketDebuggerUrl) throw new Error('no page');

  await cdpCall(page.webSocketDebuggerUrl, 'Runtime.enable');
  const result = await cdpCall(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `(() => {
      const abs = (href) => {
        if (!href) return null;
        try { return new URL(href, location.origin).href; } catch { return href; }
      };
      const parseParams = (href) => {
        try {
          const u = new URL(href, location.origin);
          const o = {};
          u.searchParams.forEach((v, k) => { o[k] = v; });
          return { path: u.pathname, params: o };
        } catch { return null; }
      };
      const filterRoots = [
        ...document.querySelectorAll('.search-condition-wrapper, .filter-condition, .job-search-filter, .condition-filter, [class*="filter"], [class*="condition"]')
      ];
      const anchors = [...document.querySelectorAll('a[href*="geek/job"], a[href*="experience"], a[href*="salary"], a[href*="degree"], a[href*="page="]')];
      const linkSamples = anchors.slice(0, 80).map(a => ({
        text: (a.textContent || '').trim().slice(0, 40),
        href: abs(a.getAttribute('href')),
        parsed: parseParams(a.getAttribute('href') || '')
      })).filter(x => x.href);

      // Collect data-* / option nodes near filter labels
      const labeled = [];
      const labels = ['工作经验','薪资待遇','学历要求','求职类型','公司规模','融资阶段','公司行业'];
      for (const lab of labels) {
        const nodes = [...document.querySelectorAll('div,li,span,a')].filter(el => (el.textContent || '').trim() === lab);
        for (const n of nodes.slice(0, 3)) {
          const box = n.closest('div') || n.parentElement;
          const opts = [...(box ? box.querySelectorAll('a, li, span[data-val], [ka]') : [])]
            .slice(0, 30)
            .map(el => ({
              text: (el.textContent || '').trim().slice(0, 30),
              href: abs(el.getAttribute('href')),
              ka: el.getAttribute('ka'),
              dataVal: el.getAttribute('data-val') || el.getAttribute('data-value'),
              parsed: parseParams(el.getAttribute('href') || '')
            }))
            .filter(o => o.text && o.text !== lab);
          labeled.push({ label: lab, options: opts });
        }
      }

      return {
        url: location.href,
        title: document.title,
        current: parseParams(location.href),
        filterRootCount: filterRoots.length,
        linkSamples,
        labeled
      };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  const value = result.result.value;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ discoveredAt: new Date().toISOString(), note: 'Only wire params seen in live URLs; do not invent codes.', ...value }, null, 2)
  );
  console.log(JSON.stringify({
    url: value.url,
    current: value.current,
    labeledSummary: (value.labeled || []).map((l) => ({
      label: l.label,
      optionCount: (l.options || []).length,
      sample: (l.options || []).slice(0, 8),
    })),
    out: OUT,
  }, null, 2));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
