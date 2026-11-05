// JUnit XML report (--format junit) for CI test views (GitLab `reports: junit`, dorny/test-reporter, Jenkins).
// One <testsuite> per gated platform (the --target directories, plus spec with --fail-on-spec), one <testcase> per rule
// of that platform: a <failure> when its findings reach --fail-on at the platform's own severity, <skipped> for a rule
// that did not run, lower findings, known (--baseline) and ignored ones in <system-out>. A failed connect or a
// --max-duration stop is one <error> test case per suite, as it fails the run whatever the findings; so is a partial
// check with --fail-on-incomplete (type "incomplete").
import { baselineLine } from '../baseline.js';
import { driftHeading, driftLines, driftSummary, type Drift } from './drift.js';
import { RULES } from '../rules/index.js';
import { CONNECT_REASON, subjectOf } from '../rules/engine.js';
import { platformSeverity, type Finding, type Platform } from '../rules/types.js';
import type { Severity } from '../snapshot.js';
import type { FailOn } from './score.js';
import { scoreLabel, targetLabel, visibleText, type Report } from './index.js';

/** Characters XML 1.0 cannot carry (lone surrogates, U+FFFE, U+FFFF) besides those visibleText already shows. */
const NOT_XML = /[\p{Cs}\uFFFE\uFFFF]/gu;

/** Text for an XML attribute or element: control and format characters as \u{..} (as text and markdown show them),
 *  then the five XML special characters escaped, so server text can neither break the document nor add markup. */
export function xmlText(s: string): string {
  return visibleText(s)
    .replace(NOT_XML, (ch) => `\\u{${ch.codePointAt(0)!.toString(16).toUpperCase()}}`)
    .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);
}

const reaches = (s: Severity, failOn: FailOn) => (failOn === 'warning' ? s !== 'info' : failOn === 'error' && s === 'error');

/** "tool_x: message", or the message alone for a server-level finding; one line. */
const line = (f: Finding, p: Platform) => `[${platformSeverity(f, p)}] ${f.tool !== undefined || f.resource !== undefined ? `${subjectOf(f)}: ` : ''}${f.message}`;

/** One finding with its evidence and fix, each line made visible and escaped. */
function detail(f: Finding, p: Platform): string {
  return [line(f, p), f.evidence ? `  evidence: ${f.evidence}` : '', `  fix: ${f.fix}`].filter(Boolean).map(xmlText).join('\n');
}

interface Case { xml: string; failure: boolean; skipped: boolean; error: boolean }

function testcase(platform: Platform, name: string, inner: string[], flags: Omit<Case, 'xml'>): Case {
  const head = `    <testcase classname="${xmlText(platform)}" name="${xmlText(name)}"`;
  return { ...flags, xml: inner.length ? `${head}>\n${inner.map((x) => `      ${x}`).join('\n')}\n    </testcase>` : `${head}/>` };
}

function suite(r: Report, p: Platform, known: Finding[], drift?: Drift): { xml: string; tests: number; failures: number; errors: number; skipped: number } {
  const skippedBy = new Map(r.skipped.map((s) => [s.ruleId, s.reason]));
  const mine = (list: Finding[], id: string) => list.filter((f) => f.ruleId === id && f.platforms.includes(p));
  const cases: Case[] = [];
  const snap = r.snap;
  if (snap.fatal || snap.limits?.stopped) {
    const why = snap.fatal ? `could not connect: ${snap.coverage.reason ?? snap.fatal}` : `stopped at --max-duration during ${snap.limits!.stopped!.phase}`;
    cases.push(testcase(p, 'mcp-review-check run', [`<error message="${xmlText(why)}" type="${snap.fatal ? 'connect' : 'max-duration'}"/>`], { failure: false, skipped: false, error: true }));
  }
  // --fail-on-incomplete on a partial check (exit 3): the same run case, so a CI test view does not show a green run (A10-01).
  if (r.incompleteFails) {
    const cov = snap.coverage;
    const why = `partial check: ${cov.toolLevel}${cov.reason ? ` (${cov.reason})` : ''}; --fail-on-incomplete fails the run`;
    cases.push(testcase(p, 'mcp-review-check run', [`<error message="${xmlText(why)}" type="incomplete"/>`], { failure: false, skipped: false, error: true }));
  }
  // The catalog's rules for this platform, then any other rule ID with findings here (INTERNAL: a rule that threw).
  const ids: Array<[string, string]> = RULES.filter((rule) => p in rule.severity).map((rule) => [rule.id, rule.title]);
  for (const f of [...r.findings, ...known, ...r.ignored]) {
    if (f.platforms.includes(p) && !ids.some(([id]) => id === f.ruleId)) ids.push([f.ruleId, f.title]);
  }
  for (const [id, title] of ids) {
    const found = mine(r.findings, id);
    const failing = r.failOn === 'never' ? [] : found.filter((f) => reaches(platformSeverity(f, p), r.failOn));
    const out = [
      ...found.filter((f) => !failing.includes(f)).map((f) => `${line(f, p)} (below --fail-on ${r.failOn})`),
      ...mine(known, id).map((f) => `known from baseline, not a failure: ${line(f, p)}`),
      ...mine(r.ignored, id).map((f) => `ignored with --ignore: ${line(f, p)}`),
    ];
    const inner: string[] = [];
    // A failed connect: SRV-003 reports it as a spec error only, so in the directory suites it was not checked rather
    // than passed (A10-05); the run's <error> case above carries the failure.
    const reason = skippedBy.get(id) ?? (snap.fatal && id === 'SRV-003' && p !== 'spec' && !found.length ? CONNECT_REASON : undefined);
    const skipped = reason !== undefined && !found.length;
    if (skipped) inner.push(`<skipped message="${xmlText(reason)}"/>`);
    if (failing.length) {
      const msg = failing.length === 1 ? line(failing[0], p) : `${failing.length} findings at or above --fail-on ${r.failOn}; first: ${line(failing[0], p)}`;
      inner.push(`<failure message="${xmlText(msg)}" type="${platformSeverity(failing[0], p)}">${failing.map((f) => detail(f, p)).join('\n')}</failure>`);
    }
    if (out.length) inner.push(`<system-out>${out.map(xmlText).join('\n')}</system-out>`);
    cases.push(testcase(p, `${id} ${title}`, inner, { failure: failing.length > 0, skipped, error: false }));
  }
  const n = (k: keyof Omit<Case, 'xml'>) => cases.filter((c) => c[k]).length;
  const tests = cases.length;
  const [failures, errors, skipped] = [n('failure'), n('error'), n('skipped')];
  const verdict = p === 'spec' ? undefined : r.summary.verdicts[p]?.verdict;
  const budget = snap.limits?.budgetExhausted;
  const props = [['target', targetLabel(snap)], ['score', scoreLabel(r)], ['failOn', r.failOn], ...(verdict ? [['verdict', verdict]] : []), ...(budget ? [['incomplete', `snapshot budget exhausted (during ${budget.phase})`]] : []), ...(known.length ? [['baselined', String(known.filter((f) => f.platforms.includes(p)).length)]] : [])];
  // The drift is the same for every suite: each one's <system-out> has it, after the known-findings line.
  const driftOut = !drift ? [] : driftSummary(drift) ? [driftSummary(drift)!] : [driftHeading(drift), ...driftLines(drift).map((l) => `  ${l}`)];
  const tally = [...(budget ? [`incomplete: snapshot budget exhausted (during ${budget.phase}) after ${budget.bytes} bytes; later checks did not run`] : []), baselineLine(known.filter((f) => f.platforms.includes(p))), ...driftOut].filter(Boolean);
  const xml = [
    `  <testsuite name="${xmlText(p)}" tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}">`,
    '    <properties>',
    ...props.map(([k, v]) => `      <property name="${xmlText(k)}" value="${xmlText(v)}"/>`),
    '    </properties>',
    ...cases.map((c) => c.xml),
    ...(tally.length ? [`    <system-out>${tally.map(xmlText).join('\n')}</system-out>`] : []),
    '  </testsuite>',
  ].join('\n');
  return { xml, tests, failures, errors, skipped };
}

/** `known` (with --baseline): the baseline's findings, which `r.findings` (the new ones) leaves out; never failures.
 *  `drift`: the tool-definition changes, listed in each suite's <system-out> (never a failure either).
 *  A legacy `##[` workflow command (found anywhere in a stdout line) is written `#&#35;[`: the same text to an XML parser. */
export function renderJunit(r: Report, known: Finding[] = [], drift?: Drift): string {
  const suites = r.summary.gate.platforms.map((p) => suite(r, p, known, drift));
  const sum = (k: 'tests' | 'failures' | 'errors' | 'skipped') => suites.reduce((a, s) => a + s[k], 0);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="mcp-review-check" tests="${sum('tests')}" failures="${sum('failures')}" errors="${sum('errors')}" skipped="${sum('skipped')}" time="${(Math.round(r.durationMs) / 1000).toFixed(3)}">`,
    ...suites.map((s) => s.xml),
    '</testsuites>',
    '',
  ].join('\n').replace(/##\[/g, '#&#35;[');
}
