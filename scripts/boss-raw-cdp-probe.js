/**
 * Probe BOSS page via raw CDP WebSocket (no Playwright attach).
 * Chrome must already be running with --remote-debugging-port=9222.
 */
const http = require('http');
const fs = require('fs');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: 9222, path }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CDP timeout: ' + method));
    }, 20000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === id) {
        clearTimeout(timer);
        ws.close();
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
  let targets = await getJson('/json/list');
  let page = targets.find(
    (t) => t.type === 'page' && /zhipin\.com/.test(t.url || '')
  );
  if (!page) {
    // open via json/new
    const q =
      'https://www.zhipin.com/web/geek/job?query=' +
      encodeURIComponent('用户研究') +
      '&city=101010100';
    page = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: 9222,
          path: '/json/new?' + encodeURIComponent(q),
          method: 'PUT',
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
    await new Promise((r) => setTimeout(r, 5000));
    targets = await getJson('/json/list');
    page =
      targets.find((t) => t.id === page.id) ||
      targets.find((t) => t.type === 'page' && /zhipin/.test(t.url || ''));
  }

  if (!page || !page.webSocketDebuggerUrl) {
    throw new Error('No zhipin page target');
  }

  await cdpCall(page.webSocketDebuggerUrl, 'Runtime.enable');
  const evalResult = await cdpCall(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `(() => {
      const cards = [...document.querySelectorAll('.job-card-box, .job-card-wrapper')];
      const text = (document.body && document.body.innerText || '').slice(0, 1000);
      const login = /登录|注册|扫码|验证码|安全验证/.test(text) || /web\\/user|passport|login/i.test(location.href);
      const sample = cards.slice(0, 8).map(el => {
        const t = (el.innerText || '').split(/\\n+/).map(s => s.trim()).filter(Boolean);
        const a = el.querySelector('a[href*=\"job_detail\"], a[href]');
        return { title: t[0] || '', lines: t.slice(0, 6), href: a ? a.href : null };
      });
      return { url: location.href, title: document.title, cards: cards.length, login, textHead: text.slice(0, 400), sample };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });

  const info = evalResult.result.value;
  const phase =
    info.cards > 0 && !info.login
      ? 'logged_in'
      : info.login
        ? 'login_wall'
        : 'no_cards';
  const out = { phase, method: 'raw_cdp', targetId: page.id, ...info, at: new Date().toISOString() };
  fs.writeFileSync('test-results/boss-login-status.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(phase === 'logged_in' ? 0 : 2);
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
