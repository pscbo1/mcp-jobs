export type MultiPageParams = {
  keyword: string;
  city?: string;
  pageFrom?: number;
  pageTo?: number;
  maxJobs?: number;
};

export type MultiPageJob = {
  title?: string;
  company?: string;
  address?: string;
  experience?: string;
  salary?: string;
  jobDetail?: string;
  tags?: string[];
  page?: number;
  source?: string;
  [key: string]: any;
};

export type MultiPageResult = {
  succeeded: boolean;
  jobs: MultiPageJob[];
  /** 1-based human page numbers actually fetched */
  pagesFetched: number[];
  rawCount: number;
  dedupedCount: number;
  stopReason: string;
  errors?: string[];
  perPage: Array<{
    page: number;
    url?: string;
    finalUrl?: string;
    visibleCardCount?: number;
    rawCount: number;
    newCount: number;
    errors?: string[];
  }>;
  /** Optional capability notes (e.g. liepin official pagination) */
  paginationNote?: string;
};

/** Defaults: pageFrom=1, pageTo=5, maxJobs=100 */
export function normalizePageRange(params: MultiPageParams): {
  pageFrom: number;
  pageTo: number;
  maxJobs: number;
} {
  const pageFrom = Math.max(1, Number(params.pageFrom ?? 1) || 1);
  const pageTo = Math.max(pageFrom, Number(params.pageTo ?? 5) || 5);
  const maxJobs = Math.max(1, Number(params.maxJobs ?? 100) || 100);
  return { pageFrom, pageTo, maxJobs };
}

export function jobDedupeKey(job: MultiPageJob): string {
  const link = String(job.jobDetail || '')
    .trim()
    .toLowerCase();
  if (link) return link;
  return `${job.title || ''}|${job.company || ''}|${job.address || ''}`.toLowerCase();
}
