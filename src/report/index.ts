// Report model shared by all formats.
import { VERSION } from '../version.js';
import { CATALOG_DATE, catalogAgeDays } from '../catalog.js';
import { activePlatforms, type EngineResult } from '../rules/engine.js';
import type { ManualItem } from '../rules/manual.js';
import { platformSeverity, type Finding } from '../rules/types.js';
import { displayUrl } from '../rules/util/net.js';
import { hasUi, isStr } from '../rules/util/access.js';
import { uiResources } from '../rules/util/ui.js';
import type { Snapshot } from '../snapshot.js';
import { failed, score, verdict, type FailOn, type Verdict } from './score.js';

export interface Report {
  tool: { name: string; version: string; catalogDate: string; catalogAgeDays: number };
  startedAt: string;
  durationMs: number;
  snap: Snapshot;
  findings: Finding[];
  ignored: Finding[];
  skipped: EngineResult['skipped'];
  rulesRun: number;
  manual: ManualItem[];
  failOn: FailOn;
  summary: {
    errors: number;
    warnings: number;
    info: number;
    /** null when the check is partial (coverage.toolLevel is not 'ok'). */
    score: number | null;
    verdicts: Partial<Record<'claude' | 'chatgpt', { verdict: Verdict; errors: number; warnings: number }>>;
    failed: boolean;
  };
}

export function buildReport(snap: Snapshot, result: EngineResult, manual: ManualItem[], failOn: FailOn, startedAt: Date, durationMs: number): Report {
  const f = result.findings;
  const complete = snap.coverage.toolLevel === 'ok';
  const verdicts: Report['summary']['verdicts'] = {};
  for (const p of activePlatforms(snap.options.target)) if (p !== 'spec') verdicts[p] = verdict(f, p, complete);
  return {
    tool: { name: 'mcp-review-check', version: VERSION, catalogDate: CATALOG_DATE, catalogAgeDays: catalogAgeDays(startedAt) },
    startedAt: startedAt.toISOString(), durationMs, snap,
    findings: f, ignored: result.ignored, skipped: result.skipped, rulesRun: result.rulesRun, manual, failOn,
    summary: {
      errors: f.filter((x) => x.severity === 'error').length,
      warnings: f.filter((x) => x.severity === 'warning').length,
      info: f.filter((x) => x.severity === 'info').length,
      score: complete ? score(f) : null, verdicts, failed: failed(f, failOn),
    },
  };
}

/** The target for display: secret query values and URL userinfo are redacted. */
export function targetLabel(snap: Snapshot): string {
  return snap.target.kind === 'http' ? displayUrl(snap.target.urlAsEntered) : `stdio:${[snap.target.command, ...snap.target.args].join(' ')}`;
}

/** "claude, spec, chatgpt: warning": platforms whose own severity is below the finding's are annotated. */
export function platformLabel(f: Finding): string {
  return f.platforms.map((p) => (platformSeverity(f, p) !== f.severity ? `${p}: ${platformSeverity(f, p)}` : p)).join(', ');
}

export function serverName(snap: Snapshot): string {
  const si = snap.serverInfo ?? {};
  const name = isStr(si.title) ? si.title : isStr(si.name) ? si.name : 'MCP server';
  return isStr(si.version) ? `${name} ${si.version}` : name;
}

export function authSummary(snap: Snapshot): string {
  const a = snap.authProbe;
  if (!a) return snap.target.kind === 'stdio' ? 'n/a' : 'none';
  if (!a.prm && !a.legacyDiscovery) return `${a.challenge?.status ?? 401} without OAuth discovery`;
  const m = a.as[0]?.json ?? {};
  const bits: string[] = a.prm ? [] : ['legacy discovery, no PRM'];
  if (m.client_id_metadata_document_supported === true) bits.push('CIMD');
  if (isStr(m.registration_endpoint)) bits.push('DCR');
  if (Array.isArray(m.code_challenge_methods_supported) && m.code_challenge_methods_supported.includes('S256')) bits.push('S256');
  return `OAuth${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

export function counts(snap: Snapshot): string {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const ui = hasUi(snap) ? uiResources(snap).length : 0;
  return [n(snap.tools.length, 'tool'), n(snap.resources.length, 'resource'), n(snap.prompts.length, 'prompt'), n(ui, 'UI resource')].join(' · ');
}

export function skippedSummary(skipped: EngineResult['skipped']): string {
  const by = new Map<string, number>();
  for (const s of skipped) by.set(s.reason, (by.get(s.reason) ?? 0) + 1);
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, c]) => `${c} ${r}`);
  return `${skipped.length} skipped${parts.length ? ` (${parts.join('; ')}${by.size > 3 ? '; …' : ''})` : ''}`;
}

export function eraLine(snap: Snapshot): string {
  return `${snap.era}${snap.protocolVersion ? ` (${snap.protocolVersion})` : ''}`;
}


/** "87/100", or "n/a (partial check: auth-required)" when tool-level checks did not run. */
export function scoreLabel(r: Report): string {
  return r.summary.score === null ? `n/a (partial check: ${r.snap.coverage.toolLevel})` : `${r.summary.score}/100`;
}
