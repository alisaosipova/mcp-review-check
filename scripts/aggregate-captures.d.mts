// Types for scripts/aggregate-captures.mjs, used by test/aggregate-captures.test.ts.
type Sev = 'error' | 'warning' | 'info';
type Dir = 'claude' | 'chatgpt';
type V = 'BLOCKED' | 'NEEDS ATTENTION' | 'NO AUTOMATED BLOCKERS' | 'INCOMPLETE';
export interface CaptureResult {
  capturedAt?: string;
  findings: { ruleId: string; severity: Sev; platforms: string[]; severityByPlatform?: Partial<Record<string, Sev>> }[];
  verdicts?: Partial<Record<Dir, V>>;
}
export interface Aggregate {
  servers: number;
  capturedAt: Record<string, number>;
  findings: number;
  bySeverity: Record<Sev, number>;
  byCategory: Record<string, Record<Sev, number>>;
  errorsByRule: Record<string, { findings: number; servers: number }>;
  warningsByRule: Record<string, { findings: number; servers: number }>;
  noBlockers: { claude: number; chatgpt: number; both: number };
  verdicts: Record<Dir, Record<V, number>>;
}
export const DIRECTORIES: Dir[];
export const VERDICTS: V[];
export function aggregate(results: CaptureResult[]): Aggregate;
export function renderMarkdown(a: Aggregate): string;
export function lintCaptures(dir: URL): Promise<{ results: (CaptureResult & { skipped: number; rulesRun: number })[]; rules: number; rulesRunMin: number; rulesRunMax: number }>;
