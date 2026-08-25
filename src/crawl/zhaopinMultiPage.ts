import { crawlerConfigs } from '../config/crawlerConfig';
import { CrawlerService } from '../mcp/crawlerService';
import { normalizeJobInfoList } from '../crawler/crawlFailure';
import {
  MultiPageParams,
  MultiPageResult,
  jobDedupeKey,
  normalizePageRange,
} from './multiPageCommon';

/**
 * Zhaopin multi-page crawl (Playwright). Stops on empty/duplicate/login/parse failure.
 */
export async function crawlZhaopinMultiPage(
  params: MultiPageParams
): Promise<MultiPageResult> {
  const { pageFrom, pageTo, maxJobs } = normalizePageRange(params);
  const matched = crawlerConfigs.find((c) => c.name === 'zhaopin');
  if (!matched) {
    return {
      succeeded: false,
      jobs: [],
      pagesFetched: [],
      rawCount: 0,
      dedupedCount: 0,
      stopReason: 'no_provider',
      errors: ['NO_PROVIDER_CONFIG: zhaopin missing'],
      perPage: [],
    };
  }

  const jobs: MultiPageResult['jobs'] = [];
  const seen = new Set<string>();
  const pagesFetched: number[] = [];
  const perPage: MultiPageResult['perPage'] = [];
  let stopReason = 'completed_page_range';
  let rawCount = 0;

  const crawlerService = new CrawlerService();

  for (let page = pageFrom; page <= pageTo; page++) {
    if (jobs.length >= maxJobs) {
      stopReason = `max_jobs_reached:${maxJobs}`;
      break;
    }

    const url = matched.urlBuilder(
      matched.url,
      {
        keyword: params.keyword,
        city: params.city,
        page,
      },
      matched.config || {}
    );

    try {
      const dataset =
        (await crawlerService.startCrawling({
          ...matched,
          url,
        })) || [];
      const item = dataset[0];
      pagesFetched.push(page);

      if (!item) {
        perPage.push({
          page,
          url,
          rawCount: 0,
          newCount: 0,
          errors: ['NO_CRAWL_RESULT'],
        });
        stopReason = 'no_crawl_result';
        break;
      }

      if (!item.succeeded) {
        perPage.push({
          page,
          url,
          finalUrl: item.finalUrl,
          visibleCardCount: item.visibleCardCount,
          rawCount: 0,
          newCount: 0,
          errors: item.errors || ['UNKNOWN_FAILURE'],
        });
        stopReason = (item.errors && item.errors[0]) || 'crawl_failed';
        break;
      }

      const pageJobs = normalizeJobInfoList(item.data?.jobInfo);
      rawCount += pageJobs.length;
      const visible = item.visibleCardCount ?? pageJobs.length;

      if (visible === 0 || pageJobs.length === 0) {
        perPage.push({
          page,
          url,
          finalUrl: item.finalUrl,
          visibleCardCount: visible,
          rawCount: 0,
          newCount: 0,
          errors: ['EMPTY_PAGE: zero job cards'],
        });
        stopReason = 'empty_page';
        break;
      }

      let newCount = 0;
      for (const job of pageJobs) {
        const key = jobDedupeKey(job);
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push({ ...job, page, source: 'zhaopin' });
        newCount += 1;
        if (jobs.length >= maxJobs) break;
      }

      perPage.push({
        page,
        url,
        finalUrl: item.finalUrl,
        visibleCardCount: visible,
        rawCount: pageJobs.length,
        newCount,
      });

      if (newCount === 0) {
        stopReason = 'duplicate_or_no_new_jobs';
        break;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      pagesFetched.push(page);
      perPage.push({
        page,
        url,
        rawCount: 0,
        newCount: 0,
        errors: [message],
      });
      stopReason = message;
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
  };
}
