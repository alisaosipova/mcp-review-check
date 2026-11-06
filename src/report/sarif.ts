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

export function toSarif(r: Report, location = SARIF_LOCATION): Record<string, unknown> {
  const uri = artifactUri(location);
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
        // One code-scanning category (the id up to its last "/") per --sarif-location; the target is a run property.
        automationDetails: { id: `mcp-review-check/${uri}/${r.startedAt}` },
        // The URL (credentials and secret parameters masked by displayUrl) or the command; the CLI scrubs the report first.
        properties: { target: targetLabel(r.snap), disclaimer: DISCLAIMER.replace(/\n/g, ' '), summary: r.summary },
      },
    ],
  };
}

export function renderSarif(r: Report, location?: string): string {
  return stringifyReport(toSarif(r, location), 'sarif', r.findings.length);
}
