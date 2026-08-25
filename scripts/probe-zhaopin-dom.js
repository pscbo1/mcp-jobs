const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  })).newPage();
  await page.goto('https://www.zhaopin.com/sou?jl=489&kw=' + encodeURIComponent('用户研究') + '&p=1', {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const card = document.querySelector('.joblist-box__item');
    if (!card) return { error: 'no card', url: location.href };
    const collect = (root) => {
      const nodes = [];
      root.querySelectorAll('*').forEach((el) => {
        const cls = el.className && String(el.className);
        if (!cls || typeof cls !== 'string') return;
        if (/jobinfo|company|salary|name|address|year|iteminfo|joblist/i.test(cls)) {
          nodes.push({
            tag: el.tagName,
            cls: cls.slice(0, 120),
            text: (el.textContent || '').trim().slice(0, 80),
            href: el.getAttribute && el.getAttribute('href'),
          });
        }
      });
      return nodes.slice(0, 60);
    };
    return { url: location.href, nodes: collect(card), html: card.outerHTML.slice(0, 2500) };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
