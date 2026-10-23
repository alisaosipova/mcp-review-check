// Rule engine: needs evaluation, platform filtering, severity, ignore, sorting (§1.2, §4.2).
import type { Platform, Severity, Snapshot, TargetOpt } from '../snapshot.js';
import { hasUi } from './util/access.js';
import { maxSeverity, SEVERITY_RANK, type Finding, type Need, type Rule } from './types.js';

export function activePlatforms(target: TargetOpt): Platform[] {
  if (target === 'claude') return ['claude', 'spec'];
  if (target === 'chatgpt') return ['chatgpt', 'spec'];
  return ['claude', 'chatgpt', 'spec'];
}

const LEGACY_ERAS = new Set(['legacy', 'dual', 'sse-legacy']);
const MODERN_ERAS = new Set(['modern', 'dual']);

function listOk(snap: Snapshot, key: string): boolean {
  const m = snap.listMeta[key];
  return !!m && !m.error;
}

function authReason(snap: Snapshot): string | undefined {
  if (snap.coverage.toolLevel === 'auth-required') return 'server requires auth; pass --bearer <token>';
  if (snap.coverage.toolLevel === 'token-rejected') return 'token rejected (401)';
  if (snap.coverage.toolLevel === 'connect-failed') return 'could not connect';
  if (snap.coverage.toolLevel === 'list-failed') return snap.coverage.reason ?? 'tools/list failed';
  if (snap.coverage.toolLevel === 'stopped') return 'stopped by --max-duration';
  return undefined;
}

/** Returns undefined when the need is met, otherwise the skip reason. */
export function unmetNeed(snap: Snapshot, need: Need): string | undefined {
  const isHttp = snap.target.kind === 'http';
  switch (need) {
    case 'tools':
    case 'resources':
    case 'prompts':
      return listOk(snap, need) ? undefined : authReason(snap) ?? `${need}/list not available`;
    case 'ui':
      return hasUi(snap) ? undefined : authReason(snap) ?? 'no UI resources';
    case 'http':
      return isHttp ? undefined : 'stdio target';
    case 'stdio':
      return isHttp ? 'HTTP target' : undefined;
    case 'auth':
      return snap.authProbe ? undefined : isHttp ? 'server did not request auth' : 'stdio target';
    case 'legacy':
      return LEGACY_ERAS.has(snap.era) || (!isHttp && snap.era !== 'unknown') ? undefined : `era ${snap.era}`;
    case 'modern':
      return MODERN_ERAS.has(snap.era) ? undefined : `era ${snap.era} (not 2026-07-28)`;
    case 'active':
      if (!snap.options.active) return 'needs --active';
      return snap.active ? authReason(snap) : authReason(snap) ?? 'no active calls made';
    case 'active-auth':
      if (!snap.options.activeAuth) return 'needs --active-auth';
      return snap.authProbe?.active ? undefined : 'auth probe did not run';
  }
}

export interface EngineResult {
  findings: Finding[];
  ignored: Finding[];
  skipped: Array<{ ruleId: string; reason: string }>;
  rulesRun: number;
}

export interface EngineOptions {
  ignore?: string[];
}

export function subjectOf(f: Pick<Finding, 'tool' | 'resource'>): string {
  return f.tool ?? f.resource ?? 'server';
}

export function sortFindings(list: Finding[]): Finding[] {
  return list.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      subjectOf(a).localeCompare(subjectOf(b)) ||
      a.message.localeCompare(b.message),
  );
}

export function runRules(snap: Snapshot, rules: Rule[], opts: EngineOptions = {}): EngineResult {
  const active = activePlatforms(snap.options.target);
  const ignore = new Set((opts.ignore ?? []).map((s) => s.toUpperCase()));
  const findings: Finding[] = [];
  const ignored: Finding[] = [];
  const skipped: EngineResult['skipped'] = [];
  let rulesRun = 0;

  for (const rule of rules) {
    const rulePlatforms = Object.keys(rule.severity) as Platform[];
    if (!rulePlatforms.some((p) => active.includes(p))) {
      skipped.push({ ruleId: rule.id, reason: `not applicable to --target ${snap.options.target}` });
      continue;
    }
    const reason = rule.needs.map((n) => unmetNeed(snap, n)).find((r) => r !== undefined);
    if (reason) {
      skipped.push({ ruleId: rule.id, reason });
      continue;
    }
    rulesRun++;
    let raw;
    try {
      raw = rule.check(snap);
    } catch (err) {
      findings.push({
        ruleId: 'INTERNAL', title: 'Internal rule error', severity: 'info', platforms: ['spec'],
        message: `${rule.id} threw: ${(err as Error).message}`, fix: 'Please report this bug.', docs: [],
      });
      continue;
    }
    for (const r of raw) {
      const platforms = (r.platforms ?? rulePlatforms).filter((p) => active.includes(p));
      if (platforms.length === 0) continue;
      // An explicit finding severity applies to all of its platforms; otherwise each platform keeps the rule's own level.
      const severityByPlatform: Partial<Record<Platform, Severity>> = {};
      for (const p of platforms) severityByPlatform[p] = r.severity ?? rule.severity[p] ?? 'info';
      const severity = maxSeverity(Object.values(severityByPlatform)) ?? 'info';
      const finding: Finding = {
        ruleId: rule.id, title: rule.title, severity, platforms, severityByPlatform, message: r.message,
        tool: r.tool, resource: r.resource, path: r.path, evidence: r.evidence,
        fix: r.fix ?? rule.fix, docs: r.docs ?? rule.sources,
      };
      (ignore.has(rule.id) ? ignored : findings).push(finding);
    }
  }
  return { findings: sortFindings(findings), ignored, skipped, rulesRun };
}
