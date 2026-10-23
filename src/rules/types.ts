import type { Platform, Severity, Snapshot } from '../snapshot.js';
export type { Platform, Severity } from '../snapshot.js';

export type Need =
  | 'tools' | 'resources' | 'prompts' | 'ui' | 'http' | 'stdio' | 'auth'
  | 'legacy' | 'modern' | 'active' | 'active-auth';

export interface RuleMeta {
  id: string;
  title: string;
  severity: Partial<Record<Platform, Severity>>; // keys = platforms
  needs: Need[];
  rationale: string;
  fix: string;
  sources: string[];
}

export interface RawFinding {
  message: string;
  severity?: Severity;
  platforms?: Platform[];
  tool?: string;
  resource?: string;
  path?: string;
  evidence?: string;
  fix?: string;
}

export interface Rule extends RuleMeta {
  check(snap: Snapshot): RawFinding[];
}

export interface Finding {
  ruleId: string;
  title: string;
  /** The highest severity over `platforms` (used for sorting, score and exit code). */
  severity: Severity;
  platforms: Platform[];
  /** Severity per platform; the per-platform verdicts use this (a chatgpt warning stays a warning next to a spec error). */
  severityByPlatform?: Partial<Record<Platform, Severity>>;
  message: string;
  tool?: string;
  resource?: string;
  path?: string;
  evidence?: string;
  fix: string;
  docs: string[];
}

export const SEVERITY_RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };
export const PLATFORMS: Platform[] = ['claude', 'chatgpt', 'spec'];

export function maxSeverity(list: Severity[]): Severity | undefined {
  let best: Severity | undefined;
  for (const s of list) if (!best || SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  return best;
}

/** A finding's severity on one platform. */
export function platformSeverity(f: Pick<Finding, 'severity' | 'severityByPlatform'>, p: Platform): Severity {
  return f.severityByPlatform?.[p] ?? f.severity;
}

export function defineRule(meta: RuleMeta, check: (snap: Snapshot) => RawFinding[]): Rule {
  return { ...meta, check };
}
