import type { Platform, Severity, Snapshot } from '../snapshot.js';
export type { Platform, Severity } from '../snapshot.js';

export type Need =
  | 'tools' | 'resources' | 'prompts' | 'ui' | 'http' | 'stdio' | 'auth'
  | 'legacy' | 'modern' | 'active' | 'active-auth' | 'plugin-dir' | 'openai-manifest'
  /** The server answered the handshake (initializeRaw or discoverRaw is set; 1.2.0, A04-03). */
  | 'handshake'
  /** An HTTP target, judged on the entered URL or its DNS alone: such a rule can pass without a working transport (1.2.0, I-A13-3). */
  | 'url'
  /** The transport itself: an HTTP target, or a stdio target that did not start (SRV-003 reports that failure; 1.2.0, A10-06). */
  | 'transport';

/** Needs whose rules judge data that exists without a working transport: finding nothing is a pass for them (I-A13-3). */
export const NO_TRANSPORT_NEEDS: readonly Need[] = ['url', 'transport'];
/** Needs met by a listing input: the only rules that run in a listing-only run. */
export const LISTING_NEEDS: readonly Need[] = ['plugin-dir', 'openai-manifest'];

export interface RuleMeta {
  id: string;
  title: string;
  severity: Partial<Record<Platform, Severity>>; // keys = platforms
  /** A case where a finding differs from `severity` (explain prints it after the Severity line). */
  severityNote?: string;
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
  /** Overrides the rule's sources for this finding (e.g. a platform-specific page). */
  docs?: string[];
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
