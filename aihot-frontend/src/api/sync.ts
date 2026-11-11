export interface SyncEntryStatus {
  name: string;
  path: string;
  lastAttemptAt: number;
  lastSuccessAt: number;
  nextAttemptAt: number;
  consecutiveFailures: number;
  error: string | null;
  lastFailureAt: number;
  lastFailure: string | null;
  warning: string | null;
  cached: boolean;
}

export interface SyncHealth {
  resources: SyncEntryStatus[];
  cache: { bytes: number; limitBytes: number; diskBudgetBytes: number; error: string | null };
}
