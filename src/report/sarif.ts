// SARIF 2.1.0 report (§5.3). Manual items are excluded.
import { createHash } from 'node:crypto';
import { INTERNAL, subjectOf } from '../rules/engine.js';
import { RULES } from '../rules/index.js';
import type { Finding } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import { REPOSITORY_URL } from '../version.js';
import { DISCLAIMER } from './constants.js';
import { stringifyReport, targetLabel, type Report } from './index.js';

/** Default artifactLocation (--sarif-location): code scanning takes repository-relative paths, not the server URL. */
export const SARIF_LOCATION = '.mcp-review-check';

/** A valid relative SARIF `uri` for a --sarif-location path (checked by the CLI: no scheme, not absolute, no ".."). */
export function artifactUri(location: string): string {
  return encodeURI(location.replace(/\\/g, '/'));
}

/** Stable across runs and targets: rule, subject (tool or resource) and path, not wording; the n-th repeat in a run differs. */
export function fingerprint(f: Finding, n = 0): string {
  return createHash('sha256').update([f.ruleId, f.tool ?? f.resource ?? '', f.path ?? '', ...(n ? [n] : [])].join('|')).digest('hex');
}

/**
 * SARIF plain-text message (SARIF 2.1.0 s3.11.6): `[text](uri)` is an embedded link, so `\`, `[` and `]` are escaped
 * with a backslash and server text (a tool name, a quoted description) cannot become a link in a viewer (A07-07).
 */
export function sarifText(s: string): string {
  return s.replace(/[\\[\]]/g, '\\$&');
}

const LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

/** What the CLI knows only after the report is built: its exit code (spec s5.3, 1.3.0, A07-08). */
export interface SarifRunInfo { exitCode?: number }

/**
 * Why this run is not a complete analysis, one line per cause (1.3.0, A07-08): no connect, a --max-duration stop, a
 * partial check (tool checks skipped) or rules that threw. Empty for a complete analysis. The report is already redacted.
 */
export function incompleteCauses(r: Report): string[] {
  const out: string[] = [];
  const { snap } = r;
  if (snap.fatal) out.push(`the server could not be checked: ${snap.fatal}`);
  const stop = snap.limits?.stopped;
  if (stop) out.push(`stopped by --max-duration (${stop.maxDurationMs} ms) during ${stop.phase}; the findings of the unfinished phases are missing`);
  const budget = snap.limits?.budgetExhausted;
  if (budget) out.push(`snapshot byte budget exhausted during ${budget.phase}; the findings of the unfinished phases are missing`);
  if (!snap.fatal && !stop && snap.coverage.toolLevel !== 'ok') out.push(`partial check (${snap.coverage.toolLevel})${snap.coverage.reason ? `: ${snap.coverage.reason}` : ''}; tool checks were skipped`);
  const thrown = r.summary.internalErrors ?? 0;
  if (thrown) out.push(`${thrown} rule${thrown === 1 ? '' : 's'} threw (INTERNAL results); their findings are missing`);
  return out;
}

/**
 * The code-scanning category part for the checked server (1.3.0, A12-03): a readable slug of the redacted URL (host
 * and path) or the stdio command, plus 8 hex digits of its SHA-256, so two servers in one repository get two
 * categories and one server keeps its category from run to run. Never contains "/".
 */
export function targetSlug(r: Report): string {
  const t = r.snap.target;
  let label: string;
  if (t.kind === 'listing') label = 'listing-only';
  else if (t.kind === 'http') {
    let shown = targetLabel(r.snap);
    try { const u = new URL(shown); shown = `${u.host}${u.pathname}`; } catch { /* keep the label */ }
    label = shown;
  } else label = `stdio-${[t.command, ...t.args].join(' ')}`;
  const readable = label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 48).replace(/[-.]+$/, '');
  const hash = createHash('sha256').update(targetLabel(r.snap)).digest('hex').slice(0, 8);
  return `${readable || 'target'}-${hash}`;
}

export function toSarif(r: Report, location = SARIF_LOCATION, info: SarifRunInfo = {}): Record<string, unknown> {
  const uri = artifactUri(location);
  const causes = incompleteCauses(r);
  const seen = new Map<string, number>();
  const prints = r.findings.map((f) => { const n = seen.get(fingerprint(f)) ?? 0; seen.set(fingerprint(f), n + 1); return fingerprint(f, n); });
  const rules: Record<string, unknown>[] = RULES.map((rule) => ({
    id: rule.id,
    shortDescription: { text: rule.title },
    fullDescription: { text: rule.rationale },
    helpUri: rule.sources[0],
    help: { text: rule.fix },
    properties: { platforms: Object.keys(rule.severity) },
  }));
  // A rule that threw is reported as INTERNAL: its results get a rule entry like every other result.
  if (r.findings.some((f) => f.ruleId === INTERNAL.id)) {
    rules.push({
      id: INTERNAL.id, shortDescription: { text: INTERNAL.title },
      fullDescription: { text: 'A check of mcp-review-check threw an exception, so its findings are missing from this report.' },
      help: { text: INTERNAL.fix }, properties: { platforms: ['spec'] },
    });
  }
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'mcp-review-check',
            version: r.tool.version,
            ...(REPOSITORY_URL ? { informationUri: REPOSITORY_URL } : {}),
            rules,
          },
        },
        results: r.findings.map((f, i) => ({
          ruleId: f.ruleId,
          partialFingerprints: { 'mcpReviewCheck/v1': prints[i] },
          level: LEVEL[f.severity],
          message: { text: sarifText(`${f.tool !== undefined || f.resource !== undefined ? `${subjectOf(f)}: ` : ''}${f.message}`) },
          locations: [
            {
              physicalLocation: { artifactLocation: { uri } },
              ...(f.tool ? { logicalLocations: [{ name: f.tool, kind: 'function' }] } : {}),
            },
          ],
          properties: { platforms: f.platforms, severityByPlatform: f.severityByPlatform, fix: f.fix, path: f.path },
        })),
        // SARIF 2.1.0 s3.20: a failed connect, a --max-duration stop or a partial check is not a complete analysis, so a
        // consumer must not read the missing results as fixed (1.3.0, A07-08). exitCode is the CLI's, when known.
        invocations: [{
          executionSuccessful: causes.length === 0,
          ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
          ...(causes.length ? { toolExecutionNotifications: causes.map((text) => ({ level: 'error', message: { text: sarifText(text) } })) } : {}),
        }],
        // One code-scanning category (the id up to its last "/") per --sarif-location and checked server (1.3.0, A12-03).
        automationDetails: { id: `mcp-review-check/${uri}/${targetSlug(r)}/${r.startedAt}` },
        // The URL (credentials and secret parameters masked by displayUrl) or the command; the CLI scrubs the report first.
        properties: { target: targetLabel(r.snap), disclaimer: DISCLAIMER.replace(/\n/g, ' '), summary: r.summary },
      },
    ],
  };
}

export function renderSarif(r: Report, location?: string, info?: SarifRunInfo): string {
  return stringifyReport(toSarif(r, location, info), 'sarif', r.findings.length);
}
