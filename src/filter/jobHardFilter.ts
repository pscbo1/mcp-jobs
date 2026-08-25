export type JobLike = {
  title?: string;
  company?: string;
  address?: string;
  experience?: string;
  salary?: string;
  jobDetail?: string;
  tags?: string[];
  [key: string]: any;
};

export type FilterDecision = {
  keep: boolean;
  reasons: string[];
};

/** Hard excludes applied after raw crawl (all sources). */
export const HARD_EXCLUDE_RULES: Array<{
  id: string;
  label: string;
  test: (job: JobLike, blob: string) => boolean;
}> = [
  {
    id: 'intern',
    label: '实习',
    test: (_job, blob) => /实习|实习生|intern/i.test(blob),
  },
  {
    id: 'part_time',
    label: '兼职',
    test: (_job, blob) => /兼职|part[-\s]?time/i.test(blob),
  },
  {
    id: 'labor_dispatch',
    label: '劳务派遣',
    test: (_job, blob) => /劳务派遣|劳务派遣工/.test(blob),
  },
  {
    id: 'outsourcing',
    label: '外包',
    test: (_job, blob) => /外包|外包岗|人力外包|IT外包/.test(blob),
  },
  {
    id: 'onsite',
    label: '驻场',
    test: (_job, blob) => /驻场|驻场开发|客户现场/.test(blob),
  },
];

function jobBlob(job: JobLike): string {
  const tags = Array.isArray(job.tags) ? job.tags.join(' ') : '';
  return [job.title, job.company, job.address, job.experience, job.salary, tags, job.jobDetail]
    .filter(Boolean)
    .join(' ');
}

export function evaluateHardExcludes(job: JobLike): FilterDecision {
  const blob = jobBlob(job);
  const reasons: string[] = [];
  for (const rule of HARD_EXCLUDE_RULES) {
    if (rule.test(job, blob)) reasons.push(rule.label);
  }
  return { keep: reasons.length === 0, reasons };
}

export type FilteredJob = JobLike & {
  excluded?: boolean;
  excludeReasons?: string[];
};

export function applyHardExcludes(jobs: JobLike[]): {
  kept: FilteredJob[];
  excluded: FilteredJob[];
  reasonSummary: Record<string, number>;
} {
  const kept: FilteredJob[] = [];
  const excluded: FilteredJob[] = [];
  const reasonSummary: Record<string, number> = {};

  for (const job of jobs) {
    const decision = evaluateHardExcludes(job);
    if (decision.keep) {
      kept.push({ ...job, excluded: false, excludeReasons: [] });
    } else {
      for (const r of decision.reasons) {
        reasonSummary[r] = (reasonSummary[r] || 0) + 1;
      }
      excluded.push({ ...job, excluded: true, excludeReasons: decision.reasons });
    }
  }

  return { kept, excluded, reasonSummary };
}
