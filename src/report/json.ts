// JSON report (§5.3). Findings are not collapsed.
import type { Finding } from '../rules/types.js';
import { contactUrl, CTA_TEXT, DISCLAIMER } from './constants.js';
import { authSummary, targetLabel, type Report } from './index.js';

const findingJson = (f: Finding) => ({
  ruleId: f.ruleId, severity: f.severity, platforms: f.platforms, severityByPlatform: f.severityByPlatform, title: f.title, message: f.message,
  tool: f.tool, resource: f.resource, path: f.path, evidence: f.evidence, fix: f.fix, docs: f.docs,
});

/** Bumped on any breaking change to the JSON shape (renamed or removed fields, changed types). */
export const JSON_SCHEMA_VERSION = 1;

export function toJson(r: Report): Record<string, unknown> {
  const snap = r.snap;
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    tool: r.tool,
    target: snap.options.target,
    startedAt: r.startedAt,
    durationMs: Math.round(r.durationMs),
    server: {
      ...(snap.target.kind === 'http' ? { url: targetLabel(snap) } : { command: [snap.target.command, ...snap.target.args].join(' ') }),
      serverInfo: snap.serverInfo ?? null,
      era: snap.era,
      protocolVersion: snap.protocolVersion ?? null,
      transport: snap.transport.kind,
      auth: authSummary(snap),
      localMode: snap.localMode,
    },
    coverage: snap.connectDiagnosis ? { ...snap.coverage, diagnosis: snap.connectDiagnosis } : snap.coverage,
    limits: snap.limits ?? null,
    summary: r.summary,
    findings: r.findings.map(findingJson),
    skipped: r.skipped,
    ignored: r.ignored.map(findingJson),
    manual: r.manual.map((m) => ({ id: m.id, platforms: m.platforms, text: m.text, docs: m.docs })),
    disclaimer: DISCLAIMER.replace(/\n/g, ' '),
    contact: contactUrl() ? { text: CTA_TEXT, url: contactUrl() } : null,
  };
}

export function renderJson(r: Report): string {
  return JSON.stringify(toJson(r), null, 2) + '\n';
}
