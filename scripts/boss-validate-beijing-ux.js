/**
 * BOSS Beijing UX research validation:
 * multi-page raw CDP crawl + hard excludes + raw/filtered export.
 *
 * Usage:
 *   node scripts/boss-validate-beijing-ux.js
 *
 * Requires logged-in profile at BOSS_USER_DATA_DIR.
 * Persistent profile uses Chrome user-data-dir (Playwright launchPersistentContext
 * blanks on zhipin; we intentionally do not use Playwright for BOSS).
 */
const fs = require('fs');
const path = require('path');
const { crawlBossMultiPage, defaultBossUserDataDir } = require('../dist/crawler/bossRawCdpCrawl.js');
const { applyHardExcludes } = require('../dist/filter/jobHardFilter.js');
const { crawlerConfigs } = require('../dist/config/crawlerConfig.js');

const OUT_DIR = path.join(__dirname, '..', 'test-results');

(async () => {
  const userDataDir = defaultBossUserDataDir();
  const zhipin = crawlerConfigs.find((c) => c.name === 'zhipin-web');
  if (!zhipin) throw new Error('zhipin-web config missing');

  const baseParams = { keyword: '用户研究', city: '北京' };
  const buildPageUrl = (page) =>
    zhipin.urlBuilder(zhipin.url, { ...baseParams, page }, zhipin.config || {});

  const multi = await crawlBossMultiPage(userDataDir, {
    pageFrom: 1,
    pageTo: 5,
    maxJobs: 100,
    buildPageUrl,
  });

  const rawJobs = multi.jobs.map((j) => ({ ...j, source: 'zhipin-web' }));
  const { kept, excluded, reasonSummary } = applyHardExcludes(rawJobs);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawPath = path.join(OUT_DIR, `boss-beijing-ux-raw-${stamp}.json`);
  const filteredPath = path.join(OUT_DIR, `boss-beijing-ux-filtered-${stamp}.json`);
  const summaryPath = path.join(OUT_DIR, `boss-beijing-ux-summary-${stamp}.json`);

  const rawPayload = {
    query: baseParams,
    pagesFetched: multi.pagesFetched,
    stopReason: multi.stopReason,
    perPage: multi.perPage,
    rawCount: rawJobs.length,
    jobs: rawJobs,
  };
  const filteredPayload = {
    query: baseParams,
    keptCount: kept.length,
    excludedCount: excluded.length,
    reasonSummary,
    kept,
    excluded,
  };
  const summary = {
    at: new Date().toISOString(),
    profileDir: userDataDir,
    pagesFetched: multi.pagesFetched,
    pageCount: multi.pagesFetched.length,
    stopReason: multi.stopReason,
    rawCount: rawJobs.length,
    keptCount: kept.length,
    excludedCount: excluded.length,
    reasonSummary,
    rawPath,
    filteredPath,
    sampleKept: kept.slice(0, 5).map((j) => ({
      title: j.title,
      company: j.company,
      address: j.address,
      experience: j.experience,
    })),
  };

  fs.writeFileSync(rawPath, JSON.stringify(rawPayload, null, 2));
  fs.writeFileSync(filteredPath, JSON.stringify(filteredPayload, null, 2));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(multi.succeeded ? 0 : 2);
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
