/**
 * Click BOSS filter UI and capture resulting URL query params (raw CDP).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { ensureBossChrome } = require('../dist/crawler/bossBrowser.js');

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
      reject(new Error('timeout ' + method));
    }, 30000);
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

async function evaluate(wsUrl, expression) {
  const r = await cdpCall(wsUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result.value;
}

function parseSearch(href) {
  try {
    const u = new URL(href);
    const o = {};
    u.searchParams.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  } catch {
    return {};
  }
}

(async () => {
  const userDataDir =
    process.env.BOSS_USER_DATA_DIR ||
    path.join(process.env.USERPROFILE || '', '.cursor-boss-zhipin-profile');
  const session = await ensureBossChrome(userDataDir);
  const port = session.port;
  const start =
    'https://www.zhipin.com/web/geek/job?query=' +
    encodeURIComponent('用户研究') +
    '&city=101010100';
  await httpJson('PUT', '/json/new?' + encodeURIComponent(start), port);
  await new Promise((r) => setTimeout(r, 4500));
  const list = await httpJson('GET', '/json/list', port);
  const page = (list || []).find(
    (t) => t.type === 'page' && String(t.url || '').includes('zhipin.com') && String(t.url || '').includes('geek/job')
  );
  if (!page?.webSocketDebuggerUrl) throw new Error('no geek/job page');
  const ws = page.webSocketDebuggerUrl;
  await cdpCall(ws, 'Runtime.enable');

  const steps = [];
  const snap = async (label) => {
    const href = await evaluate(ws, 'location.href');
    steps.push({ label, href, params: parseSearch(href) });
  };

  await snap('initial');

  await evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('div,span,li,a')].find(
        (e) => (e.textContent || '').trim() === '工作经验' && e.children.length < 6
      );
      if (el) el.click();
      return !!el;
    })()`
  );
  await new Promise((r) => setTimeout(r, 1200));
  const expOpts = await evaluate(
    ws,
    `(() => {
      const wanted = ['不限','在校生','应届生','实习','1年以内','1-3年','3-5年','5-10年','10年以上'];
      return wanted.map((t) => {
        const el = [...document.querySelectorAll('li,a,span,div')].find(
          (e) => (e.textContent || '').trim() === t
        );
        if (!el) return { t, found: false };
        return {
          t,
          found: true,
          ka: el.getAttribute('ka'),
          dataVal: el.getAttribute('data-val') || el.getAttribute('data-value'),
          href: el.getAttribute('href'),
          className: el.className,
        };
      });
    })()`
  );
  await evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('li,a,span,div')].find(
        (e) => (e.textContent || '').trim() === '1-3年'
      );
      if (el) el.click();
      return !!el;
    })()`
  );
  await new Promise((r) => setTimeout(r, 2500));
  await snap('after_experience_1-3');

  await evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('div,span,li,a')].find(
        (e) => (e.textContent || '').trim() === '薪资待遇' && e.children.length < 6
      );
      if (el) el.click();
      return !!el;
    })()`
  );
  await new Promise((r) => setTimeout(r, 1200));
  const salOpts = await evaluate(
    ws,
    `(() => {
      const texts = [...new Set(
        [...document.querySelectorAll('li,a,span,div')]
          .map((e) => (e.textContent || '').trim())
          .filter((t) => /^(不限|\\d+-\\d+K|\\d+K以上)$/i.test(t))
      )];
      return texts.slice(0, 20).map((t) => {
        const el = [...document.querySelectorAll('li,a,span,div')].find(
          (e) => (e.textContent || '').trim() === t
        );
        return {
          t,
          ka: el && el.getAttribute('ka'),
          dataVal: el && (el.getAttribute('data-val') || el.getAttribute('data-value')),
          href: el && el.getAttribute('href'),
        };
      });
    })()`
  );
  await evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('li,a,span,div')].find(
        (e) => (e.textContent || '').trim() === '20-50K'
      );
      if (el) el.click();
      return !!el;
    })()`
  );
  await new Promise((r) => setTimeout(r, 2500));
  await snap('after_salary_20-50K');

  await evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('div,span,li,a')].find(
        (e) => (e.textContent || '').trim() === '学历要求' && e.children.length < 6
      );
      if (el) el.click();
      return !!el;
    })()`
  );
  await new Promise((r) => setTimeout(r, 1200));
  const degOpts = await evaluate(
    ws,
    `(() => {
      const wanted = ['不限','初中及以下','中专/中技','高中','大专','本科','硕士','博士'];
      return wanted.map((t) => {
        const el = [...document.querySelectorAll('li,a,span,div')].find(
          (e) => (e.textContent || '').trim() === t
        );
        if (!el) return { t, found: false };
        return {
          t,
          found: true,
          ka: el.getAttribute('ka'),
          dataVal: el.getAttribute('data-val') || el.getAttribute('data-value'),
          href: el.getAttribute('href'),
        };
      });
    })()`
  );
  await evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('li,a,span,div')].find(
        (e) => (e.textContent || '').trim() === '本科'
      );
      if (el) el.click();
      return !!el;
    })()`
  );
  await new Promise((r) => setTimeout(r, 2500));
  await snap('after_degree_本科');

  // Diff keys newly appearing vs initial
  const initial = steps[0].params;
  const verifiedKeys = {};
  for (const s of steps.slice(1)) {
    for (const [k, v] of Object.entries(s.params)) {
      if (initial[k] !== v) {
        if (!verifiedKeys[k]) verifiedKeys[k] = [];
        verifiedKeys[k].push({ step: s.label, value: v });
      }
    }
  }

  const out = {
    discoveredAt: new Date().toISOString(),
    note: 'Only params that appeared in location.search after UI clicks are verified.',
    steps,
    expOpts,
    salOpts,
    degOpts,
    verifiedKeys,
  };
  const dest = path.join(__dirname, '..', 'test-results', 'boss-filter-click-probe.json');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ verifiedKeys, steps, dest }, null, 2));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
