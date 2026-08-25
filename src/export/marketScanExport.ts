import * as fs from 'fs';
import * as path from 'path';
import { applyHardExcludes, JobLike } from '../filter/jobHardFilter';

export type CaptureStatus = 'success' | 'failed';

export type UnifiedJobRow = {
  抓取日期: string;
  来源: string;
  搜索词: string;
  岗位: string;
  公司: string;
  城市: string;
  经验: string;
  薪资: string;
  职位链接: string;
  原始JD: string;
  抓取状态: CaptureStatus;
  错误原因: string;
  排除原因: string;
};

export type SourceCaptureResult = {
  source: string;
  keyword: string;
  city: string;
  succeeded: boolean;
  stopReason?: string;
  errors?: string[];
  pagesFetched?: number[];
  rawJobs: JobLike[];
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toUnifiedRow(
  job: JobLike,
  meta: {
    source: string;
    keyword: string;
    city: string;
    status: CaptureStatus;
    error?: string;
    excludeReasons?: string[];
  }
): UnifiedJobRow {
  return {
    抓取日期: today(),
    来源: meta.source,
    搜索词: meta.keyword,
    岗位: String(job.title || ''),
    公司: String(job.company || ''),
    城市: String(job.address || meta.city || ''),
    经验: String(job.experience || ''),
    薪资: String(job.salary || ''),
    职位链接: String(job.jobDetail || ''),
    原始JD: String(job.jd || job.jobDescription || job.description || ''),
    抓取状态: meta.status,
    错误原因: meta.error || '',
    排除原因: (meta.excludeReasons || []).join(';'),
  };
}

/** Dedupe by job link; keep first occurrence. */
export function dedupeByLink(jobs: JobLike[]): JobLike[] {
  const seen = new Set<string>();
  const out: JobLike[] = [];
  for (const job of jobs) {
    const link = String(job.jobDetail || '')
      .trim()
      .toLowerCase();
    const key = link || `${job.title}|${job.company}|${job.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function rowsToCsv(rows: UnifiedJobRow[]): string {
  const headers: (keyof UnifiedJobRow)[] = [
    '抓取日期',
    '来源',
    '搜索词',
    '岗位',
    '公司',
    '城市',
    '经验',
    '薪资',
    '职位链接',
    '原始JD',
    '抓取状态',
    '错误原因',
    '排除原因',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(String(row[h] ?? ''))).join(','));
  }
  return lines.join('\n') + '\n';
}

export function writeSourceExports(opts: {
  outDir: string;
  sourceKey: string;
  capture: SourceCaptureResult;
  extraMeta?: Record<string, any>;
}): {
  rawJson: string;
  rawCsv: string;
  filteredJson: string;
  filteredCsv: string;
  rawCount: number;
  filteredCount: number;
  excludedCount: number;
  reasonSummary: Record<string, number>;
} {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${opts.sourceKey}-${stamp}`;
  const rawJson = path.join(opts.outDir, `${base}-raw.json`);
  const rawCsv = path.join(opts.outDir, `${base}-raw.csv`);
  const filteredJson = path.join(opts.outDir, `${base}-filtered.json`);
  const filteredCsv = path.join(opts.outDir, `${base}-filtered.csv`);

  const { source, keyword, city } = opts.capture;

  if (!opts.capture.succeeded) {
    const failRow = toUnifiedRow(
      {},
      {
        source,
        keyword,
        city,
        status: 'failed',
        error: (opts.capture.errors || [opts.capture.stopReason || 'UNKNOWN_FAILURE']).join('; '),
      }
    );
    const rawPayload = {
      meta: {
        source,
        keyword,
        city,
        succeeded: false,
        stopReason: opts.capture.stopReason,
        errors: opts.capture.errors,
        pagesFetched: opts.capture.pagesFetched,
        rawCount: 0,
        ...opts.extraMeta,
      },
      rows: [failRow],
    };
    fs.writeFileSync(rawJson, JSON.stringify(rawPayload, null, 2), 'utf8');
    fs.writeFileSync(rawCsv, rowsToCsv([failRow]), 'utf8');
    fs.writeFileSync(filteredJson, JSON.stringify(rawPayload, null, 2), 'utf8');
    fs.writeFileSync(filteredCsv, rowsToCsv([failRow]), 'utf8');
    return {
      rawJson,
      rawCsv,
      filteredJson,
      filteredCsv,
      rawCount: 0,
      filteredCount: 0,
      excludedCount: 0,
      reasonSummary: {},
    };
  }

  const deduped = dedupeByLink(opts.capture.rawJobs);
  const rawRows = deduped.map((job) =>
    toUnifiedRow(job, { source, keyword, city, status: 'success' })
  );
  const { kept, excluded, reasonSummary } = applyHardExcludes(deduped);
  const filteredRows = kept.map((job) =>
    toUnifiedRow(job, { source, keyword, city, status: 'success', excludeReasons: [] })
  );
  const excludedRows = excluded.map((job) =>
    toUnifiedRow(job, {
      source,
      keyword,
      city,
      status: 'success',
      excludeReasons: job.excludeReasons || [],
    })
  );

  const rawPayload = {
    meta: {
      source,
      keyword,
      city,
      succeeded: true,
      stopReason: opts.capture.stopReason,
      pagesFetched: opts.capture.pagesFetched,
      rawCount: rawRows.length,
      ...opts.extraMeta,
    },
    rows: rawRows,
  };
  const filteredPayload = {
    meta: {
      source,
      keyword,
      city,
      rawCount: rawRows.length,
      filteredCount: filteredRows.length,
      excludedCount: excludedRows.length,
      reasonSummary,
      note: 'filtered 仅含硬排除后保留行；原始完整结果见 raw，不被覆盖',
      ...opts.extraMeta,
    },
    rows: filteredRows,
    excludedRows,
  };

  fs.writeFileSync(rawJson, JSON.stringify(rawPayload, null, 2), 'utf8');
  fs.writeFileSync(rawCsv, rowsToCsv(rawRows), 'utf8');
  fs.writeFileSync(filteredJson, JSON.stringify(filteredPayload, null, 2), 'utf8');
  fs.writeFileSync(filteredCsv, rowsToCsv(filteredRows), 'utf8');

  return {
    rawJson,
    rawCsv,
    filteredJson,
    filteredCsv,
    rawCount: rawRows.length,
    filteredCount: filteredRows.length,
    excludedCount: excludedRows.length,
    reasonSummary,
  };
}
