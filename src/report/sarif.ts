// SARIF 2.1.0 report (§5.3). Manual items are excluded.
import { createHash } from 'node:crypto';
import { RULES } from '../rules/index.js';
import type { Finding } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import { REPOSITORY_URL } from '../version.js';
import { DISCLAIMER } from './constants.js';
import { targetLabel, type Report } from './index.js';

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

const LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

export function toSarif(r: Report, location = SARIF_LOCATION): Record<string, unknown> {
  const uri = artifactUri(location);
  const seen = new Map<string, number>();
  const prints = r.findings.map((f) => { const n = seen.get(fingerprint(f)) ?? 0; seen.set(fingerprint(f), n + 1); return fingerprint(f, n); });
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
            rules: RULES.map((rule) => ({
              id: rule.id,
              shortDescription: { text: rule.title },
              fullDescription: { text: rule.rationale },
              helpUri: rule.sources[0],
              help: { text: rule.fix },
              properties: { platforms: Object.keys(rule.severity) },
            })),
          },
        },
        results: r.findings.map((f, i) => ({
          ruleId: f.ruleId,
          partialFingerprints: { 'mcpReviewCheck/v1': prints[i] },
          level: LEVEL[f.severity],
          message: { text: `${f.tool ? `${f.tool}: ` : f.resource ? `${f.resource}: ` : ''}${f.message}` },
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
  return JSON.stringify(toSarif(r, location), null, 2) + '\n';
}
