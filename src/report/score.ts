// Score and verdicts (§5.2). Weights are provisional.
import { platformSeverity, type Finding } from '../rules/types.js';
import type { Platform } from '../snapshot.js';

export type Verdict = 'BLOCKED' | 'NEEDS ATTENTION' | 'NO AUTOMATED BLOCKERS' | 'INCOMPLETE';
export type FailOn = 'error' | 'warning' | 'never';

export function score(findings: Finding[]): number {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    if (f.severity === 'info') continue;
    byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  }
  let e = 0;
  let w = 0;
  for (const list of byRule.values()) {
    const top = [...list].sort((a, b) => (a.severity === 'error' ? -1 : 1) - (b.severity === 'error' ? -1 : 1)).slice(0, 3);
    for (const f of top) f.severity === 'error' ? e++ : w++;
  }
  return Math.max(0, Math.round(100 - 12 * e - 4 * w));
}

/** `complete` is false when tool-level checks could not run (auth, connect or list failure): no errors then means INCOMPLETE, not a pass. */
export function verdict(findings: Finding[], platform: Platform, complete = true): { verdict: Verdict; errors: number; warnings: number } {
  // Count each finding at this platform's own severity, not the maximum over all its platforms.
  const mine = findings.filter((f) => f.platforms.includes(platform)).map((f) => platformSeverity(f, platform));
  const errors = mine.filter((s) => s === 'error').length;
  const warnings = mine.filter((s) => s === 'warning').length;
  const v: Verdict = errors ? 'BLOCKED' : !complete ? 'INCOMPLETE' : warnings ? 'NEEDS ATTENTION' : 'NO AUTOMATED BLOCKERS';
  return { verdict: v, errors, warnings };
}

export function failed(findings: Finding[], failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  if (failOn === 'warning') return findings.some((f) => f.severity !== 'info');
  return findings.some((f) => f.severity === 'error');
}
