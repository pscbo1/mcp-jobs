import { CrawlerService } from './mcp/crawlerService';
import { StorageService } from './services/storageService';
import { crawlerConfigs } from './config/crawlerConfig';
import { jobSearchUrls } from './config/urlConfig';
import { CrawlerData } from './crawler/webCrawler';
import { normalizeJobInfoList } from './crawler/crawlFailure';

// 定义搜索参数接口
export interface SearchParams {
  keyword?: string;
  city?: string;
  page?: number;
  salary?: string;
  workYear?: string;
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
}

export interface SearchJobListResult {
  jobs: any[];
  sources: SourceSearchResult[];
  allSucceeded: boolean;
  anySucceeded: boolean;
}

async function crawlByUrl(url: string, params: SearchParams): Promise<CrawlerData[] | null> {
  const crawlerService = new CrawlerService();
  const storageService = new StorageService();

  // 根据 URL 匹配对应的配置
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
    const { keyword, city, page, salary, workYear } = params;
    // 创建一个新的配置，使用匹配到的规则但替换URL
    const customConfig = {
      ...matchedConfig,
      url: matchedConfig.urlBuilder(url, params, matchedConfig?.config || {})
    };
    console.log(customConfig);
    const result = await crawlerService.startCrawling(customConfig);
    console.log(result);
    
    // 获取爬取的数据
    const dataset = result || [];
    
    // 保存爬取结果
    await storageService.saveData(customConfig.name, {
      config: customConfig,
      items: dataset,
      timestamp: Date.now()
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

export async function searchJobList(params: SearchParams = {}): Promise<SearchJobListResult> {
  const { keyword, city, page = 1, salary, workYear } = params;
  const jobs: any[] = [];
  const sources: SourceSearchResult[] = [];

  console.log(`开始搜索职位 - 关键词: ${keyword}, 城市: ${city || '全国'}`);

  for (const config of jobSearchUrls) {
    try {
      // Keep keyword and city separate for zhaopin (city code).
      // Liepin/Boss historically appended city into the keyword string.
      const providerKeyword =
        config.name === 'zhaopin' || !city
          ? keyword
          : `${keyword || ''} ${city}`.trim();

      const dataset = await crawlByUrl(config.url, {
        keyword: providerKeyword,
        city,
        page,
        salary,
        workYear
      });

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
        });
        console.warn(`从 ${config.name} 抓取失败: ${(item.errors || []).join('; ')}`);
        continue;
      }

      const jobInfo = normalizeJobInfoList(item.data?.jobInfo);
      jobs.push(...jobInfo);
      sources.push({
        name: config.name,
        succeeded: true,
        url: item.url,
        finalUrl: item.finalUrl,
        visibleCardCount: item.visibleCardCount,
        parsedCount: item.parsedCount ?? jobInfo.length,
        jobCount: jobInfo.length,
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

  const anySucceeded = sources.some((s) => s.succeeded);
  const allSucceeded = sources.length > 0 && sources.every((s) => s.succeeded);

  console.log(`搜索完成，总共找到 ${jobs.length} 个职位; anySucceeded=${anySucceeded}`);
  console.log(jobs);
  return { jobs, sources, allSucceeded, anySucceeded };
}

async function main() {
  const result = await searchJobList({ keyword: '前端开发', city: '北京', page: 1, salary: '10-15万', workYear: '1-3年' });
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

// 导出函数供外部使用
export {
  crawlByUrl,
  jobSearchUrls
};

// 如果直接运行此文件，则执行 main 函数
if (require.main === module) {
  main();
}
