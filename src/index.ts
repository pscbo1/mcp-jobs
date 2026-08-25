import { CrawlerService } from './mcp/crawlerService';
import { StorageService } from './services/storageService';
import { crawlerConfigs } from './config/crawlerConfig';
import { jobSearchUrls } from './config/urlConfig';
import { CrawlerData } from './crawler/webCrawler';
import { normalizeJobInfoList } from './crawler/crawlFailure';
import {
  applyHardExcludes,
  FilteredJob,
} from './filter/jobHardFilter';
import {
  crawlBossMultiPage,
  defaultBossUserDataDir,
} from './crawler/bossRawCdpCrawl';
import { crawlZhaopinMultiPage } from './crawl/zhaopinMultiPage';
import { crawlLiepinOfficialMultiPage } from './crawl/liepinOfficialMultiPage';
import { normalizePageRange } from './crawl/multiPageCommon';

// 定义搜索参数接口
export interface SearchParams {
  keyword?: string;
  city?: string;
  /** @deprecated Prefer pageFrom; kept for MCP backward compat (single-page start). */
  page?: number;
  /** Inclusive start page (default 1). */
  pageFrom?: number;
  /** Inclusive end page (default 5). */
  pageTo?: number;
  /** @deprecated Prefer pageFrom/pageTo. BOSS: pages [page .. page+maxPages-1]. */
  maxPages?: number;
  /** Cap unique jobs (default 100). */
  maxJobs?: number;
  salary?: string;
  workYear?: string;
  /** BOSS desktop verified label, e.g. 本科 */
  degree?: string;
}

export interface SourceSearchResult {
  name: string;
  succeeded: boolean;
  url?: string;
  finalUrl?: string;
  visibleCardCount?: number;
  parsedCount?: number;
  errors?: string[];
  jobCount: number;
  pagesFetched?: number[];
  stopReason?: string;
  rawCount?: number;
  dedupedCount?: number;
  paginationNote?: string;
}

export interface SearchJobListResult {
  jobs: any[];
  rawJobs: any[];
  filteredJobs: FilteredJob[];
  excludedJobs: FilteredJob[];
  excludeReasonSummary: Record<string, number>;
  sources: SourceSearchResult[];
  allSucceeded: boolean;
  anySucceeded: boolean;
}

async function crawlByUrl(url: string, params: SearchParams): Promise<CrawlerData[] | null> {
  const crawlerService = new CrawlerService();
  const storageService = new StorageService();

  const matchedConfig = crawlerConfigs.find(config => {
    if (config.url === url) return true;
    if (config.urlPattern && new RegExp(config.urlPattern).test(url)) return true;
    return false;
  });

  if (!matchedConfig) {
    console.error('No matching configuration found for URL:', url);
    return null;
  }

  try {
    const { keyword, city, page, salary, workYear, degree } = params;
    const customConfig = {
      ...matchedConfig,
      url: matchedConfig.urlBuilder(
        url,
        { keyword, city, page, salary, workYear, degree },
        matchedConfig?.config || {}
      ),
    };
    console.log(customConfig);
    const result = await crawlerService.startCrawling(customConfig);
    console.log(result);

    const dataset = result || [];

    await storageService.saveData(customConfig.name, {
      config: customConfig,
      items: dataset,
      timestamp: Date.now(),
    });

    return dataset;
  } catch (error) {
    return [
      {
        url,
        data: {},
        timestamp: Date.now(),
        succeeded: false,
        errors: [error instanceof Error ? error.message : String(error)],
      },
    ];
  }
}

async function crawlBossPages(params: SearchParams): Promise<{
  dataset: CrawlerData[];
  pagesFetched: number[];
  stopReason: string;
}> {
  const matched = crawlerConfigs.find((c) => c.name === 'zhipin-web');
  if (!matched) {
    return {
      dataset: [
        {
          url: 'https://www.zhipin.com/web/geek/job',
          data: {},
          timestamp: Date.now(),
          succeeded: false,
          errors: ['NO_PROVIDER_CONFIG: zhipin-web missing'],
        },
      ],
      pagesFetched: [],
      stopReason: 'no_provider',
    };
  }

  const range =
    params.pageFrom != null || params.pageTo != null
      ? normalizePageRange({
          keyword: params.keyword || '',
          pageFrom: params.pageFrom,
          pageTo: params.pageTo,
          maxJobs: params.maxJobs,
        })
      : (() => {
          const pageFrom = Math.max(1, params.page || 1);
          const maxPages = Math.min(5, Math.max(1, params.maxPages ?? 5));
          return {
            pageFrom,
            pageTo: pageFrom + maxPages - 1,
            maxJobs: Math.min(100, Math.max(1, params.maxJobs ?? 100)),
          };
        })();
  const { pageFrom, pageTo, maxJobs } = range;
  const userDataDir = defaultBossUserDataDir();

  const buildParams = (page: number) => ({
    keyword: params.keyword,
    city: params.city,
    page,
    salary: params.salary,
    workYear: params.workYear,
    degree: params.degree,
  });

  const multi = await crawlBossMultiPage(userDataDir, {
    pageFrom,
    pageTo,
    maxJobs,
    buildPageUrl: (page) =>
      matched.urlBuilder(matched.url, buildParams(page), matched.config || {}),
  });

  const dataset: CrawlerData[] = [
    {
      url: matched.urlBuilder(matched.url, buildParams(pageFrom), matched.config || {}),
      finalUrl: multi.perPage[0]?.finalUrl,
      data: { jobInfo: multi.jobs },
      rawData: {
        jobInfo: multi.jobs,
        perPage: multi.perPage,
        stopReason: multi.stopReason,
      },
      timestamp: Date.now(),
      succeeded: multi.succeeded,
      errors: multi.errors,
      visibleCardCount: multi.perPage.reduce((n, p) => n + (p.visibleCardCount || 0), 0),
      parsedCount: multi.jobs.length,
    },
  ];

  return { dataset, pagesFetched: multi.pagesFetched, stopReason: multi.stopReason };
}

function resolveSearchPageRange(params: SearchParams) {
  if (params.pageFrom != null || params.pageTo != null) {
    return normalizePageRange({
      keyword: params.keyword || '',
      pageFrom: params.pageFrom,
      pageTo: params.pageTo,
      maxJobs: params.maxJobs,
    });
  }
  // Backward compat: single `page` + optional maxPages
  const pageFrom = Math.max(1, params.page || 1);
  const maxPages = Math.min(5, Math.max(1, params.maxPages ?? 5));
  return {
    pageFrom,
    pageTo: pageFrom + maxPages - 1,
    maxJobs: Math.max(1, params.maxJobs ?? 100),
  };
}

function multiToDataset(
  url: string,
  multi: {
    succeeded: boolean;
    jobs: any[];
    errors?: string[];
    stopReason: string;
    perPage: Array<{ finalUrl?: string; visibleCardCount?: number }>;
  }
): CrawlerData[] {
  return [
    {
      url,
      finalUrl: multi.perPage[0]?.finalUrl,
      data: { jobInfo: multi.jobs },
      rawData: {
        jobInfo: multi.jobs,
        perPage: multi.perPage,
        stopReason: multi.stopReason,
      },
      timestamp: Date.now(),
      succeeded: multi.succeeded,
      errors: multi.errors,
      visibleCardCount: multi.perPage.reduce((n, p) => n + (p.visibleCardCount || 0), 0),
      parsedCount: multi.jobs.length,
    },
  ];
}

export async function searchJobList(params: SearchParams = {}): Promise<SearchJobListResult> {
  const { keyword, city, salary, workYear } = params;
  const range = resolveSearchPageRange(params);
  const rawJobs: any[] = [];
  const sources: SourceSearchResult[] = [];

  console.log(
    `开始搜索职位 - 关键词: ${keyword}, 城市: ${city || '全国'}, pages ${range.pageFrom}-${range.pageTo}, maxJobs=${range.maxJobs}`
  );

  for (const config of jobSearchUrls) {
    try {
      const providerKeyword =
        config.name === 'zhaopin' ||
        config.name === 'zhipin-web' ||
        config.name === 'liepin' ||
        !city
          ? keyword
          : `${keyword || ''} ${city}`.trim();

      let dataset: CrawlerData[] | null = null;
      let pagesFetched: number[] | undefined;
      let stopReason: string | undefined;
      let rawCount: number | undefined;
      let dedupedCount: number | undefined;
      let paginationNote: string | undefined;

      if (config.name === 'zhaopin') {
        const multi = await crawlZhaopinMultiPage({
          keyword: providerKeyword || '',
          city,
          pageFrom: range.pageFrom,
          pageTo: range.pageTo,
          maxJobs: range.maxJobs,
        });
        dataset = multiToDataset(config.url, multi);
        pagesFetched = multi.pagesFetched;
        stopReason = multi.stopReason;
        rawCount = multi.rawCount;
        dedupedCount = multi.dedupedCount;
      } else if (config.name === 'liepin') {
        const multi = await crawlLiepinOfficialMultiPage({
          keyword: providerKeyword || '',
          city,
          pageFrom: range.pageFrom,
          pageTo: range.pageTo,
          maxJobs: range.maxJobs,
        });
        dataset = multiToDataset(config.url, multi);
        pagesFetched = multi.pagesFetched;
        stopReason = multi.stopReason;
        rawCount = multi.rawCount;
        dedupedCount = multi.dedupedCount;
        paginationNote = multi.paginationNote;
      } else if (
        config.name === 'zhipin-web' &&
        (process.env.BOSS_USER_DATA_DIR || defaultBossUserDataDir())
      ) {
        const boss = await crawlBossPages({
          ...params,
          keyword: providerKeyword,
          city,
          pageFrom: range.pageFrom,
          pageTo: range.pageTo,
          maxJobs: range.maxJobs,
        });
        dataset = boss.dataset;
        pagesFetched = boss.pagesFetched;
        stopReason = boss.stopReason;
        rawCount = boss.dataset[0]?.visibleCardCount;
        dedupedCount = boss.dataset[0]?.parsedCount;
      } else {
        dataset = await crawlByUrl(config.url, {
          keyword: providerKeyword,
          city,
          page: range.pageFrom,
          salary,
          workYear,
          degree: params.degree,
        });
      }

      if (dataset === null) {
        sources.push({
          name: config.name,
          succeeded: false,
          jobCount: 0,
          errors: ['NO_PROVIDER_CONFIG: url listed but no crawlerConfig matched'],
        });
        continue;
      }

      const item = dataset[0];
      if (!item) {
        sources.push({
          name: config.name,
          succeeded: false,
          jobCount: 0,
          errors: ['NO_CRAWL_RESULT: crawler returned empty dataset'],
        });
        continue;
      }

      if (!item.succeeded) {
        sources.push({
          name: config.name,
          succeeded: false,
          url: item.url,
          finalUrl: item.finalUrl,
          visibleCardCount: item.visibleCardCount,
          parsedCount: item.parsedCount ?? 0,
          jobCount: 0,
          errors: item.errors || ['UNKNOWN_FAILURE'],
          pagesFetched,
          stopReason,
          rawCount,
          dedupedCount,
          paginationNote,
        });
        console.warn(`从 ${config.name} 抓取失败: ${(item.errors || []).join('; ')}`);
        continue;
      }

      const jobInfo = normalizeJobInfoList(item.data?.jobInfo).map((j) => ({
        ...j,
        source: config.name === 'liepin' ? 'liepin-official-mcp' : config.name,
      }));
      rawJobs.push(...jobInfo);
      sources.push({
        name: config.name,
        succeeded: true,
        url: item.url,
        finalUrl: item.finalUrl,
        visibleCardCount: item.visibleCardCount,
        parsedCount: item.parsedCount ?? jobInfo.length,
        jobCount: jobInfo.length,
        pagesFetched,
        stopReason,
        rawCount: rawCount ?? jobInfo.length,
        dedupedCount: dedupedCount ?? jobInfo.length,
        paginationNote,
      });
      console.log(`从 ${config.name} 获取到 ${jobInfo.length} 个职位`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sources.push({
        name: config.name,
        succeeded: false,
        jobCount: 0,
        errors: [message],
      });
      console.warn(`从 ${config.name} 获取职位失败:`, message);
    }
  }

  const { kept, excluded, reasonSummary } = applyHardExcludes(rawJobs);
  const anySucceeded = sources.some((s) => s.succeeded);
  const allSucceeded = sources.length > 0 && sources.every((s) => s.succeeded);

  console.log(
    `搜索完成，原始 ${rawJobs.length}，保留 ${kept.length}，排除 ${excluded.length}; anySucceeded=${anySucceeded}`
  );
  return {
    jobs: kept,
    rawJobs,
    filteredJobs: kept,
    excludedJobs: excluded,
    excludeReasonSummary: reasonSummary,
    sources,
    allSucceeded,
    anySucceeded,
  };
}

async function main() {
  const result = await searchJobList({
    keyword: '前端开发',
    city: '北京',
    page: 1,
    salary: '10-15万',
    workYear: '1-3年',
  });
  console.log(result.sources);
}

export async function crawlJobDetail(url: string) {
  const result = await crawlByUrl(url, {});
  if (!result || result.length === 0) {
    return null;
  }
  const item = result[0];
  if (!item?.succeeded) {
    return null;
  }
  return item?.data?.job || null;
}

export {
  crawlByUrl,
  jobSearchUrls,
};

if (require.main === module) {
  main();
}
