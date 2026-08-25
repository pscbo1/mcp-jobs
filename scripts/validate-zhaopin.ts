/**
 * Real validation: 用户研究 + 北京 + page 1
 * Saves JSON + CSV under test-results/ (no GitHub push, no Sheets).
 */
import * as fs from 'fs';
import * as path from 'path';
import { crawlByUrl, searchJobList } from '../src/index';

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join(
    '\n'
  );
}

function fieldGaps(job: any) {
  const missing: string[] = [];
  if (!job.title) missing.push('岗位');
  if (!job.company) missing.push('公司');
  if (!job.address) missing.push('城市');
  if (!job.experience && !(Array.isArray(job.tags) && job.tags.some((t: string) => /年|经验|不限|应届/.test(t)))) {
    missing.push('经验');
  }
  if (!job.salary) missing.push('薪资');
  if (!job.jobDetail) missing.push('链接');
  return missing;
}

async function main() {
  const outDir = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('=== crawlByUrl zhaopin only ===');
  const zhaopinDataset = await crawlByUrl('https://www.zhaopin.com/sou', {
    keyword: '用户研究',
    city: '北京',
    page: 1,
  });

  console.log('=== searchJobList all providers ===');
  const search = await searchJobList({ keyword: '用户研究', city: '北京', page: 1 });

  const zItem = zhaopinDataset?.[0];
  const zJobs = Array.isArray(zItem?.data?.jobInfo)
    ? zItem!.data.jobInfo
    : zItem?.data?.jobInfo
      ? [zItem.data.jobInfo]
      : [];

  const samples = (search.jobs.length ? search.jobs : zJobs).slice(0, 20).map((j: any, i: number) => ({
    index: i + 1,
    title: j.title || '',
    company: j.company || '',
    address: j.address || '',
    experience: j.experience || (Array.isArray(j.tags) ? j.tags.join('|') : ''),
    salary: j.salary || '',
    jobDetail: j.jobDetail || '',
    missingFields: fieldGaps(j).join('|'),
  }));

  const report = {
    testedAt: new Date().toISOString(),
    query: { keyword: '用户研究', city: '北京', page: 1 },
    zhaopinCrawl: {
      succeeded: zItem?.succeeded ?? false,
      url: zItem?.url,
      finalUrl: zItem?.finalUrl,
      visibleCardCount: zItem?.visibleCardCount,
      parsedCount: zItem?.parsedCount,
      errors: zItem?.errors || [],
      jobCount: zJobs.length,
    },
    searchSummary: {
      jobCount: search.jobs.length,
      anySucceeded: search.anySucceeded,
      allSucceeded: search.allSucceeded,
      sources: search.sources,
    },
    samples,
    missingFieldStats: samples.reduce(
      (acc: Record<string, number>, row) => {
        String(row.missingFields)
          .split('|')
          .filter(Boolean)
          .forEach((f) => {
            acc[f] = (acc[f] || 0) + 1;
          });
        return acc;
      },
      {} as Record<string, number>
    ),
  };

  const jsonPath = path.join(outDir, 'zhaopin-beijing-user-research.json');
  const csvPath = path.join(outDir, 'zhaopin-beijing-user-research.csv');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(csvPath, toCsv(samples), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${csvPath}`);

  if (!zItem?.succeeded || zJobs.length < 10) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
