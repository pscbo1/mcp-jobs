/**
 * v1 multi-page acceptance: Zhaopin + Liepin official MCP + BOSS.
 * Unified pageFrom/pageTo/maxJobs; writes raw/filtered JSON+CSV (gitignored).
 *
 *   node scripts/v1-multipage-acceptance.js
 *   node scripts/v1-multipage-acceptance.js --pageFrom 1 --pageTo 5 --maxJobs 100
 */
const fs = require('fs');
const path = require('path');
const { crawlZhaopinMultiPage } = require('../dist/crawl/zhaopinMultiPage.js');
const { crawlLiepinOfficialMultiPage } = require('../dist/crawl/liepinOfficialMultiPage.js');
const {
  crawlBossMultiPage,
  defaultBossUserDataDir,
} = require('../dist/crawler/bossRawCdpCrawl.js');
const { crawlerConfigs } = require('../dist/config/crawlerConfig.js');
const { writeSourceExports } = require('../dist/export/marketScanExport.js');
const { normalizePageRange } = require('../dist/crawl/multiPageCommon.js');

const OUT_DIR = path.join(__dirname, '..', 'test-results', 'v1-multipage');
const KEYWORD = '用户研究';
const CITY = '北京';

function parseArgs(argv) {
  const out = { pageFrom: 1, pageTo: 5, maxJobs: 100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pageFrom' && argv[i + 1]) out.pageFrom = Number(argv[++i]);
    if (argv[i] === '--pageTo' && argv[i + 1]) out.pageTo = Number(argv[++i]);
    if (argv[i] === '--maxJobs' && argv[i + 1]) out.maxJobs = Number(argv[++i]);
  }
  return normalizePageRange(out);
}

function captureFromMulti(source, multi) {
  return {
    source,
    keyword: KEYWORD,
    city: CITY,
    succeeded: multi.succeeded,
    stopReason: multi.stopReason,
    errors: multi.errors,
    pagesFetched: multi.pagesFetched,
    rawCount: multi.rawCount,
    dedupedCount: multi.dedupedCount,
    paginationNote: multi.paginationNote,
    rawJobs: multi.jobs,
  };
}

(async () => {
  const range = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    keyword: KEYWORD,
    city: CITY,
    pageFrom: range.pageFrom,
    pageTo: range.pageTo,
    maxJobs: range.maxJobs,
    sources: {},
  };

  console.log('--- zhaopin ---');
  const zhaopinMulti = await crawlZhaopinMultiPage({
    keyword: KEYWORD,
    city: CITY,
    ...range,
  });
  {
    const exp = writeSourceExports({
      outDir: OUT_DIR,
      sourceKey: 'zhaopin',
      capture: captureFromMulti('zhaopin', zhaopinMulti),
      extraMeta: {
        pagesFetched: zhaopinMulti.pagesFetched,
        stopReason: zhaopinMulti.stopReason,
        rawCount: zhaopinMulti.rawCount,
        dedupedCount: zhaopinMulti.dedupedCount,
      },
    });
    report.sources.zhaopin = {
      pagination: 'url ?p=N',
      succeeded: zhaopinMulti.succeeded,
      pagesFetched: zhaopinMulti.pagesFetched,
      stopReason: zhaopinMulti.stopReason,
      rawCount: zhaopinMulti.rawCount,
      dedupedCount: zhaopinMulti.dedupedCount,
      filteredCount: exp.filteredCount,
      excludedCount: exp.excludedCount,
      reasonSummary: exp.reasonSummary,
      errors: zhaopinMulti.errors,
      files: {
        rawJson: exp.rawJson,
        rawCsv: exp.rawCsv,
        filteredJson: exp.filteredJson,
        filteredCsv: exp.filteredCsv,
      },
    };
  }

  console.log('--- liepin-official-mcp ---');
  const liepinMulti = await crawlLiepinOfficialMultiPage({
    keyword: KEYWORD,
    city: CITY,
    ...range,
  });
  {
    const exp = writeSourceExports({
      outDir: OUT_DIR,
      sourceKey: 'liepin',
      capture: captureFromMulti('liepin-official-mcp', liepinMulti),
      extraMeta: {
        pagesFetched: liepinMulti.pagesFetched,
        stopReason: liepinMulti.stopReason,
        rawCount: liepinMulti.rawCount,
        dedupedCount: liepinMulti.dedupedCount,
        paginationNote: liepinMulti.paginationNote,
      },
    });
    report.sources.liepin = {
      pagination: liepinMulti.paginationNote,
      succeeded: liepinMulti.succeeded,
      pagesFetched: liepinMulti.pagesFetched,
      stopReason: liepinMulti.stopReason,
      rawCount: liepinMulti.rawCount,
      dedupedCount: liepinMulti.dedupedCount,
      filteredCount: exp.filteredCount,
      excludedCount: exp.excludedCount,
      reasonSummary: exp.reasonSummary,
      errors: liepinMulti.errors,
      files: {
        rawJson: exp.rawJson,
        rawCsv: exp.rawCsv,
        filteredJson: exp.filteredJson,
        filteredCsv: exp.filteredCsv,
      },
    };
  }

  console.log('--- boss ---');
  const zhipin = crawlerConfigs.find((c) => c.name === 'zhipin-web');
  const bossMulti = await crawlBossMultiPage(defaultBossUserDataDir(), {
    pageFrom: range.pageFrom,
    pageTo: range.pageTo,
    maxJobs: range.maxJobs,
    buildPageUrl: (page) =>
      zhipin.urlBuilder(
        zhipin.url,
        { keyword: KEYWORD, city: CITY, page },
        zhipin.config || {}
      ),
  });
  // Align MultiPageResult-like fields
  const bossAsMulti = {
    succeeded: bossMulti.succeeded,
    jobs: bossMulti.jobs,
    pagesFetched: bossMulti.pagesFetched,
    rawCount: bossMulti.perPage.reduce((n, p) => n + (p.visibleCardCount || 0), 0),
    dedupedCount: bossMulti.jobs.length,
    stopReason: bossMulti.stopReason,
    errors: bossMulti.errors,
    perPage: bossMulti.perPage,
  };
  {
    const exp = writeSourceExports({
      outDir: OUT_DIR,
      sourceKey: 'boss',
      capture: captureFromMulti('zhipin-web', bossAsMulti),
      extraMeta: {
        pagesFetched: bossAsMulti.pagesFetched,
        stopReason: bossAsMulti.stopReason,
        rawCount: bossAsMulti.rawCount,
        dedupedCount: bossAsMulti.dedupedCount,
      },
    });
    report.sources.boss = {
      pagination: 'url &page=N + Chrome CDP persistent profile',
      succeeded: bossAsMulti.succeeded,
      pagesFetched: bossAsMulti.pagesFetched,
      stopReason: bossAsMulti.stopReason,
      rawCount: bossAsMulti.rawCount,
      dedupedCount: bossAsMulti.dedupedCount,
      filteredCount: exp.filteredCount,
      excludedCount: exp.excludedCount,
      reasonSummary: exp.reasonSummary,
      errors: bossAsMulti.errors,
      files: {
        rawJson: exp.rawJson,
        rawCsv: exp.rawCsv,
        filteredJson: exp.filteredJson,
        filteredCsv: exp.filteredCsv,
      },
    };
  }

  const summaryPath = path.join(OUT_DIR, `v1-summary-${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summaryPath, report }, null, 2));
  const ok =
    report.sources.zhaopin.succeeded &&
    report.sources.liepin.succeeded &&
    report.sources.boss.succeeded;
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
