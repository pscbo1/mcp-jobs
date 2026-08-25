/**
 * v0 acceptance run: Zhaopin + BOSS (+ Liepin rows passed in via --liepin-json).
 * Writes per-source raw/filtered JSON+CSV under test-results/ (gitignored).
 *
 *   node scripts/v0-acceptance-run.js
 *   node scripts/v0-acceptance-run.js --liepin-json path/to/liepin.json
 */
const fs = require('fs');
const path = require('path');
const { crawlerConfigs } = require('../dist/config/crawlerConfig.js');
const { CrawlerService } = require('../dist/mcp/crawlerService.js');
const {
  crawlBossMultiPage,
  defaultBossUserDataDir,
} = require('../dist/crawler/bossRawCdpCrawl.js');
const { writeSourceExports } = require('../dist/export/marketScanExport.js');
const { normalizeJobInfoList } = require('../dist/crawler/crawlFailure.js');

const OUT_DIR = path.join(__dirname, '..', 'test-results', 'v0-acceptance');
const KEYWORD = '用户研究';
const CITY = '北京';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--liepin-json' && argv[i + 1]) out.liepinJson = argv[++i];
  }
  return out;
}

async function crawlZhaopin() {
  const cfg = crawlerConfigs.find((c) => c.name === 'zhaopin');
  if (!cfg) throw new Error('zhaopin config missing');
  const url = cfg.urlBuilder(cfg.url, { keyword: KEYWORD, city: CITY, page: 1 }, cfg.config || {});
  const service = new CrawlerService();
  const custom = { ...cfg, url };
  const dataset = (await service.startCrawling(custom)) || [];
  const item = dataset[0];
  if (!item?.succeeded) {
    return {
      source: 'zhaopin',
      keyword: KEYWORD,
      city: CITY,
      succeeded: false,
      errors: item?.errors || ['UNKNOWN_FAILURE'],
      rawJobs: [],
    };
  }
  return {
    source: 'zhaopin',
    keyword: KEYWORD,
    city: CITY,
    succeeded: true,
    rawJobs: normalizeJobInfoList(item.data?.jobInfo),
    pagesFetched: [1],
  };
}

async function crawlBoss() {
  const cfg = crawlerConfigs.find((c) => c.name === 'zhipin-web');
  if (!cfg) throw new Error('zhipin-web config missing');
  const userDataDir = defaultBossUserDataDir();
  const multi = await crawlBossMultiPage(userDataDir, {
    pageFrom: 1,
    pageTo: 5,
    maxJobs: 100,
    buildPageUrl: (page) =>
      cfg.urlBuilder(cfg.url, { keyword: KEYWORD, city: CITY, page }, cfg.config || {}),
  });
  return {
    source: 'zhipin-web',
    keyword: KEYWORD,
    city: CITY,
    succeeded: multi.succeeded,
    stopReason: multi.stopReason,
    errors: multi.errors,
    pagesFetched: multi.pagesFetched,
    rawJobs: multi.jobs,
  };
}

function loadLiepin(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const list = raw?.data?.list || raw?.list || raw?.jobs || [];
  const jobs = list.map((j) => ({
    title: j.jobName || j.title || '',
    company: j.company || j.companyName || '',
    address: j.location || j.address || CITY,
    experience: j.workYears || j.experience || '',
    salary: j.salary || '',
    jobDetail: j.jobDetailUrl || j.jobDetail || j.link || '',
    jd: '',
    tags: j.companyTags || [],
  }));
  return {
    source: 'liepin-official-mcp',
    keyword: KEYWORD,
    city: CITY,
    succeeded: jobs.length > 0,
    errors: jobs.length ? undefined : ['EMPTY_LIEPIN_RESULT'],
    rawJobs: jobs,
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { at: new Date().toISOString(), keyword: KEYWORD, city: CITY, sources: {} };

  // Zhaopin
  console.log('--- zhaopin ---');
  const zhaopinCapture = await crawlZhaopin();
  report.sources.zhaopin = {
    ...writeSourceExports({ outDir: OUT_DIR, sourceKey: 'zhaopin', capture: zhaopinCapture }),
    succeeded: zhaopinCapture.succeeded,
    errors: zhaopinCapture.errors,
  };

  // BOSS
  console.log('--- boss ---');
  const bossCapture = await crawlBoss();
  report.sources.boss = {
    ...writeSourceExports({
      outDir: OUT_DIR,
      sourceKey: 'boss',
      capture: bossCapture,
      extraMeta: { pagesFetched: bossCapture.pagesFetched, stopReason: bossCapture.stopReason },
    }),
    succeeded: bossCapture.succeeded,
    stopReason: bossCapture.stopReason,
    pagesFetched: bossCapture.pagesFetched,
    errors: bossCapture.errors,
  };

  // Liepin (optional pre-fetched)
  if (args.liepinJson && fs.existsSync(args.liepinJson)) {
    console.log('--- liepin ---');
    const liepinCapture = loadLiepin(args.liepinJson);
    report.sources.liepin = {
      ...writeSourceExports({ outDir: OUT_DIR, sourceKey: 'liepin', capture: liepinCapture }),
      succeeded: liepinCapture.succeeded,
      errors: liepinCapture.errors,
    };
  } else {
    report.sources.liepin = {
      succeeded: false,
      note: 'Pass --liepin-json after MCP fetch to write liepin exports in this script',
    };
  }

  const summaryPath = path.join(OUT_DIR, `acceptance-summary-${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summaryPath, report }, null, 2));
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
