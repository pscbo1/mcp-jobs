/**
 * BOSS desktop filter codes verified by UI click → location.search (raw CDP).
 * Only include URL-confirmed values. Do not invent codes.
 */
export const BOSS_VERIFIED_FILTERS = {
  verifiedAt: '2026-08-25',
  queryParams: ['query', 'city', 'page', 'experience', 'salary', 'degree'] as const,
  city: {
    北京: '101010100',
  },
  experience: {
    在校生: '108',
    应届生: '102',
    '1年以内': '103',
    '1-3年': '104',
    '3-5年': '105',
    '5-10年': '106',
    '10年以上': '107',
  },
  salary: {
    '3K以下': '402',
    '3-5K': '403',
    '5-10K': '404',
    '10-20K': '405',
    '20-50K': '406',
  },
  degree: {
    本科: '203',
  },
  notes: [
    '50K以上 / remaining degree options were not URL-confirmed in the verification run and are omitted.',
    'page=N is accepted by desktop geek/job URLs (used for pagination).',
  ],
} as const;
