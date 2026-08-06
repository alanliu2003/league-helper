export type BootstrapPlayerTarget = {
  gameName: string;
  tagLine: string;
  platform: string;
};

export type BootstrapCliArgs = {
  mode: 'single' | 'file';
  /** Length 1 for single mode; empty until file load in CLI for file mode. */
  players: BootstrapPlayerTarget[];
  filePath?: string;
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  json: boolean;
  wait: boolean;
  concurrency: number;
};

export type BootstrapPlayerResult = {
  ok: boolean;
  gameName: string;
  tagLine: string;
  platform: string;
  dryRun: boolean;
  discoveredMatchCount: number;
  wouldEnqueueCount?: number;
  enqueuedCount: number;
  skippedAlreadyCompleteCount: number;
  error?: string;
  /** Match IDs from this run (for --wait); never includes PUUID. */
  externalMatchIds: string[];
};

export type BootstrapRunTotals = {
  players: number;
  playersFailed: number;
  discoveredMatchCount: number;
  enqueuedCount: number;
};

export type BootstrapRunResult = {
  ok: boolean;
  dryRun: boolean;
  players: BootstrapPlayerResult[];
  totals: BootstrapRunTotals;
  error?: string;
};

export type {
  AggregateSmokeResult,
  AggregateSmokeStatus,
  WaitSummary,
} from './bootstrap-verify';
