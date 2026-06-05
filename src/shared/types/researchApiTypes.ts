export type ResearchApiProvider = 'tushare' | 'eastmoney' | 'webiq';

export const RESEARCH_API_PROVIDERS: readonly ResearchApiProvider[] = [
  'tushare',
  'eastmoney',
  'webiq',
] as const;

export interface ResearchApiProviderStatus {
  provider: ResearchApiProvider;
  hasApiKey: boolean;
  verified: boolean;
  verifiedAt: string | null;
  lastTestError: string | null;
}

export interface ResearchApiSaveResult {
  ok: boolean;
  error?: string;
  status?: ResearchApiProviderStatus;
}

export interface ResearchApiConnectionResult {
  ok: boolean;
  error?: string;
  status?: ResearchApiProviderStatus;
}

export interface ResearchApiOpenTokenFileResult {
  ok: boolean;
  filePath?: string;
  error?: string;
}
