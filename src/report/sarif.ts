// SARIF 2.1.0 report (§5.3). Manual items are excluded.
import { RULES } from '../rules/index.js';
import type { Severity } from '../snapshot.js';
import { DISCLAIMER } from './constants.js';
import { targetLabel, type Report } from './index.js';
import type { Snapshot } from '../snapshot.js';

/** A valid SARIF `uri` for the target: the redacted URL, or a percent-encoded `stdio:` URI for a command. */
export function artifactUri(snap: Snapshot): string {
  if (snap.target.kind === 'stdio') return `stdio:${encodeURIComponent([snap.target.command, ...snap.target.args].join(' '))}`;
  const label = targetLabel(snap);
  try { return new URL(label).href; } catch { return encodeURI(label); }
}

const LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

export function toSarif(r: Report): Record<string, unknown> {
  const uri = artifactUri(r.snap);
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'mcp-review-check',
            version: r.tool.version,
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
        results: r.findings.map((f) => ({
          ruleId: f.ruleId,
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
        properties: { disclaimer: DISCLAIMER.replace(/\n/g, ' '), summary: r.summary },
      },
    ],
  };
}

export function renderSarif(r: Report): string {
  return JSON.stringify(toSarif(r), null, 2) + '\n';
}
