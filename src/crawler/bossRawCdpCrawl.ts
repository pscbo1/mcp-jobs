import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { ensureBossChrome, stopBossChrome } from './bossBrowser';
import { CrawlerData } from './webCrawler';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');

export type BossJob = {
  title: string;
  company: string;
  address: string;
  experience: string;
  salary: string;
  jobDetail: string;
  tags: string[];
  page?: number;
};

export type BossMultiPageResult = {
  succeeded: boolean;
  jobs: BossJob[];
  pagesFetched: number[];
  stopReason: string;
  errors?: string[];
  perPage: Array<{
    page: number;
    url: string;
    finalUrl?: string;
    visibleCardCount: number;
    newCount: number;
    errors?: string[];
  }>;
};

function httpJson(method: string, reqPath: string, port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function cdpCall(wsUrl: string, method: string, params: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(new Error(`CDP timeout: ${method}`));
    }, 25000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === id) {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    ws.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function openUrlInChrome(port: number, url: string): Promise<any> {
  return httpJson('PUT', '/json/new?' + encodeURIComponent(url), port);
}

async function findZhipinPage(port: number, preferId?: string): Promise<any | null> {
  for (let i = 0; i < 8; i++) {
    const list = await httpJson('GET', '/json/list', port);
    if (Array.isArray(list)) {
      if (preferId) {
        const byId = list.find((t: any) => t.id === preferId && t.type === 'page');
        if (byId && /zhipin\.com/.test(byId.url || '')) return byId;
      }
      const hit = list.find(
        (t: any) =>
          t.type === 'page' &&
          /zhipin\.com/.test(t.url || '') &&
          !/about:blank/i.test(t.url || '')
      );
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

const EXTRACT_JS = `(() => {
  const cards = [...document.querySelectorAll('.job-card-box, .job-card-wrapper')];
  const text = (document.body && document.body.innerText || '');
  const loginWall = /扫码登录|验证码登录\\/注册|安全验证/.test(text.slice(0, 1200))
    || /web\\/user|passport/i.test(location.href);
  const jobInfo = cards.map(el => {
    const lines = (el.innerText || '').split(/\\n+/).map(s => s.trim()).filter(Boolean);
    let title = (el.querySelector('.job-name, .job-title')?.textContent || '').trim();
    if (!title) title = (lines[0] || '').replace(/[\\uE000-\\uF8FF]+/g, '').trim();
    // Strip custom-font salary glyphs glued onto title
    title = title.replace(/[\\uE000-\\uF8FF]+.*$/, '').trim() || title;
    const company = (el.querySelector('.company-name a, .company-name')?.textContent
      || lines.find(l => /公司|科技|网络|教育|美团|字节|小米|有限|百度|思芮/.test(l) && l !== title)
      || '').trim();
    const address = (el.querySelector('.job-area, .company-location')?.textContent
      || lines.find(l => /北京|上海|广州|深圳|·/.test(l))
      || '').trim();
    const tags = [...el.querySelectorAll('.tag-list li, .job-info ul li, .info-desc')]
      .map(n => (n.textContent || '').trim()).filter(Boolean);
    const experience = tags.find(t => /年|经验|应届|在校|实习|不限/.test(t))
      || lines.find(l => /年|应届|在校|实习|经验不限/.test(l) && !/周|个月/.test(l))
      || '';
    const salaryEl = el.querySelector('.salary');
    let salary = (salaryEl?.textContent || '').trim();
    if (!salary || /[\\uE000-\\uF8FF]/.test(salary)) salary = '见职位页';
    let href = el.querySelector('a[href*="job_detail"]')?.getAttribute('href')
      || el.querySelector('a[href]')?.getAttribute('href')
      || '';
    if (href && href.startsWith('//')) href = 'https:' + href;
    else if (href && href.startsWith('/')) href = 'https://www.zhipin.com' + href;
    return { title, company, address, experience, salary, jobDetail: href, tags };
  }).filter(j => j.title);
  return {
    finalUrl: location.href,
    title: document.title,
    visibleCardCount: cards.length,
    loginWall,
    jobInfo,
    textHead: text.slice(0, 300),
  };
})()`;

async function extractPage(
  port: number,
  targetUrl: string
): Promise<{
  finalUrl: string;
  visibleCardCount: number;
  loginWall: boolean;
  jobs: BossJob[];
  errors?: string[];
}> {
  const opened = await openUrlInChrome(port, targetUrl);
  await new Promise((r) => setTimeout(r, 4500));
  const page = await findZhipinPage(port, opened?.id);
  if (!page?.webSocketDebuggerUrl) {
    return {
      finalUrl: opened?.url || 'about:blank',
      visibleCardCount: 0,
      loginWall: false,
      jobs: [],
      errors: ['BOSS_CDP_NO_PAGE: no zhipin tab after open'],
    };
  }

  await cdpCall(page.webSocketDebuggerUrl, 'Runtime.enable');
  const evalResult = await cdpCall(page.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: EXTRACT_JS,
    returnByValue: true,
    awaitPromise: true,
  });
  const value = evalResult?.result?.value || {};
  const jobs: BossJob[] = Array.isArray(value.jobInfo) ? value.jobInfo : [];
  return {
    finalUrl: value.finalUrl || page.url || targetUrl,
    visibleCardCount: value.visibleCardCount || jobs.length,
    loginWall: Boolean(value.loginWall) && jobs.length === 0,
    jobs,
  };
}

function jobKey(job: BossJob): string {
  return (job.jobDetail || `${job.title}|${job.company}|${job.address}`).toLowerCase();
}

export type BossCrawlOptions = {
  /** Inclusive start page (default 1). */
  pageFrom?: number;
  /** Inclusive end page (default 5). */
  pageTo?: number;
  /** Cap total unique jobs (default 100). */
  maxJobs?: number;
  buildPageUrl: (page: number) => string;
};

/**
 * BOSS multi-page crawl via real Chrome + raw CDP (no Playwright).
 * Stops on login/security, empty page, duplicate page, or no new jobs.
 */
export async function crawlBossMultiPage(
  userDataDir: string,
  options: BossCrawlOptions
): Promise<BossMultiPageResult> {
  fs.mkdirSync(userDataDir, { recursive: true });
  const pageFrom = Math.max(1, options.pageFrom ?? 1);
  const pageTo = Math.max(pageFrom, options.pageTo ?? 5);
  const maxJobs = Math.max(1, options.maxJobs ?? 100);

  const session = await ensureBossChrome(userDataDir);
  const port = session.port;
  const jobs: BossJob[] = [];
  const seen = new Set<string>();
  const pagesFetched: number[] = [];
  const perPage: BossMultiPageResult['perPage'] = [];
  let stopReason = 'completed_page_range';

  try {
    for (let page = pageFrom; page <= pageTo; page++) {
      if (jobs.length >= maxJobs) {
        stopReason = `max_jobs_reached:${maxJobs}`;
        break;
      }

      const url = options.buildPageUrl(page);
      const extracted = await extractPage(port, url);
      pagesFetched.push(page);

      if (extracted.loginWall) {
        perPage.push({
          page,
          url,
          finalUrl: extracted.finalUrl,
          visibleCardCount: extracted.visibleCardCount,
          newCount: 0,
          errors: [`LOGIN_OR_SECURITY_PAGE: ${extracted.finalUrl}`],
        });
        stopReason = 'login_or_security_page';
        break;
      }

      if (extracted.errors?.length) {
        perPage.push({
          page,
          url,
          finalUrl: extracted.finalUrl,
          visibleCardCount: 0,
          newCount: 0,
          errors: extracted.errors,
        });
        stopReason = extracted.errors[0];
        break;
      }

      if (extracted.visibleCardCount === 0 || extracted.jobs.length === 0) {
        perPage.push({
          page,
          url,
          finalUrl: extracted.finalUrl,
          visibleCardCount: extracted.visibleCardCount,
          newCount: 0,
          errors: ['EMPTY_PAGE: zero job cards'],
        });
        stopReason = 'empty_page';
        break;
      }

      let newCount = 0;
      for (const job of extracted.jobs) {
        const key = jobKey(job);
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push({ ...job, page });
        newCount += 1;
        if (jobs.length >= maxJobs) break;
      }

      perPage.push({
        page,
        url,
        finalUrl: extracted.finalUrl,
        visibleCardCount: extracted.visibleCardCount,
        newCount,
      });

      if (newCount === 0) {
        stopReason = 'duplicate_or_no_new_jobs';
        break;
      }
    }

    return {
      succeeded: jobs.length > 0,
      jobs: jobs.slice(0, maxJobs),
      pagesFetched,
      stopReason,
      perPage,
      errors: jobs.length ? undefined : [`NO_JOBS: stopped with ${stopReason}`],
    };
  } finally {
    await stopBossChrome(session, { keepAlive: true });
  }
}

/** Single-page helper used by WebCrawler site path. */
export async function crawlBossWithRawCdp(
  targetUrl: string,
  userDataDir: string
): Promise<CrawlerData> {
  const multi = await crawlBossMultiPage(userDataDir, {
    pageFrom: 1,
    pageTo: 1,
    maxJobs: 100,
    buildPageUrl: () => targetUrl,
  });

  if (!multi.succeeded) {
    return {
      url: targetUrl,
      finalUrl: multi.perPage[0]?.finalUrl || targetUrl,
      data: {},
      timestamp: Date.now(),
      succeeded: false,
      errors: multi.errors || [multi.stopReason],
      visibleCardCount: multi.perPage[0]?.visibleCardCount || 0,
      parsedCount: 0,
    };
  }

  return {
    url: targetUrl,
    finalUrl: multi.perPage[0]?.finalUrl || targetUrl,
    data: { jobInfo: multi.jobs },
    rawData: { jobInfo: multi.jobs },
    timestamp: Date.now(),
    succeeded: true,
    visibleCardCount: multi.perPage[0]?.visibleCardCount || multi.jobs.length,
    parsedCount: multi.jobs.length,
  };
}

export function defaultBossUserDataDir(): string {
  return (
    process.env.BOSS_USER_DATA_DIR ||
    path.join(process.env.USERPROFILE || process.env.HOME || '.', '.cursor-boss-zhipin-profile')
  );
}
