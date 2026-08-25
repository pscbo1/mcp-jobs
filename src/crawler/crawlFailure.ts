import { Page } from 'playwright';

export interface PageFailureCheck {
  failed: boolean;
  errors: string[];
  finalUrl: string;
  bodyLength: number;
  cardCount: number;
}

/**
 * Shared failure detection for all job providers.
 * Does not bypass login/captcha — only reports them.
 */
export async function assessCrawlOutcome(
  page: Page,
  requestedUrl: string,
  cardSelector?: string
): Promise<PageFailureCheck> {
  const errors: string[] = [];
  const finalUrl = page.url();
  const title = await page.title().catch(() => '');

  let bodyLength = 0;
  let textSample = '';
  try {
    const bodyInfo = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const html = document.documentElement?.outerHTML || '';
      return { textLen: text.length, htmlLen: html.length, textHead: text.slice(0, 2000) };
    });
    bodyLength = bodyInfo.textLen;
    textSample = bodyInfo.textHead;
    if (bodyInfo.htmlLen < 200 || bodyInfo.textLen === 0) {
      errors.push('EMPTY_HTML: page body is empty or nearly empty');
    }
  } catch (e: any) {
    errors.push(`PAGE_EVAL_FAILED: ${e?.message || String(e)}`);
  }

  if (!finalUrl || finalUrl === 'about:blank' || finalUrl.startsWith('chrome-error://')) {
    errors.push(`BLANK_OR_ERROR_URL: final url is ${finalUrl || '(empty)'}`);
  }

  const combined = `${finalUrl}\n${title}\n${textSample}`;
  const loginSignals =
    /\/web\/user\/|\/passport\/|security\.html|登录\/注册|账号登录|扫码登录|验证码登录/.test(
      combined
    );
  const securitySignals =
    /security\.html|_security_check|安全验证|人机验证|访问异常|频繁访问|安全拦截/.test(combined);
  const captchaSignals = /滑动验证|geetest|captcha/i.test(combined);

  // Full navigation to login/security pages is a hard failure.
  // Sidebar "验证码登录" alone on a list page is NOT treated as hard failure.
  const onLoginOrSecurityPage =
    /\/passport\/|\/web\/user\/|security\.html|login\.|signin/i.test(finalUrl) ||
    (/登录/.test(title) && bodyLength < 500);

  if (onLoginOrSecurityPage) {
    errors.push(`LOGIN_OR_SECURITY_PAGE: redirected to ${finalUrl}`);
  } else if (securitySignals && cardSelector) {
    // security keywords without cards → fail; with cards keep going
    const cards = await page.$$(cardSelector).catch(() => []);
    if (cards.length === 0 && securitySignals) {
      errors.push('SECURITY_CHALLENGE: security/captcha signals and no job cards');
    }
  }

  if (captchaSignals && onLoginOrSecurityPage) {
    errors.push('CAPTCHA: captcha challenge detected');
  }

  // Ignore incidental header "登录/注册" when list cards exist.
  if (loginSignals && onLoginOrSecurityPage) {
    // already recorded
  }

  let cardCount = 0;
  if (cardSelector) {
    cardCount = (await page.$$(cardSelector).catch(() => [])).length;
    if (cardCount === 0 && errors.length === 0) {
      errors.push(`ZERO_JOB_CARDS: selector "${cardSelector}" matched 0 elements`);
    }
  }

  return {
    failed: errors.length > 0,
    errors,
    finalUrl,
    bodyLength,
    cardCount,
  };
}

export function normalizeJobInfoList(value: unknown): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function countValidJobs(jobInfo: unknown): number {
  return normalizeJobInfoList(jobInfo).filter((job) => {
    if (!job || typeof job !== 'object') return false;
    const j = job as Record<string, unknown>;
    // reject parser fallback stubs
    if (j.content && !j.title) return false;
    return Boolean(j.title && j.company && (j.jobDetail || j.link));
  }).length;
}
