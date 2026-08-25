import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import {
  MultiPageParams,
  MultiPageResult,
  jobDedupeKey,
  normalizePageRange,
} from './multiPageCommon';

const LIEPIN_HOST = 'open-agent.liepin.com';
const LIEPIN_PATH = '/mcp/user';

type LiepinAuth = { token: string };

type McpSession = {
  token: string;
  sessionId?: string;
};

/**
 * Resolve token at runtime only (never commit). Order:
 * 1) LIEPIN_USER_TOKEN env
 * 2) %USERPROFILE%\.cursor\mcp.json liepin-mcp headers
 */
export function resolveLiepinToken(): LiepinAuth {
  const fromEnv = process.env.LIEPIN_USER_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv };

  const mcpPath = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.cursor',
    'mcp.json'
  );
  if (!fs.existsSync(mcpPath)) {
    throw new Error('LIEPIN_AUTH_MISSING: set LIEPIN_USER_TOKEN or configure liepin-mcp in mcp.json');
  }
  const cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8').replace(/^\uFEFF/, ''));
  const token = cfg?.mcpServers?.['liepin-mcp']?.headers?.['x-user-token'];
  if (!token || typeof token !== 'string') {
    throw new Error('LIEPIN_AUTH_MISSING: x-user-token not found in mcp.json');
  }
  return { token };
}

function postMcp(
  session: McpSession,
  body: object
): Promise<{ status: number; body: string; sessionId?: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-user-token': session.token,
      'Content-Length': Buffer.byteLength(data),
    };
    if (session.sessionId) {
      headers['mcp-session-id'] = session.sessionId;
    }
    const req = https.request(
      {
        hostname: LIEPIN_HOST,
        path: LIEPIN_PATH,
        method: 'POST',
        headers,
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          const sid =
            (res.headers['mcp-session-id'] as string | undefined) ||
            (res.headers['Mcp-Session-Id'] as string | undefined);
          resolve({ status: res.statusCode || 0, body: buf, sessionId: sid });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

function parseSseOrJson(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to SSE
    }
  }
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(dataLines[i]);
    } catch {
      // continue
    }
  }
  return null;
}

function extractJobs(payload: any): MultiPageResult['jobs'] {
  const out: MultiPageResult['jobs'] = [];
  const walk = (x: any) => {
    if (!x) return;
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (typeof x !== 'object') return;
    const title = x.jobName || x.title || x.jobTitle;
    const company = x.company || x.companyName || x.compName;
    const link = x.jobDetailUrl || x.jobDetail || x.url || x.link;
    const salary = x.salary || x.salaryShow;
    const address = x.location || x.address || x.city;
    const experience = x.workYears || x.workYear || x.experience;
    if (title && (company || link || salary)) {
      out.push({
        title: title || '',
        company: company || '',
        address: address || '',
        experience: experience || '',
        salary: salary || '',
        jobDetail: link || '',
        source: 'liepin-official-mcp',
        tags: Array.isArray(x.companyTags) ? x.companyTags : [],
      });
      return;
    }
    Object.values(x).forEach(walk);
  };
  walk(payload);
  return out;
}

async function openSession(token: string): Promise<McpSession> {
  const session: McpSession = { token };
  const init = await postMcp(session, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-jobs-liepin-multipage', version: '1.0.0' },
    },
  });
  if (init.status === 401 || init.status === 403) {
    throw new Error(`LIEPIN_AUTH_FAILED: HTTP_${init.status}`);
  }
  if (init.sessionId) session.sessionId = init.sessionId;
  await postMcp(session, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  return session;
}

async function callUserSearchJob(
  session: McpSession,
  args: { jobName: string; address?: string; page: number }
): Promise<{ jobs: MultiPageResult['jobs']; authFailed: boolean; error?: string; raw?: any }> {
  // Official schema: page 0 = first page. No cursor field.
  const call = await postMcp(session, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'user-search-job',
      arguments: {
        jobName: args.jobName,
        address: args.address || '',
        page: args.page,
      },
    },
  });
  if (call.sessionId) session.sessionId = call.sessionId;

  if (call.status === 401 || call.status === 403) {
    return { jobs: [], authFailed: true, error: `HTTP_${call.status}` };
  }

  const parsed = parseSseOrJson(call.body);
  if (!parsed) {
    return {
      jobs: [],
      authFailed: /token|auth|未授权|登录/i.test(call.body),
      error: `BAD_RESPONSE_STATUS_${call.status}`,
    };
  }

  if (parsed.error) {
    const msg = JSON.stringify(parsed.error);
    return {
      jobs: [],
      authFailed: /auth|token|401|403|未授权/i.test(msg),
      error: msg,
    };
  }

  const result = parsed.result ?? parsed;
  let payload: any = result;
  if (Array.isArray(result?.content)) {
    const text = result.content.find((c: any) => c.type === 'text')?.text;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = result;
      }
    }
  }

  const jobs = extractJobs(payload);
  const code = payload?.code;
  if (code != null && code !== 0 && jobs.length === 0) {
    return {
      jobs: [],
      authFailed: code === 401 || code === 403,
      error: `LIEPIN_CODE_${code}`,
      raw: payload,
    };
  }

  return { jobs, authFailed: false, raw: payload };
}

/**
 * Liepin official MCP multi-page via user-search-job.page
 * Official: page 0 = first page. We map human page N -> MCP page N-1.
 */
export async function crawlLiepinOfficialMultiPage(
  params: MultiPageParams
): Promise<MultiPageResult> {
  const { pageFrom, pageTo, maxJobs } = normalizePageRange(params);
  const paginationNote =
    'Official user-search-job supports page (0-based; 0=first page). No cursor field in schema.';

  let token: string;
  try {
    token = resolveLiepinToken().token;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      succeeded: false,
      jobs: [],
      pagesFetched: [],
      rawCount: 0,
      dedupedCount: 0,
      stopReason: 'auth_missing',
      errors: [message],
      perPage: [],
      paginationNote,
    };
  }

  let session: McpSession;
  try {
    session = await openSession(token);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      succeeded: false,
      jobs: [],
      pagesFetched: [],
      rawCount: 0,
      dedupedCount: 0,
      stopReason: 'auth_failed',
      errors: [message],
      perPage: [],
      paginationNote,
    };
  }

  const jobs: MultiPageResult['jobs'] = [];
  const seen = new Set<string>();
  const pagesFetched: number[] = [];
  const perPage: MultiPageResult['perPage'] = [];
  let stopReason = 'completed_page_range';
  let rawCount = 0;

  for (let page = pageFrom; page <= pageTo; page++) {
    if (jobs.length >= maxJobs) {
      stopReason = `max_jobs_reached:${maxJobs}`;
      break;
    }

    const mcpPage = page - 1; // official 0-based
    const result = await callUserSearchJob(session, {
      jobName: params.keyword,
      address: params.city,
      page: mcpPage,
    });

    pagesFetched.push(page);

    if (result.authFailed) {
      perPage.push({
        page,
        rawCount: 0,
        newCount: 0,
        errors: [`LIEPIN_AUTH_FAILED: ${result.error || 'unauthorized'}`],
      });
      stopReason = 'auth_failed';
      break;
    }

    if (result.error && result.jobs.length === 0) {
      perPage.push({
        page,
        rawCount: 0,
        newCount: 0,
        errors: [result.error],
      });
      stopReason = result.error;
      break;
    }

    const pageJobs = result.jobs;
    rawCount += pageJobs.length;

    if (pageJobs.length === 0) {
      perPage.push({
        page,
        rawCount: 0,
        newCount: 0,
        errors: ['EMPTY_PAGE: zero jobs from official MCP'],
      });
      stopReason = 'empty_page';
      break;
    }

    let newCount = 0;
    for (const job of pageJobs) {
      const key = jobDedupeKey(job);
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ ...job, page, source: 'liepin-official-mcp' });
      newCount += 1;
      if (jobs.length >= maxJobs) break;
    }

    perPage.push({
      page,
      rawCount: pageJobs.length,
      newCount,
      visibleCardCount: pageJobs.length,
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
    rawCount,
    dedupedCount: jobs.length,
    stopReason,
    errors: jobs.length ? undefined : [`NO_JOBS: stopped with ${stopReason}`],
    perPage,
    paginationNote,
  };
}
