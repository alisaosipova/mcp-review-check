// JSON report (§5.3). Findings are not collapsed.
import type { Finding } from '../rules/types.js';
import { contactUrl, CTA_TEXT, DISCLAIMER } from './constants.js';
import { authSummary, targetLabel, type Report } from './index.js';
import { toolFingerprints } from './drift.js';
import { VERSION } from '../version.js';

const findingJson = (f: Finding) => ({
  ruleId: f.ruleId, severity: f.severity, platforms: f.platforms, severityByPlatform: f.severityByPlatform, title: f.title, message: f.message,
  tool: f.tool, resource: f.resource, path: f.path, evidence: f.evidence, fix: f.fix, docs: f.docs,
});

/** Bumped on any breaking change to the JSON shape (renamed or removed fields, changed types). */
export const JSON_SCHEMA_VERSION = 1;

/**
 * The JSON Schema of the report (schema/report.schema.json, its `$id`) at the tag of this release, so a validator that
 * follows `$schema` gets the schema this version writes against (A10-04). The release step that bumps package.json
 * also sets the schema file's `$id` to this URL; a test checks that they agree.
 */
export const JSON_SCHEMA_URL = `https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v${VERSION}/schema/report.schema.json`;

export function toJson(r: Report): Record<string, unknown> {
  const snap = r.snap;
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    $schema: JSON_SCHEMA_URL,
    tool: r.tool,
    target: snap.options.target,
    startedAt: r.startedAt,
    durationMs: Math.round(r.durationMs),
    server: {
      // command is for display; argv keeps each argument whole ("a b" stays one argument).
      ...(snap.target.kind === 'listing' ? { listingOnly: true } : snap.target.kind === 'http' ? { url: targetLabel(snap) } : { command: [snap.target.command, ...snap.target.args].join(' '), argv: [snap.target.command, ...snap.target.args] }),
      serverInfo: snap.serverInfo ?? null,
      era: snap.era,
      protocolVersion: snap.protocolVersion ?? null,
      transport: snap.transport.kind,
      auth: authSummary(snap),
      localMode: snap.localMode,
    },
    coverage: snap.connectDiagnosis ? { ...snap.coverage, diagnosis: snap.connectDiagnosis } : snap.coverage,
    limits: snap.limits ?? null,
    // rootCauses: the basis of summary.score (every platform, whatever --target), so the score can be explained from the JSON.
    summary: { ...r.summary, rootCauses: r.rootCauses },
    findings: r.findings.map(findingJson),
    skipped: r.skipped,
    ignored: r.ignored.map(findingJson),
    manual: r.manual.map((m) => ({ id: m.id, platforms: m.platforms, text: m.text, docs: m.docs })),
    // One SHA-256 per tool definition (null when tools/list did not finish): --baseline compares them (drift).
    toolFingerprints: toolFingerprints(snap),
    disclaimer: DISCLAIMER.replace(/\n/g, ' '),
    contact: contactUrl() ? { text: CTA_TEXT, url: contactUrl() } : null,
  };
}

export function renderJson(r: Report): string {
  return JSON.stringify(toJson(r), null, 2) + '\n';
}
