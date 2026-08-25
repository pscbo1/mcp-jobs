/**
 * Click each BOSS filter option and record verified URL param codes.
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

async function getGeekPageWs(port) {
  const list = await httpJson('GET', '/json/list', port);
  const page = (list || []).find(
    (t) =>
      t.type === 'page' &&
      String(t.url || '').includes('zhipin.com') &&
      String(t.url || '').includes('geek/job')
  );
  if (!page?.webSocketDebuggerUrl) throw new Error('no geek/job page');
  await cdpCall(page.webSocketDebuggerUrl, 'Runtime.enable');
  return page.webSocketDebuggerUrl;
}

async function openFresh(port) {
  const start =
    'https://www.zhipin.com/web/geek/job?query=' +
    encodeURIComponent('用户研究') +
    '&city=101010100';
  await httpJson('PUT', '/json/new?' + encodeURIComponent(start), port);
  await new Promise((r) => setTimeout(r, 3500));
  return getGeekPageWs(port);
}

async function openFilter(ws, label) {
  await evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('div,span,li,a')].find(
        (e) => (e.textContent || '').trim() === ${JSON.stringify(label)} && e.children.length < 6
      );
      if (el) el.click();
      return !!el;
    })()`
  );
  await new Promise((r) => setTimeout(r, 900));
}

async function clickOption(ws, text) {
  return evaluate(
    ws,
    `(() => {
      const el = [...document.querySelectorAll('li,a,span,div')].find(
        (e) => (e.textContent || '').trim() === ${JSON.stringify(text)}
      );
      if (el) { el.click(); return true; }
      return false;
    })()`
  );
}

async function mapFilter(port, filterLabel, labels, paramName) {
  const map = {};
  for (const label of labels) {
    const ws = await openFresh(port);
    await openFilter(ws, filterLabel);
    const ok = await clickOption(ws, label);
    await new Promise((r) => setTimeout(r, 2200));
    const href = await evaluate(ws, 'location.href');
    const params = parseSearch(href);
    if (ok && params[paramName]) {
      map[label] = String(params[paramName]);
      console.log(`${paramName} ${label} => ${params[paramName]}`);
    } else {
      console.log(`${paramName} ${label} => MISSING ok=${ok} href=${href}`);
    }
  }
  return map;
}

(async () => {
  const userDataDir =
    process.env.BOSS_USER_DATA_DIR ||
    path.join(process.env.USERPROFILE || '', '.cursor-boss-zhipin-profile');
  const session = await ensureBossChrome(userDataDir);
  const port = session.port;

  const experience = await mapFilter(
    port,
    '工作经验',
    ['在校生', '应届生', '1年以内', '1-3年', '3-5年', '5-10年', '10年以上'],
    'experience'
  );
  const salary = await mapFilter(
    port,
    '薪资待遇',
    ['3K以下', '3-5K', '5-10K', '10-20K', '20-50K', '50K以上'],
    'salary'
  );
  const degree = await mapFilter(
    port,
    '学历要求',
    ['初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士'],
    'degree'
  );

  const page2 =
    'https://www.zhipin.com/web/geek/job?query=' +
    encodeURIComponent('用户研究') +
    '&city=101010100&page=2';
  await httpJson('PUT', '/json/new?' + encodeURIComponent(page2), port);
  await new Promise((r) => setTimeout(r, 4000));
  const list = await httpJson('GET', '/json/list', port);
  const pageTab = (list || []).find(
    (t) => t.type === 'page' && /[?&]page=2\b/.test(String(t.url || ''))
  );
  let pageParamVerified = Boolean(pageTab);
  if (pageTab?.webSocketDebuggerUrl) {
    await cdpCall(pageTab.webSocketDebuggerUrl, 'Runtime.enable');
    const href = await evaluate(pageTab.webSocketDebuggerUrl, 'location.href');
    pageParamVerified = /[?&]page=2\b/.test(href);
  }

  const out = {
    discoveredAt: new Date().toISOString(),
    note: 'Codes recorded only when location.search contained the param after a UI click.',
    experience,
    salary,
    degree,
    pageParamVerified,
  };
  const dest = path.join(__dirname, '..', 'test-results', 'boss-verified-filter-codes.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
