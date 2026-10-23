// Score and verdicts (§5.2). Weights are provisional.
import { platformSeverity, type Finding } from '../rules/types.js';
import type { Platform, Severity, TargetOpt } from '../snapshot.js';

export type Verdict = 'BLOCKED' | 'NEEDS ATTENTION' | 'NO AUTOMATED BLOCKERS' | 'INCOMPLETE';
export type FailOn = 'error' | 'warning' | 'never';

/** Version of the score formula in JSON summary.scoreVersion; the baseline (up to 3 findings per rule) is 1. */
export const SCORE_VERSION = 2;

/** Rules with an error finding, and rules with warnings only: one root cause each, however many findings (R-31). */
export function rootCauses(findings: Finding[]): { errors: number; warnings: number } {
  const errors = new Set(findings.filter((f) => f.severity === 'error').map((f) => f.ruleId));
  const warnings = new Set(findings.filter((f) => f.severity === 'warning' && !errors.has(f.ruleId)).map((f) => f.ruleId));
  return { errors: errors.size, warnings: warnings.size };
}

/** 100 - 12 per rule with an error - 4 per rule with warnings only, not below 0. */
export function score(findings: Finding[]): number {
  const { errors, warnings } = rootCauses(findings);
  return Math.max(0, 100 - 12 * errors - 4 * warnings);
}

/** `complete` is false when tool-level checks could not run (auth, connect or list failure): no errors then means INCOMPLETE, not a pass; after a failed connect or a --max-duration stop (`connectFailed`, R-17, R-60) it is INCOMPLETE even with errors. */
export function verdict(findings: Finding[], platform: Platform, complete = true, connectFailed = false): { verdict: Verdict; errors: number; warnings: number } {
  // Count each finding at this platform's own severity, not the maximum over all its platforms.
  const mine = findings.filter((f) => f.platforms.includes(platform)).map((f) => platformSeverity(f, platform));
  const errors = mine.filter((s) => s === 'error').length;
  const warnings = mine.filter((s) => s === 'warning').length;
  const v: Verdict = connectFailed ? 'INCOMPLETE' : errors ? 'BLOCKED' : !complete ? 'INCOMPLETE' : warnings ? 'NEEDS ATTENTION' : 'NO AUTOMATED BLOCKERS';
  return { verdict: v, errors, warnings };
}

/** Platforms whose findings decide the exit code: the --target directories, plus spec only with --fail-on-spec (B5). */
export function gatedPlatforms(target: TargetOpt, failOnSpec = false): Platform[] {
  const dirs: Platform[] = target === 'all' ? ['claude', 'chatgpt'] : [target];
  return failOnSpec ? [...dirs, 'spec'] : dirs;
}

export interface Gate {
  failed: boolean;
  /** The gated platforms. */
  platforms: Platform[];
  /** Why the run failed ("claude: 2 errors (TOOL-006, TOOL-011)"); null on a pass. */
  reason: string | null;
  /** Spec findings at or above the threshold that no gated platform counted (spec is not gated); null when none. */
  notGated: string | null;
}

const reaches = (s: Severity, failOn: FailOn) => (failOn === 'warning' ? s !== 'info' : failOn === 'error' && s === 'error');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "2 errors, 1 warning (TOOL-006, TOOL-011, INJ-006)": counts at the platform's own severity and up to 5 rule IDs. */
function tally(list: Finding[], p: Platform): string {
  const sev = list.map((f) => platformSeverity(f, p));
  const counts = [['error', 'error'], ['warning', 'warning']]
    .map(([k, w]) => [sev.filter((s) => s === k).length, w] as const)
    .filter(([n]) => n > 0)
    .map(([n, w]) => plural(n, w));
  const ids = [...new Set(list.map((f) => f.ruleId))];
  return `${counts.join(', ')} (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `, +${ids.length - 5} more` : ''})`;
}

/** The pass/fail decision over the gated platforms, with its reason. */
export function gate(findings: Finding[], failOn: FailOn, platforms: Platform[]): Gate {
  const hits = (p: Platform) => (failOn === 'never' ? [] : findings.filter((f) => f.platforms.includes(p) && reaches(platformSeverity(f, p), failOn)));
  const parts = platforms.map((p) => [p, hits(p)] as const).filter(([, l]) => l.length).map(([p, l]) => `${p}: ${tally(l, p)}`);
  const counted = new Set(platforms.flatMap(hits));
  const spec = platforms.includes('spec') ? [] : hits('spec').filter((f) => !counted.has(f));
  return {
    failed: parts.length > 0, platforms,
    reason: parts.length ? parts.join('; ') : null,
    notGated: spec.length ? `spec: ${tally(spec, 'spec')} not gated; add --fail-on-spec to fail on spec findings` : null,
  };
}

/** True when any finding reaches the threshold on one of `platforms` (default: every platform). */
export function failed(findings: Finding[], failOn: FailOn, platforms: Platform[] = ['claude', 'chatgpt', 'spec']): boolean {
  return gate(findings, failOn, platforms).failed;
}
