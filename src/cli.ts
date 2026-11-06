#!/usr/bin/env node
// CLI entry: argument parsing, validation, orchestration, exit codes, --list-rules and explain.
import { accessSync, constants, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
// Light modules only (no transport, rules or renderers): --help and --version need nothing more, and the catalog
// commands (--list-rules, explain) load the rules alone. A check loads the rest in loadCheckModules.
import { cmdQuote, splitStdioArgv, tokenizeCommand } from './protocol/stdioArgs.js';
import { applyDrift, buildReport, neutralizeCommands, ReportTooLargeError, resultLine, scoreLabel, visibleText, type Report } from './report/index.js';
import { ctaLine } from './report/constants.js';
import { renderJson } from './report/json.js';
import { ConfigError, findConfig, loadConfig, type LoadedConfig } from './config.js';
import { annotations, appendStepSummary, escapeCommand } from './report/github.js';
import type { FailOn } from './report/score.js';
import { CATALOG_DATE, staleCatalogWarning } from './catalog.js';
import { displayUrl, isKnownToken, REDACTED_MARK } from './rules/util/net.js';
import { emptySnapshot, type Snapshot, type TargetOpt } from './snapshot.js';
import { toolName } from './rules/util/access.js';
import { VERSION } from './version.js';
import { attachListing, listingDump, loadOpenAiManifest, loadPluginDir, mergeListings } from './listing/index.js';
import { PACKAGE_CONFIG_FILES } from './listing/load.js';
import { compareTools, driftCount, driftItems, incompleteTools, pinFingerprints, type Drift } from './report/drift.js';
import { decodeText, INPUT_FILE_CAP, inputFileProblem, readInputFile } from './input-file.js';
import type { BuildOptions, TargetSpec } from './connect.js';
import type { Redactor } from './redact.js';
import type { TextOptions } from './report/text.js';
import type { Baseline } from './baseline.js';
import type { Finding } from './rules/types.js';

/** The modules a check needs besides the light ones: the transport (the MCP SDK, undici), the rules (ajv), the
 *  renderers and the baseline. Loaded once, on the first check, so --help and --version start without them. */
async function loadCheckModules() {
  const [proxy, connect, diagnose, redact, markdown, sarif, junit, text, rules, active, auth, baseline] = await Promise.all([
    import('./proxy.js'), import('./connect.js'), import('./diagnose.js'), import('./redact.js'), import('./report/markdown.js'),
    import('./report/sarif.js'), import('./report/junit.js'), import('./report/text.js'), import('./rules/index.js'),
    import('./probe/active.js'), import('./probe/auth.js'), import('./baseline.js'),
  ]);
  return { proxy, connect, diagnose, redact, markdown, sarif, junit, text, rules, active, auth, baseline };
}

let M: Awaited<ReturnType<typeof loadCheckModules>> | undefined;

/** Set by the entry point: the first check installs the proxy (HTTPS_PROXY, HTTP_PROXY, NO_PROXY, ALL_PROXY) before
 *  anything connects. --help, --version, --list-rules and explain never get there, so a bad proxy variable does not
 *  block them and they load no undici. runCli called in-process (tests) leaves the global dispatcher alone. */
let proxyOnCheck = false;

/** The check modules, loaded on the first call. */
async function checkModules(): Promise<NonNullable<typeof M>> {
  M ??= await loadCheckModules();
  return M;
}

const HELP = `mcp-review-check ${VERSION} (rules ${CATALOG_DATE})
Lint an MCP server against the Claude connector directory, ChatGPT plugin directory and MCP spec.

Usage:
  mcp-review-check <url> [options]
  mcp-review-check --stdio "<command> [args...]" [options]
  mcp-review-check [options] --stdio -- <command> [args...]
  mcp-review-check explain <RULE-ID>

Options:
  --stdio "<command>"     Start a local stdio server instead of <url> (or --stdio -- <command> [args...], verbatim).
  --header "K: V"         Extra request header (repeatable). Values are redacted in output.
  --bearer <token>        Bearer token (default: $MCP_REVIEW_CHECK_TOKEN).
  --target <t>            claude | chatgpt | all (default: all)
  --format <f>            text | json | markdown | sarif | junit (default: text)
  --output <file>         Write the report to a file; print a summary line to stderr.
  --json-output <file>    Also write the JSON report (as --format json prints it) to a file, whatever --format.
  --save-baseline <file>  The same, under the baseline name: write it now, pass it to --baseline on later runs.
  --sarif-location <path> Repository-relative path the SARIF results point at (default: .mcp-review-check).
  --timeout <ms>          Per-request timeout (default: 30000; HTTP connect uses min(timeout, 15000)).
  --max-duration <ms>     Stop the whole check (rules included) after this long, report what ran, exit 4.
  --fail-on <level>       error | warning | never (default: error). Counts findings for the --target directories only.
  --fail-on-spec          Also fail on MCP spec findings (spec-only findings do not fail the run by default).
  --fail-on-incomplete    Exit 3 when the check is partial (auth required, token rejected, tools/list failed).
  --baseline <file>       A JSON report of an earlier run: only new findings count; tool definitions are compared
                          with its fingerprints ("Changed tool definitions").
  --fail-on-drift         With --baseline: exit 1 when a tool was added, removed or changed, or the tools could not
                          be compared (a warning says why). Needs a <url> or --stdio target.
  --diff-only             With --baseline, text and markdown: only the new findings and the tool changes.
  --plugin-dir <dir>      Also lint a Claude plugin folder (LST rules). Alone (no <url> or --stdio): a listing-only run.
  --openai-manifest <file>
                          Also lint a ChatGPT plugin package manifest (LST rules). Alone: a listing-only run.
  --local                 Local mode: deploy-time checks (HTTPS, public DNS, tunnel domains) are informational.
  --no-local              Strict deploy-time checks, also for loopback, private and dotless hosts and --stdio.
  --active                Call read-only tools (readOnlyHint: true) to run RT checks.
  --active-auth           Probe DCR, /authorize and /token. CREATES A DCR CLIENT on your authorization server.
  --tool-args <file>      JSON {toolName: args} for --active calls.
  --env K=V               Environment variable for --stdio (repeatable). Values are redacted in output.
  --cwd <dir>             Working directory for --stdio.
  --ignore <RULE-ID>      Ignore a rule (repeatable or comma-separated); an ID that is not a rule or MAN item is a usage error.
  --list-rules [prefix]   Print the rule catalog (--format text, json or markdown; IDs starting with prefix) and exit.
  --no-color              Disable colors (also off when not a TTY or NO_COLOR is set; FORCE_COLOR=1 forces them on).
  --verbose               Expand collapsed findings and rationales; print the redacted HTTP trace and stdio stderr.
  --quiet                 Text only: print just error and warning findings, the Score and Result lines and the disclaimer.
  --checklist             Text only: print the manual checklist in full (default: one line with the item count).
  --config <file>         Read options from a JSON file (keys: long option names in camelCase, such as failOn).
  --no-config             Do not read mcp-review-check.config.json or .mcp-review-check.json from --cwd or the working
                          directory. A found file only sets options (no server, outputs, cwd, env or credentials).
  --no-<switch>           Turn off a config file's switch: fail-on-spec, fail-on-incomplete, fail-on-drift, diff-only,
                          active, active-auth, verbose, quiet, checklist.
  --color                 Turn off the config file's noColor (colours then follow the TTY, NO_COLOR and FORCE_COLOR).
  -h, --help              Show this help.
  -v, --version           Show the version.

Examples:
  mcp-review-check https://mcp.example.com/mcp --target claude --format markdown --output report.md
  mcp-review-check --env API_BASE=http://localhost:4000 --stdio -- node dist/server.js
  mcp-review-check explain TOOL-011
  mcp-review-check --list-rules TOOL --format json

--stdio "<command>" is split on whitespace; quote arguments with spaces. A backslash is literal (Windows paths work),
also inside double quotes, except before a ": \\\\" is one \\ and ends the quote, \\" a literal ".
A --config file may name the server ({"url": "https://…"} or {"stdio": "node", "args": ["dist/server.js"]}); its paths
are relative to the file, and the command line wins over its keys (each key not used is named on stderr).
Secrets are redacted in every format: --bearer, --header and --env values, URL credentials, and stdio arguments
after secret-looking flags (--api-key X, --token=X, API_KEY=X, "Authorization: Bearer X").

Exit codes:
  0       Completed, below the --fail-on threshold.
  1       Completed, threshold reached for a --target directory (or for the spec with --fail-on-spec), or
          with --fail-on-drift a tool definition changed since --baseline.
  2       Usage or configuration error (also in the config file), or --output, --json-output or --save-baseline
          could not be written (checked before connecting).
  3       Could not connect or complete a handshake (also when --max-duration ran out before it); with
          --fail-on-incomplete, a partial check (auth required, token rejected, tools/list failed); or an internal
          error of mcp-review-check itself (fatal: and a stack trace on stderr; please report it).
  4       Stopped by --max-duration after the handshake, at any --fail-on (the Result line reads INCOMPLETE).
  128+N   Ended by signal N: 130 Ctrl+C (SIGINT), 143 SIGTERM, 131 SIGQUIT, 129 SIGHUP; no report is written.

Spec findings count only with --fail-on-spec. The score (100 - 12 per rule with errors - 4 per rule with only
warnings) is provisional. With GITHUB_ACTIONS=true, findings are also ::error/::warning annotations on stderr and the
markdown report is appended to $GITHUB_STEP_SUMMARY. Proxies: HTTPS_PROXY, HTTP_PROXY, NO_PROXY, ALL_PROXY.
Guide: https://github.com/alisaosipova/mcp-review-check/tree/main/docs/guide
No telemetry is sent. Passing these checks does not guarantee directory approval.
`;

class UsageError extends Error {}

const OPTIONS = {
  stdio: { type: 'string' }, header: { type: 'string', multiple: true }, bearer: { type: 'string' },
  // No parseArgs defaults: an option left out may come from the config file; the defaults are applied after it.
  target: { type: 'string' }, format: { type: 'string' }, output: { type: 'string' }, 'sarif-location': { type: 'string' },
  timeout: { type: 'string' }, 'max-duration': { type: 'string' }, 'fail-on': { type: 'string' }, 'fail-on-spec': { type: 'boolean' },
  'fail-on-incomplete': { type: 'boolean' }, 'fail-on-drift': { type: 'boolean' }, 'diff-only': { type: 'boolean' }, baseline: { type: 'string' }, 'save-baseline': { type: 'string' }, 'json-output': { type: 'string' },
  config: { type: 'string' }, 'no-config': { type: 'boolean' },
  active: { type: 'boolean' }, 'active-auth': { type: 'boolean' }, 'tool-args': { type: 'string' },
  'plugin-dir': { type: 'string' }, 'openai-manifest': { type: 'string' },
  env: { type: 'string', multiple: true }, cwd: { type: 'string' }, ignore: { type: 'string', multiple: true },
  'list-rules': { type: 'boolean' }, 'no-color': { type: 'boolean' }, verbose: { type: 'boolean' },
  quiet: { type: 'boolean' }, checklist: { type: 'boolean' }, local: { type: 'boolean' }, 'no-local': { type: 'boolean' },
  // The opposite of each boolean config key, so a command line can turn off what a config file turns on (A01-03).
  'no-fail-on-spec': { type: 'boolean' }, 'no-fail-on-incomplete': { type: 'boolean' }, 'no-fail-on-drift': { type: 'boolean' },
  'no-diff-only': { type: 'boolean' }, 'no-active': { type: 'boolean' }, 'no-active-auth': { type: 'boolean' },
  'no-verbose': { type: 'boolean' }, 'no-quiet': { type: 'boolean' }, 'no-checklist': { type: 'boolean' }, color: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
} as const;

/**
 * Pairs of opposite switches: [option, opposite]. Given on the command line, either one replaces the config file's key
 * for both (A01-03). Each opposite but --no-local (strict deploy-time checks) only turns its option off.
 */
export const OPPOSITES: ReadonlyArray<readonly [string, string]> = [
  ['local', 'no-local'], ['no-color', 'color'], ['fail-on-spec', 'no-fail-on-spec'], ['fail-on-incomplete', 'no-fail-on-incomplete'],
  ['fail-on-drift', 'no-fail-on-drift'], ['diff-only', 'no-diff-only'], ['active', 'no-active'], ['active-auth', 'no-active-auth'],
  ['verbose', 'no-verbose'], ['quiet', 'no-quiet'], ['checklist', 'no-checklist'],
];

/**
 * One warning per switch on the command line that the chosen --format does not use, so the user does not think it took
 * effect: --quiet and --checklist (text only), --diff-only (text and markdown; also the GitHub job summary). A key from
 * the config file gets none: one file serves runs in several formats.
 */
export function formatWarnings(format: string, given: Set<string>, values: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  const summary = env.GITHUB_ACTIONS === 'true' && !!env.GITHUB_STEP_SUMMARY; // the job summary is a markdown report
  const ignoredBy: Array<[string, boolean, string]> = [
    ['quiet', format !== 'text', 'text'],
    ['checklist', format !== 'text', 'text'],
    ['diff-only', format !== 'text' && format !== 'markdown' && !summary, 'text and markdown'],
  ];
  return ignoredBy.filter(([opt, ignored]) => ignored && given.has(opt) && values[opt])
    .map(([opt, , formats]) => `warning: --${opt} applies only to --format ${formats}; --format ${format} does not use it\n`).join('');
}

/** The config keys of one transport, which a server named on the command line for the other one does not use (A01-03). */
const STDIO_ONLY = ['env', 'cwd'] as const;
const HTTP_ONLY = ['header', 'bearer', 'active-auth'] as const;

const isAuthorization = (h: string) => h.slice(0, Math.max(0, h.indexOf(':'))).trim().toLowerCase() === 'authorization';

/** The candidate nearest to `name` (Levenshtein distance at most 2, never `name` itself), for "did you mean". */
function closest(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const option of candidates) {
    if (option === name) continue;
    let prev = Array.from({ length: option.length + 1 }, (_, j) => j);
    for (let i = 1; i <= name.length; i++) {
      const cur = [i];
      for (let j = 1; j <= option.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (name[i - 1] === option[j - 1] ? 0 : 1));
      prev = cur;
    }
    if (prev[option.length] < bestDistance) [best, bestDistance] = [option, prev[option.length]];
  }
  return best;
}

const OPTION_NAMES = Object.keys(OPTIONS).map((k) => `--${k}`);

/** The known option nearest to an unknown one, for "did you mean". */
const closestOption = (name: string) => closest(name, OPTION_NAMES);

/** The usage error for a value outside an enumeration (--format, --target, --fail-on), with "did you mean" for a
 *  near miss (I-A10-3). Only a known value is ever shown, never the value given. */
function enumMessage(option: string, given: string, allowed: readonly string[], list: string): string {
  const near = closest(given.toLowerCase(), allowed);
  return `--${option} must be ${list}${near ? `; did you mean ${near}?` : ''}`;
}

/** One line for a parseArgs error: the option and what it needs, never its value or Node's multi-line advice. */
function usageMessage(e: Error & { code?: string }): string {
  const option = /'(?:-\w, )?(-[^'=\s,]*)/.exec(e.message)?.[1];
  if (option && e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    // An option and its value in one argv word ("--stdio node x.mjs" from a script or an exec-form CMD): the first
    // word is a known option, so say how to split it (C-05). The rest of the word is not shown.
    const raw = /'(?:-\w, )?(-[^']*)'/.exec(e.message)?.[1] ?? option;
    const known = Object.hasOwn(OPTIONS, option.replace(/^--/, '')) ? OPTIONS[option.replace(/^--/, '') as keyof typeof OPTIONS] : undefined;
    if (/\s/.test(raw) && known) {
      return known.type === 'string'
        ? `${option} and its value were passed as one argument; pass two arguments or write ${option}=<value>`
        : `${option} and the text after it were passed as one argument; pass each option as its own argument`;
    }
    const near = closestOption(option);
    return `unknown option ${option}${near ? `; did you mean ${near}?` : ''}`;
  }
  if (option && e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    if (/ambiguous/.test(e.message)) return `${option} needs a value; write ${option}=<value> for a value that starts with "-"`;
    return /does not take an argument/.test(e.message) ? `${option} takes no value` : `${option} needs a value`;
  }
  return e.message.split('\n')[0];
}

/** The least time the rules get under --max-duration, also when the deadline passed before they started (A09-04). */
export const RULES_GRACE_MS = 1000;

/** The phase name of a --max-duration stop during rule evaluation (limits.stopped.phase, the Result line). */
export const RULES_PHASE = 'rules';

/**
 * A --max-duration stop during the rules (A09-04), on a snapshot the deadline had not stopped already: limits.stopped
 * names the "rules" phase, so the run is INCOMPLETE and exits 4, as for a stop during the connect phases. A snapshot
 * stopped before keeps its stop (the phase the deadline cut short); its rules not run are skipped all the same.
 */
export function markRulesStopped(snap: Snapshot, maxDurationMs: number, ran: readonly string[] = []): void {
  if (snap.limits?.stopped) return;
  // The phases the connect side really went through (BuildResult.completed); a listing-only run has none.
  const completed = snap.target.kind === 'listing' ? [] : [...ran];
  snap.limits = { ...snap.limits, truncated: [...(snap.limits?.truncated ?? [])], stopped: { maxDurationMs, phase: RULES_PHASE, completed, unfinished: [RULES_PHASE] } };
  if (snap.coverage.toolLevel === 'ok') snap.coverage = { toolLevel: 'stopped', reason: `stopped by --max-duration (${maxDurationMs} ms) during ${RULES_PHASE}` };
}

/** Largest --timeout: 2^31-1 ms (the setTimeout limit) minus the 1000 ms margin used in withTimeout. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1 - 1000;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Usage errors never echo option values: they may be credentials.
function parseHeader(raw: string): [string, string] {
  const i = raw.indexOf(':');
  if (i <= 0) throw new UsageError('--header must look like "Name: value" (no ":" found; the value is not shown)');
  const k = raw.slice(0, i).trim();
  const v = raw.slice(i + 1).trim();
  if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) throw new UsageError('--header values must not contain CR or LF');
  // An RFC 9110 token, or fetch rejects the name on every request and the run looks like a connect failure (exit 3).
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k)) throw new UsageError('--header name must be an HTTP token: letters, digits and !#$%&\'*+.^_`|~- (the value is not shown)');
  return [k, v];
}

/** --diff-only: text and markdown leave out the known-findings line and the manual checklist. */
type RenderOptions = TextOptions & { diffOnly?: boolean };

/** `known` (with --baseline): the findings of the baseline report, which `r.findings` (the new ones) leaves out;
 *  `opts.drift`: the comparison of the tool definitions with the baseline's. */
function render(r: Report, format: string, opts: RenderOptions, rerun: string, sarifLocation: string, known?: Finding[]): string {
  const { addBaselineToText, renderJsonWithBaseline, renderSarifWithBaseline } = M!.baseline;
  const { renderSarif } = M!.sarif;
  const { renderJunit } = M!.junit;
  const { renderText } = M!.text;
  switch (format) {
    case 'json': return known ? renderJsonWithBaseline(r, known, opts.drift) : renderJson(r);
    case 'markdown': return markdownReport(r, { cta: opts.cta, verbose: opts.verbose, rerun, drift: opts.drift, failOnDrift: opts.failOnDrift }, known, opts.diffOnly); // --quiet and --checklist are text only
    case 'sarif': return known ? renderSarifWithBaseline(r, known, sarifLocation, opts.drift) : renderSarif(r, sarifLocation);
    case 'junit': return renderJunit(r, known, opts.drift);
    default: {
      if (opts.diffOnly) return renderText({ ...r, manual: [] }, opts);
      return known ? addBaselineToText(renderText(r, opts), known, opts.quiet) : renderText(r, opts);
    }
  }
}

/** The markdown report (also the job summary), with the known findings of --baseline as one line (not with --diff-only). */
function markdownReport(r: Report, opts: Parameters<NonNullable<typeof M>['markdown']['renderMarkdown']>[1], known?: Finding[], diffOnly = false): string {
  const { renderMarkdown } = M!.markdown;
  const { addBaselineToMarkdown } = M!.baseline;
  if (diffOnly) return renderMarkdown({ ...r, manual: [] }, opts);
  const md = renderMarkdown(r, opts);
  return known ? addBaselineToMarkdown(md, known) : md;
}

/** The command line that reproduces the report, secrets redacted; the text-only --quiet and --checklist are left out.
 *  --bearer, --header and --env values masked by position at any length, the URL through displayUrl, then scrub. */
function rerunCommand(argv: string[], redactor: Redactor): string {
  const end = argv.includes('--') ? argv.indexOf('--') : argv.length;
  // Header and variable names stay ("X-Api-Key:«redacted»", "API_KEY=«redacted»"); a --bearer value goes whole.
  const masked = (opt: string, v: string) => (opt === '--bearer' ? '' : v.slice(0, v.indexOf(opt === '--header' ? ':' : '=') + 1)) + REDACTED_MARK;
  const args = argv.map((a, i) => {
    if (i >= end) return a;
    const eq = /^(--(?:bearer|header|env))=(.*)$/s.exec(a);
    if (eq) return `${eq[1]}=${masked(eq[1], eq[2])}`;
    if (i > 0 && ['--bearer', '--header', '--env'].includes(argv[i - 1])) return masked(argv[i - 1], a);
    return /^https?:\/\//i.test(a) ? displayUrl(a) : a;
  }).filter((a, i) => i >= end || (a !== '--quiet' && a !== '--checklist')).map((a) => M!.redact.scrub(a, redactor));
  // cmd.exe takes no single quotes: on Windows an argument is double-quoted by the Windows argv rule, for cmd.exe.
  const quote = process.platform === 'win32' ? cmdQuote : (a: string) => `'${a.replace(/'/g, "'\\''")}'`;
  return ['npx mcp-review-check', ...args.map((a) => (/^[\w@%+=:,./«»-]+$/.test(a) ? a : quote(a)))].join(' ');
}

/** --tool-args as Windows editors save it, too: UTF-8 with or without a BOM, or UTF-16LE or UTF-16BE with its BOM. */
function readToolArgs(file: string): Record<string, unknown> {
  const raw = readInputFile(file); // regular file, non-blocking open, 16 MiB cap: a FIFO cannot hang the run
  return JSON.parse(decodeText(raw));
}

/** One warning line per --tool-args entry that no --active call used, with the reason, so typos and non-read-only tools show. */
function unusedToolArgs(toolArgs: Record<string, unknown>, snap: Snapshot): string {
  const used = new Set(snap.active?.calls.filter((c) => c.kind === 'valid').map((c) => c.tool));
  return Object.keys(toolArgs).filter((name) => !used.has(name)).map((name) => {
    const tool = snap.tools.find((t) => toolName(t) === name);
    // The real reason (A03-04): annotations, the write-verb name filter, a duplicate name, the cap or a stop.
    const why = !tool ? 'the server lists no tool by that name'
      : M!.active.activeSkipReason(tool, snap.tools, snap.limits, { modern: snap.era === 'modern' }) ?? 'the call was not made';
    return `warning: --tool-args entry ${JSON.stringify(name)} was not used: ${why}\n`;
  }).join('');
}

/** A usage error about a value from the config file names the file and the key ('--fail-on must be … (from
 *  mcp-review-check.config.json: key "failOn")'); the value itself is never shown, as for the flags. */
function configNote(message: string, cfg: LoadedConfig | undefined, fromConfig: Record<string, string>): string {
  if (!cfg) return message;
  const opts = [...message.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
  if (/\bURL\b|<url>/.test(message)) opts.push('url');
  if (/\bstdio\b/.test(message)) opts.push('stdio');
  const keys = [...new Set(opts.filter((o) => Object.hasOwn(fromConfig, o)).map((o) => fromConfig[o]))];
  return keys.length ? `${message} (from ${cfg.file}: ${keys.map((k) => `key "${k}"`).join(', ')})` : message;
}

/** A URL for a usage error: everything up to the last "@" after the scheme (a password may hold "/", "?" or "#"), query and fragment hidden. */
function shownUrl(raw: string): string {
  return raw.replace(/\/\/.*@/s, '//…@').replace(/[?#].*$/s, (q) => (q.length > 1 ? `${q[0]}…` : q));
}

/** The usage error for a <url> that does not parse. An argument without "://" is not shown: it is most often a value
 *  that lost its option (--header "X-Api-Key:" "$KEY" makes the key the <url>). A shown one has token-like pieces cut. */
function invalidUrlMessage(raw: string): string {
  if (!raw.includes('://')) return 'invalid URL (the value is not shown; is a value missing its option?)';
  return `invalid URL: ${visibleText(tokenCut(shownUrl(raw)))}`;
}

/** Token-like pieces (a known token shape, or 16+ characters with letters and digits between / : @ ? # .) as "…". */
function tokenCut(s: string): string {
  return s.replace(/[^\s/:@?#.]{16,}/g, (p) => (isKnownToken(p) || (/[a-z]/i.test(p) && /\d/.test(p)) ? '…' : p));
}

/** The usage error for a <url> without a scheme. A host-shaped argument may be a value that lost its option (a JWT,
 *  a key with a dot or a ":<port>" ending): with a token-like piece, the suggestion is not shown (A01-09). */
function schemeMessage(hint: string): string {
  const shown = shownUrl(hint);
  if (tokenCut(shown) !== shown) return 'the URL needs a scheme (http:// or https://); the value is not shown, as it looks like a token: is a value missing its option?';
  return `the URL needs a scheme: did you mean ${visibleText(shown)}?`;
}

/** Whether two paths name one file: the same device and inode when both exist (a symlink or hard link), otherwise
 *  the real path of the parent directory and the base name, case-folded where file systems usually fold case. */
function samePath(a: string, b: string): boolean {
  const sa = statSync(a, { throwIfNoEntry: false });
  const sb = statSync(b, { throwIfNoEntry: false });
  if (sa && sb) return sa.dev === sb.dev && sa.ino === sb.ino && (sa.ino !== 0 || canonical(a) === canonical(b));
  return canonical(a) === canonical(b);
}

function canonical(p: string): string {
  let abs = resolve(p);
  // A symlink whose target does not exist yet (a first --save-baseline) is followed by hand: the write goes to the
  // target, so --output link.txt and --save-baseline target.json are one file (A01-06). 40 hops, as Linux allows.
  for (let hops = 0; hops < 40; hops++) {
    let st;
    try { st = lstatSync(abs); } catch { break; }
    if (!st.isSymbolicLink()) break;
    try { abs = resolve(realpathSync(dirname(abs)), readlinkSync(abs)); } catch { break; }
  }
  let dir = dirname(abs);
  try { dir = realpathSync(dir); } catch { /* a missing directory: the write fails later with its own message */ }
  const full = join(dir, basename(abs));
  return process.platform === 'win32' || process.platform === 'darwin' ? full.toLowerCase() : full;
}

/** The files a run reads that an output must not overwrite (I-A01-3): the config file, --tool-args, the
 *  --openai-manifest file and the MCP configuration beside it, and the files read from --plugin-dir. */
function inputPaths(values: { 'tool-args'?: string; 'openai-manifest'?: string; 'plugin-dir'?: string }, cfg: LoadedConfig | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (cfg) out.push([cfg.given ? '--config' : 'the config file', cfg.file]);
  if (values['tool-args']) out.push(['--tool-args', values['tool-args']]);
  const manifest = values['openai-manifest'];
  if (manifest) {
    out.push(['--openai-manifest', manifest]);
    const d = dirname(manifest);
    const root = ['.codex-plugin', '.agent-plugin', '.claude-plugin'].includes(basename(d)) ? dirname(d) : d;
    for (const c of ['mcp.json', '.mcp.json']) out.push(['--openai-manifest', join(root, c)]);
  }
  const dir = values['plugin-dir'];
  if (dir) {
    out.push(['--plugin-dir', join(dir, '.claude-plugin', 'plugin.json')], ['--plugin-dir', join(dir, '.mcp.json')]);
    // README, LICENSE and package-manager files at the folder root, as the listing loader reads them.
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { /* checked later as a usage error */ }
    for (const n of names) if (/^readme(\.[a-z0-9]+)?$/i.test(n) || /^(licen[cs]e|copying)([.-][a-z0-9.-]+)?$/i.test(n) || PACKAGE_CONFIG_FILES.has(n)) out.push(['--plugin-dir', join(dir, n)]);
  }
  return out;
}

/** Why `path` cannot be written, or undefined: it is a directory, or the nearest existing directory above it is not
 *  a writable directory (a missing parent is created at write time). Checked before connecting (I-A10-1). */
function unwritable(path: string): string | undefined {
  const abs = resolve(path);
  let self;
  try { self = statSync(abs, { throwIfNoEntry: false }); } catch { /* ENOTDIR: found below */ }
  if (self?.isDirectory()) return 'it is a directory';
  // An existing file (or /dev/stdout, /dev/null) is written in place: its own permission counts, not its directory's.
  if (self) { try { accessSync(abs, constants.W_OK); return undefined; } catch { return 'it is not writable'; } }
  let dir = dirname(abs);
  for (;;) {
    let st;
    try { st = statSync(dir, { throwIfNoEntry: false }); } catch { st = undefined; }
    if (st) {
      if (!st.isDirectory()) return 'a part of its directory path is a file';
      try { accessSync(dir, constants.W_OK); } catch { return 'its directory is not writable'; }
      return undefined;
    }
    const up = dirname(dir);
    if (up === dir) return 'its directory does not exist';
    dir = up;
  }
}

/** All of stderr but our annotations, line by line through ciSafeLine, and no legacy "##[" anywhere in a line: a
 *  warning that quotes a path or server text cannot start a workflow command or move the cursor (I-A07-1). */
function guardStderr(text: string): string {
  if (!text) return text;
  const lines = text.split('\n');
  return lines.map((l, i) => (i === lines.length - 1 && l === '' ? l : neutralizeCommands(ciSafeLine(l)))).join('\n');
}

/** A line of server text for stderr that a GitHub runner cannot read as a workflow command ("::error ...",
 *  "::add-mask::", "##[group]"): the leading ':' or '#' shown as \u{3A} or \u{23}, as the text report does (F135);
 *  control and format characters (ESC, CR, bidi overrides) as \u{..} through visibleText. */
export function ciSafeLine(line: string): string {
  return visibleText(line).replace(/^(\s*):(?=:)/, '$1\\u{3A}').replace(/^(\s*)#(?=#\[)/, '$1\\u{23}');
}

/** The status line while a check connects and probes: `phase()` names the phase, `clear()` takes the line off before
 *  other stderr output, `stop()` ends it. A no-op when not enabled. */
export interface PhaseLine { phase(name: string): void; clear(): void; stop(): void }

/**
 * A one-line status on a terminal's stderr while the check connects and probes ("mcp-review-check: listing… 3 s"),
 * redrawn every second and cleared before anything else is printed. It names a phase, never the server or a value.
 * Enabled only for a TTY stderr outside CI (CI, GITHUB_ACTIONS) and without --quiet: see runCli.
 */
export function phaseLine(enabled: boolean, write: (s: string) => void, now: () => number = () => performance.now()): PhaseLine {
  if (!enabled) return { phase() {}, clear() {}, stop() {} };
  const t0 = now();
  let name = 'connecting';
  let done = false;
  const draw = () => { if (!done) write(`\r\x1b[2Kmcp-review-check: ${visibleText(name)}… ${Math.floor((now() - t0) / 1000)} s`); };
  const timer = setInterval(draw, 1000);
  timer.unref();
  draw();
  return {
    phase(p) { name = p; draw(); },
    clear() { if (!done) write('\r\x1b[2K'); },
    stop() { if (done) return; clearInterval(timer); write('\r\x1b[2K'); done = true; },
  };
}

/** Whether runCli shows the phase line: stderr is a terminal and the run is not in CI. */
export const phaseLineWanted = (stderrTty: boolean, env: NodeJS.ProcessEnv) => stderrTty && !env.CI && env.GITHUB_ACTIONS !== 'true';

/**
 * `interrupted` is aborted by SIGINT/SIGTERM (its reason the signal number): a run that still finishes in the grace
 * period writes no report, since the checks after the signal ran against servers being killed.
 */
export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, isTty = !!process.stdout.isTTY, interrupted?: AbortSignal, stderrTty = false): Promise<CliResult> {
  let stderr = '';
  /** Our own GitHub annotations: appended after the guarded stderr, as the only workflow commands we mean. */
  let ann = '';
  /** The result, every stderr line but the annotations made safe for a terminal and a CI log (I-A07-1). */
  const done = (code: number, stdout: string, more = ''): CliResult => ({ code, stdout, stderr: guardStderr(stderr + more) + ann });
  let redactor: Redactor | undefined;
  let cfg: LoadedConfig | undefined;
  const fromConfig: Record<string, string> = {}; // option name (or url, stdio) → the config key it came from
  try {
    const split = splitStdioArgv(argv);
    const parsed = parseArgs({
      args: split.args, allowPositionals: true, strict: true, options: OPTIONS,
    });
    const values = { ...parsed.values };
    /** The options given on the command line (not from the config file). */
    const cliGiven = new Set(Object.keys(parsed.values).filter((k) => (parsed.values as Record<string, unknown>)[k] !== undefined));
    let positionals = parsed.positionals;
    // Keywords in any case, as --ignore and explain take IDs in any case: --format JSON, --target Claude, --fail-on Warning.
    let format = (values.format ?? 'text').toLowerCase();
    if (values.help) return { code: 0, stdout: HELP, stderr };
    if (values.version) return { code: 0, stdout: `${VERSION}\n`, stderr };
    if (values['list-rules']) {
      const { MANUAL_ITEMS, RULES } = await import('./rules/index.js');
      const { listRulesJson, listRulesText, rulesMarkdown } = await import('./explain.js');
      if (positionals.length > 1) throw new UsageError('--list-rules takes at most one rule ID prefix');
      // Only an ID-like prefix filters; anything else (a URL with a token, a path) lists the whole catalog, as the baseline did, unrepeated.
      const prefix = /^[A-Z]+(-\d*)?$/i.test(positionals[0] ?? '') ? positionals[0].toUpperCase() : '';
      const rules = RULES.filter((r) => r.id.startsWith(prefix));
      const manual = MANUAL_ITEMS.filter((m) => m.id.startsWith(prefix));
      if (!rules.length && !manual.length) throw new UsageError(`no rule or MAN ID starts with ${prefix}`);
      if (!['text', 'json', 'markdown', 'sarif', 'junit'].includes(format)) throw new UsageError('--list-rules --format must be text, json or markdown');
      // SARIF and JUnit have no catalog form; print the text catalog with a warning and exit 0, as the 0.1.0 baseline did.
      if (format === 'sarif' || format === 'junit') stderr += `warning: --format ${format} does not apply to --list-rules; printing text\n`;
      const list = format === 'json' ? listRulesJson(rules, manual) : format === 'markdown' ? `${rulesMarkdown(rules, manual)}\n` : listRulesText(rules, manual, !!values.verbose);
      return { code: 0, stdout: list, stderr };
    }
    if (positionals[0] === 'explain') {
      if (positionals.length !== 2) throw new UsageError('usage: mcp-review-check explain <RULE-ID>');
      const text = (await import('./explain.js')).explainRule(positionals[1]);
      if (!text) throw new UsageError(`unknown rule ID ${/^[a-z]+-\d+$/i.test(positionals[1]) ? positionals[1] : '(value not shown)'}; --list-rules prints the catalog`);
      return { code: 0, stdout: text, stderr };
    }

    const m = await checkModules();
    if (proxyOnCheck) {
      proxyOnCheck = false;
      try { m.proxy.installProxy(); } catch (e) {
        if (!(e instanceof m.proxy.ProxyConfigError)) throw e;
        return done(2, '', `error: ${e.message}\nRun with --help for usage.\n`);
      }
    }
    const { buildSnapshot, redactorFor } = m.connect;
    const { schemeSuggestion } = m.diagnose;
    const { redactDeep, scrub } = m.redact;
    const { SARIF_LOCATION } = m.sarif;
    const { localBanner } = m.text;
    const { manualChecklist, MANUAL_ITEMS, RULES, runRules } = m.rules;
    const { dcrClientNotice } = m.auth;
    const { BaselineError, knownFindings, readBaseline } = m.baseline;
    // A "--" that splitStdioArgv did not take (--stdio has a value, or no bare --stdio before it) left the command in positionals.
    if ((split.command || split.args.includes('--')) && values.stdio !== undefined) throw new UsageError('give --stdio either "<command>" or -- <command> [args...], not both');
    if (!split.command && split.args.includes('--')) throw new UsageError('"-- <command> [args...]" needs a bare --stdio before the --');
    let command = split.command;

    // The config file applies to a check (not to --help, --version, --list-rules or explain). A flag given on the
    // command line wins over the file's key; the server comes from the file only when the command line names none.
    if (values.config !== undefined && values['no-config']) throw new UsageError('give either --config or --no-config, not both');
    if (values.config === '') throw new UsageError('--config needs a file path');
    const cfgFile = values.config ?? (values['no-config'] ? undefined : findConfig(values.cwd ?? process.cwd()));
    if (cfgFile !== undefined) {
      try { cfg = loadConfig(cfgFile, values.config !== undefined); } catch (e) {
        if (e instanceof ConfigError) throw new UsageError(e.message);
        throw e;
      }
      stderr += cfg.warnings.join('');
      const merged = values as Record<string, unknown>;
      // A switch on the command line also replaces the file's key for its opposite (--local over noLocal, --no-quiet
      // over quiet): only two values from one source conflict (A01-03).
      const opposite = new Map(OPPOSITES.flatMap(([a, b]) => [[a, b], [b, a]] as const));
      for (const [opt, v] of Object.entries(cfg.options)) {
        if (merged[opt] !== undefined) continue;
        const other = opposite.get(opt);
        if (other !== undefined && cliGiven.has(other)) continue;
        merged[opt] = v;
        fromConfig[opt] = cfg.keys[opt];
      }
      const unused: string[] = [];
      const drop = (opt: string, why: string) => {
        if (!Object.hasOwn(fromConfig, opt)) return;
        unused.push(`key "${fromConfig[opt]}" (${why})`);
        delete merged[opt];
        delete fromConfig[opt];
      };
      // --bearer on the command line replaces the file's Authorization header, and an Authorization --header the
      // file's bearer, rather than failing as "both given".
      if (cliGiven.has('bearer') && fromConfig.header) {
        const kept = values.header!.filter((h) => !isAuthorization(h));
        if (kept.length < values.header!.length) {
          unused.push(`the Authorization entry of key "${fromConfig.header}" (--bearer given)`);
          if (kept.length) values.header = kept;
          else drop('header', '--bearer given');
        }
      }
      if (cliGiven.has('header') && values.header!.some(isAuthorization)) drop('bearer', 'an Authorization --header given');
      const serverOnCli = positionals.length > 0 || values.stdio !== undefined || !!command;
      // Only an explicit --config names the server (loadConfig drops it from a discovered file, with a warning).
      if (!serverOnCli) {
        if (cfg.url !== undefined) { positionals = [cfg.url]; fromConfig.url = 'url'; }
        if (cfg.stdio !== undefined) { values.stdio = cfg.stdio; fromConfig.stdio = 'stdio'; }
        if (cfg.command) { command = cfg.command; fromConfig.stdio = 'stdio'; }
      } else {
        // A <url> on the command line replaces a file written for a stdio server: its stdio-only keys are not used.
        if (positionals.length) for (const opt of STDIO_ONLY) drop(opt, 'the <url> on the command line is not a --stdio server');
        else for (const opt of HTTP_ONLY) drop(opt, 'the --stdio server on the command line is not a <url>');
        // The file's server is replaced by the command line's: said in the note, not silently (I-A01-2).
        if (cfg.url !== undefined) unused.push('key "url" (a server is given on the command line)');
        if (cfg.stdio !== undefined || cfg.command) unused.push('key "stdio" (a server is given on the command line)');
      }
      // A listing-only run lists no tools, so a shared file's failOnDrift would fail it every time (A01-04).
      const fileListingOnly = positionals.length === 0 && values.stdio === undefined && !command && (values['plugin-dir'] !== undefined || values['openai-manifest'] !== undefined);
      if (fileListingOnly) drop('fail-on-drift', 'a listing-only run lists no tools');
      if (unused.length) stderr += `${visibleText(`mcp-review-check: not used from ${cfg.file}: ${unused.join(', ')}`)}\n`;
      // One line names the file applied, and the key the server came from, so a file's effect is never silent.
      const server = fromConfig.url ? ' (the server from its key "url")' : fromConfig.stdio ? ' (the server from its key "stdio")' : '';
      stderr += `${visibleText(`mcp-review-check: options from ${cfg.given ? '--config' : 'config file'} ${cfg.file}${server}`)}\n`;
    }
    // Two opposite switches on the command line; or from the file, where --no-local and --local are both settings.
    for (const [a, b] of OPPOSITES) {
      const v = values as Record<string, unknown>;
      if (v[a] && v[b]) throw new UsageError(`give either --${a} or --${b}, not both`);
    }
    // Each opposite but --no-local only turns its option off.
    for (const [a, b] of OPPOSITES) {
      if (a === 'local') continue;
      const v = values as Record<string, unknown>;
      if (v[b]) delete v[a];
    }
    format = (values.format ?? 'text').toLowerCase();
    values.target ??= 'all';
    values.timeout ??= '30000';
    values['fail-on'] ??= 'error';

    if (positionals.length > 1) throw new UsageError('expected a single <url>');
    const isStdio = values.stdio !== undefined || command !== undefined;
    // --plugin-dir / --openai-manifest alone: a listing-only run that checks the files and connects to nothing.
    const listingOnly = positionals.length === 0 && !isStdio && (values['plugin-dir'] !== undefined || values['openai-manifest'] !== undefined);
    if (!listingOnly && (positionals.length === 1) === isStdio) throw new UsageError('give exactly one of <url> or --stdio "<command>" (or only --plugin-dir / --openai-manifest for a listing-only run)');
    if (listingOnly) {
      for (const [opt, on] of [['--bearer', values.bearer !== undefined], ['--header', !!values.header?.length], ['--env', !!values.env?.length], ['--cwd', values.cwd !== undefined], ['--active', !!values.active], ['--active-auth', !!values['active-auth']], ['--tool-args', !!values['tool-args']]] as const) {
        if (on) throw new UsageError(`${opt} needs a <url> or --stdio target; a listing-only run connects to nothing`);
      }
      // From the command line only: the config file's failOnDrift was dropped above with a note (A01-04).
      if (values['fail-on-drift']) throw new UsageError('--fail-on-drift needs a <url> or --stdio target; a listing-only run lists no tools');
    }
    const target = values.target!.toLowerCase() as TargetOpt;
    if (!['claude', 'chatgpt', 'all'].includes(target)) throw new UsageError(enumMessage('target', target, ['claude', 'chatgpt', 'all'], 'claude, chatgpt or all'));
    if (!['text', 'json', 'markdown', 'sarif', 'junit'].includes(format)) throw new UsageError(enumMessage('format', format, ['text', 'json', 'markdown', 'sarif', 'junit'], 'text, json, markdown, sarif or junit'));
    const sarifLocation = values['sarif-location'] ?? SARIF_LOCATION;
    // Code scanning takes repository-relative paths only: no scheme (C: included), no leading / or \, no "..".
    if (!sarifLocation || /^([a-z][a-z0-9+.-]*:|[\\/])/i.test(sarifLocation) || sarifLocation.split(/[\\/]/).includes('..')) throw new UsageError('--sarif-location must be a relative path without a scheme or ".." (the value is not shown)');
    const failOn = values['fail-on']!.toLowerCase() as FailOn;
    if (!['error', 'warning', 'never'].includes(failOn)) throw new UsageError(enumMessage('fail-on', failOn, ['error', 'warning', 'never'], 'error, warning or never'));
    // Digits only: Number() would also take 0x10, 1e2, 1.5 and blanks.
    const timeoutMs = /^\d+$/.test(values.timeout!) ? Number(values.timeout) : NaN;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UsageError('--timeout must be a positive whole number of milliseconds');
    // Node clamps larger setTimeout delays to 1 ms; withTimeout adds a 1000 ms margin on top.
    if (timeoutMs > MAX_TIMEOUT_MS) throw new UsageError(`--timeout must be at most ${MAX_TIMEOUT_MS} ms`);
    let maxDurationMs: number | undefined;
    if (values['max-duration'] !== undefined) {
      maxDurationMs = /^\d+$/.test(values['max-duration']) ? Number(values['max-duration']) : NaN;
      if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > MAX_TIMEOUT_MS) throw new UsageError(`--max-duration must be a positive whole number of milliseconds (at most ${MAX_TIMEOUT_MS})`);
    }

    if (values.output === '') throw new UsageError('--output needs a file path');
    // --save-baseline and --json-output: the JSON report, besides the primary output (the GitHub Action reads it).
    const jsonOutputs = (['save-baseline', 'json-output'] as const).flatMap((opt) => {
      const path = values[opt];
      if (path === undefined) return [];
      if (path === '') throw new UsageError(`--${opt} needs a file path`);
      if (values.output !== undefined && format !== 'json' && samePath(path, values.output)) throw new UsageError(`--${opt} and --output name the same file; --output gets the --format ${format} report`);
      return [[`--${opt}`, path] as const];
    });
    // --output in another format over the --baseline file would leave a text (or markdown, SARIF, JUnit) report that the
    // next --baseline run rejects; --save-baseline or --output in --format json over it is the intended refresh, which a
    // run that exits 3 or 4 does not make (see `unsaved` below, A01-02).
    if (values.output !== undefined && values.baseline && format !== 'json' && samePath(values.baseline, values.output)) throw new UsageError(`--baseline and --output name the same file; --output would replace the baseline with the --format ${format} report (use --save-baseline to refresh it)`);
    // Every file this run writes: none may be a file it reads (I-A01-3), and each must be writable before anything
    // connects (I-A10-1), so a slow check does not end in exit 2 over a typo in a path.
    const outputs: Array<readonly [string, string]> = [...(values.output !== undefined ? [['--output', values.output] as const] : []), ...jsonOutputs];
    for (const [flag, path] of outputs) {
      for (const [input, inPath] of inputPaths(values, cfg)) {
        if (samePath(path, inPath)) throw new UsageError(`${flag} and ${input} name the same file; ${flag} would overwrite an input of this run`);
      }
      const why = unwritable(path);
      if (why) throw new UsageError(`cannot write ${flag} ${visibleText(path)}: ${why} (checked before connecting; no report was written)`);
    }
    const known = new Set([...RULES, ...MANUAL_ITEMS].map((x) => x.id));
    // "--ignore A,B" as many linters take it, besides --ignore A --ignore B.
    const ignore = (values.ignore ?? []).flatMap((v) => v.split(',')).map((v) => v.trim());
    const unknownId = ignore.find((id) => !known.has(id.toUpperCase()));
    if (unknownId !== undefined) throw new UsageError(`--ignore ${/^[a-z]+-\d+$/i.test(unknownId) ? unknownId : 'value'} is not a rule or MAN ID; --list-rules prints the catalog`);
    const headers: Record<string, string> = {};
    for (const h of values.header ?? []) {
      const [k, v] = parseHeader(h);
      // fetch joins names that differ only in case into one "A, B" value: a name is given once.
      if (Object.keys(headers).some((n) => n.toLowerCase() === k.toLowerCase())) throw new UsageError(`--header ${k} is given more than once; give each header once`);
      headers[k] = v;
    }
    const authHeader = Object.keys(headers).some((n) => n.toLowerCase() === 'authorization');
    if (authHeader && values.bearer !== undefined) throw new UsageError('give the token either with --bearer or with --header "Authorization: …", not both');
    // Bearer and headers go only to a <url>; an --header Authorization wins over $MCP_REVIEW_CHECK_TOKEN, as an explicit option.
    const bearer = isStdio || authHeader ? values.bearer : values.bearer ?? env.MCP_REVIEW_CHECK_TOKEN ?? undefined;
    if (bearer !== undefined && /[\r\n]/.test(bearer)) throw new UsageError('--bearer must not contain CR or LF');

    let spec: TargetSpec = { kind: 'http', url: 'http://listing.invalid/' }; // placeholder: a listing-only run never connects
    const typedEnv: Record<string, string> = {}; // --env names as typed: they decide a value's redaction tier
    if (listingOnly) {
      // nothing to resolve
    } else if (isStdio) {
      let parts: string[];
      if (command) parts = command;
      else try { parts = tokenizeCommand(values.stdio!); } catch (e) { throw new UsageError(`--stdio: ${(e as Error).message}`); }
      if (!parts.length) throw new UsageError('--stdio needs a command');
      // Nothing is sent to a stdio server: a token or header would only mark the run as authenticated (RT-009 off).
      if (values.bearer !== undefined || values.header?.length) throw new UsageError('--bearer and --header apply only to <url>');
      if (values['active-auth']) throw new UsageError('--active-auth applies only to <url>: a stdio server has no authorization server to probe');
      const envVars: Record<string, string> = {};
      for (const kv of values.env ?? []) {
        const i = kv.indexOf('=');
        if (i <= 0) throw new UsageError('--env must look like K=V (no "=" found; the value is not shown)');
        typedEnv[kv.slice(0, i)] = kv.slice(i + 1);
        // Windows names are case-insensitive: --env Path=… replaces the inherited PATH instead of losing to it.
        envVars[process.platform === 'win32' ? kv.slice(0, i).toUpperCase() : kv.slice(0, i)] = kv.slice(i + 1);
      }
      // spawn reports a missing cwd as "spawn <command> ENOENT", like a missing command: check it here.
      if (values.cwd !== undefined && !statSync(values.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new UsageError('--cwd must be an existing directory (the value is not shown)');
      spec = { kind: 'stdio', command: parts[0], args: parts.slice(1), env: envVars, cwd: values.cwd };
    } else {
      const raw = positionals[0];
      const hint = schemeSuggestion(raw);
      // "host:3000/mcp" parses as scheme "host:", so a missing scheme is checked before the protocol.
      if (hint) throw new UsageError(schemeMessage(hint));
      let u: URL;
      try { u = new URL(raw); } catch { throw new UsageError(invalidUrlMessage(raw)); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UsageError('URL must use http or https');
      if (values.env?.length || values.cwd !== undefined) throw new UsageError('--env and --cwd apply only to --stdio');
      spec = { kind: 'http', url: raw };
    }

    // An empty value is most often an unset variable ("$TOKEN", "$ARGS_FILE"): said, so the run is not mistaken for one with it.
    if (values.bearer === '' && spec.kind === 'http') stderr += 'warning: --bearer is empty, so no token is sent (not $MCP_REVIEW_CHECK_TOKEN either); is the variable you passed unset?\n';
    if (values['tool-args'] === '') stderr += 'warning: --tool-args is empty, so no file is read; is the variable you passed unset?\n';
    let toolArgs: Record<string, unknown> | undefined;
    if (values['tool-args']) {
      try { toolArgs = readToolArgs(values['tool-args']); } catch (e) {
        // A JSON syntax error message quotes the file (which may hold credentials): name the problem only.
        throw new UsageError(`cannot read --tool-args: ${e instanceof SyntaxError ? 'not valid JSON' : inputFileProblem(e)}`);
      }
      if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) throw new UsageError('--tool-args must contain a JSON object {toolName: args}');
    }
    // Listing inputs are read after the connect, but checked here: a missing path or the wrong kind is exit 2, before
    // anything connects. The messages name the flag and never the path's content.
    for (const [opt, kind] of [['plugin-dir', 'directory'], ['openai-manifest', 'file']] as const) {
      const path = values[opt];
      if (path === undefined) continue;
      if (path === '') throw new UsageError(`--${opt} needs a ${kind} path`);
      const st = statSync(path, { throwIfNoEntry: false });
      if (!st) throw new UsageError(`--${opt}: no such ${kind} (the path is not shown)`);
      if (kind === 'directory' ? !st.isDirectory() : !st.isFile()) throw new UsageError(`--${opt} must be a ${kind}, not ${st.isDirectory() ? 'a directory' : st.isFile() ? 'a file' : 'a pipe, device or other special file'}`);
    }
    // Read before connecting: a wrong --baseline is a usage error (exit 2), not a finished run that gated on everything.
    let baseline: Baseline | undefined;
    for (const opt of ['fail-on-drift', 'diff-only'] as const) {
      if (values[opt] && values.baseline === undefined) throw new UsageError(`--${opt} needs --baseline <file>`);
    }
    if (values.baseline !== undefined) {
      if (!values.baseline) throw new UsageError('--baseline needs a file path');
      try { baseline = readBaseline(values.baseline); } catch (e) {
        if (e instanceof BaselineError) throw new UsageError(e.message);
        throw e;
      }
    }
    if (values['active-auth']) stderr += 'Notice: --active-auth creates a DCR client on your authorization server and sends bogus /authorize and /token requests.\n';
    // Accepted for scripts that share one option set, but said: the user should not think they took effect.
    // Only for an option typed on the command line: one config file serves runs in several formats and modes (A12-08).
    if (toolArgs && !values.active && cliGiven.has('tool-args')) stderr += 'warning: --tool-args has no effect without --active\n';
    if (cliGiven.has('sarif-location') && format !== 'sarif') stderr += 'warning: --sarif-location applies only to --format sarif\n';
    stderr += formatWarnings(format, cliGiven, values as Record<string, unknown>, env);

    const opts: BuildOptions = {
      target: spec, headers, bearer, timeoutMs, platforms: target, maxDurationMs,
      active: !!values.active, activeAuth: !!values['active-auth'], toolArgs,
      local: values.local ? true : values['no-local'] ? false : undefined,
    };
    // Every value for the report and each output; before the rules only the strong ones (not --env FORMAT=text).
    // Tiers go by the --env names as typed, not as upper-cased for the server on win32 (signingKey is secret, SIGNINGKEY not).
    const typed: BuildOptions = spec.kind === 'stdio' ? { ...opts, target: { ...spec, env: typedEnv } } : opts;
    redactor = redactorFor(typed, true);
    opts.redactor = redactorFor(typed);
    const started = new Date();
    stderr += staleCatalogWarning(started) ?? '';
    const t0 = performance.now();
    // A server that answered initialize and then stopped: said at once, not with the report at the end (A10-02). The
    // message holds no server text.
    // On a terminal (not in CI, not with --quiet): one status line with the phase while it connects and probes.
    const status = phaseLine(!listingOnly && !values.quiet && phaseLineWanted(stderrTty, env), (x) => { process.stderr.write(x); });
    opts.onStall = (m) => { status.clear(); process.stderr.write(`mcp-review-check: ${m}\n`); };
    // connect.ts reports each phase it moves on to (its checkpoints).
    opts.onPhase = (p) => status.phase(p);
    // Rules quote server text in cut snippets ("…") that a whole-value scrub of the report cannot recognise, so
    // buildSnapshot scrubs the strong values from what the server sent (before the input caps) and the rules see none.
    let built0: Awaited<ReturnType<typeof buildSnapshot>> | undefined;
    try {
      built0 = listingOnly ? undefined : await buildSnapshot(opts);
    } finally {
      status.stop();
    }
    const { snap, stderrTail, tracer } = built0
      ?? { snap: emptySnapshot({ kind: 'listing' }, { target, active: false, activeAuth: false }), stderrTail: undefined, tracer: undefined };
    if (interrupted?.aborted) {
      const n = typeof interrupted.reason === 'number' ? interrupted.reason : 2;
      return done(128 + n, '', 'mcp-review-check: interrupted by a signal; no report written\n');
    }
    if (toolArgs && snap.active) stderr += unusedToolArgs(toolArgs, snap);
    // --active-auth: the DCR client it registered, so it can be deleted (A03-03). Only client_id and the endpoint, redacted.
    if (values['active-auth']) stderr += dcrClientNotice(snap.authProbe, redactor) ?? '';
    // The listing inputs go on the snapshot before the rules, which skip LST-* without them. Problems reading a file
    // are warnings (relative paths and codes only, never contents).
    if (values['plugin-dir'] !== undefined || values['openai-manifest'] !== undefined) {
      const listing = mergeListings(
        values['plugin-dir'] !== undefined ? loadPluginDir(values['plugin-dir']) : undefined,
        values['openai-manifest'] !== undefined ? loadOpenAiManifest(values['openai-manifest']) : undefined,
      );
      attachListing(snap, listing);
      // The path comes from file content (a manifest's mcpServers, a file name): one line, no workflow command (A07-01).
      for (const e of listing.errors) stderr += `${ciSafeLine(`warning: ${e.source === 'plugin' ? '--plugin-dir' : '--openai-manifest'} ${scrub(e.path, redactor)} ${scrub(e.message, redactor)}`)}\n`;
    }
    // --max-duration bounds the rules too (A09-04): the ones not started by the deadline are skipped and the run is
    // stopped during "rules" (exit 4). They get at least RULES_GRACE_MS, so a run whose connect phases used up the time
    // (or whose deadline fell while connections closed) still reports what it observed.
    const deadline = maxDurationMs === undefined ? undefined : Math.max(t0 + maxDurationMs, performance.now() + RULES_GRACE_MS);
    const result = runRules(snap, RULES, { ignore, deadline });
    if (result.stopped && maxDurationMs !== undefined) markRulesStopped(snap, maxDurationMs, built0?.completed);
    // --baseline: the known findings leave the report (the gate, the verdicts and the counts see only new ones) and are
    // added back by each format. They are compared redacted, as the baseline report was written; the score keeps every finding.
    let gated = result;
    let knownRaw: Finding[] | undefined;
    if (baseline) {
      // Also tried as the rules wrote them, so a non-secret --env value added since the baseline does not make a finding new.
      const isKnown = knownFindings(redactDeep(result.findings, redactor), baseline.findings, result.findings);
      knownRaw = result.findings.filter((_, i) => isKnown[i]);
      gated = { ...result, findings: result.findings.filter((_, i) => !isKnown[i]), scored: result.scored ?? result.findings };
    }
    // No manual checklist when nothing connected: the connect failure is the only thing to act on.
    const ignoredIds = new Set(ignore.map((id) => id.toUpperCase())); // --ignore MAN-xxx hides the item
    const built = buildReport(snap, gated, snap.fatal ? [] : manualChecklist(snap).filter((m) => !ignoredIds.has(m.id)), failOn, started, performance.now() - t0, !!values['fail-on-spec'], !!values['fail-on-incomplete'], { baselined: knownRaw?.length });
    // The one place secrets leave the report: every string of the finished report is scrubbed before any format renders it.
    const report = redactDeep(built, redactor);
    // --fail-on-incomplete: exit 3 on a partial check; buildReport marks the report failed for every format (A10-01).
    const partial = snap.coverage.toolLevel !== 'ok';
    const baselined = knownRaw && redactDeep(knownRaw, redactor);
    // Tool fingerprints (the JSON report's and the drift's) over the snapshot the rules saw: secrets scrubbed, but not
    // the run's other --env values, so the digests do not depend on the command line (A01-05). Names stay redacted.
    pinFingerprints(report.snap, snap);
    const drift: Drift | undefined = baseline && compareTools(baseline.tools, report.snap, baseline.listingOnly);
    const changes = driftCount(drift);
    // --fail-on-drift fails the report as it fails the exit code below (A01-01): FAIL in every format, same exit code.
    applyDrift(report, { failOn: !!values['fail-on-drift'], changes, notCompared: drift?.notCompared, tools: drift ? driftItems(drift).map((i) => i.name) : [] });

    // FORCE_COLOR as in Node: '', 1, 2, 3 or true colour without a TTY and over NO_COLOR; other values turn colour off.
    const tty = env.FORCE_COLOR !== undefined ? /^(|[123]|true)$/.test(env.FORCE_COLOR) : isTty && !env.NO_COLOR;
    const color = tty && !values['no-color'] && format === 'text' && !values.output;
    const banner = localBanner(report);
    if (banner && (format === 'json' || format === 'sarif' || format === 'junit')) stderr += `${banner}\n`; // stdout stays the document
    const textOpts: RenderOptions = {
      color, verbose: !!values.verbose, cta: ctaLine(report, env), quiet: !!values.quiet, checklist: !!values.checklist,
      drift, failOnDrift: !!values['fail-on-drift'] && changes > 0, diffOnly: !!values['diff-only'],
    };
    const rerun = rerunCommand(argv, redactor);
    const body = render(report, format, textOpts, rerun, sarifLocation, baselined);
    if (env.GITHUB_ACTIONS === 'true') { // annotations go to stderr, so stdout stays the document
      // Appended after every other line, outside the stderr guard: they are the only workflow commands we mean (I-A07-1).
      for (const a of annotations(report)) ann += `${a}\n`;
      // An output that names the job summary file writes it itself; appending as well would give the report twice.
      const summaryOut = env.GITHUB_STEP_SUMMARY ? outputs.find(([, path]) => samePath(path, env.GITHUB_STEP_SUMMARY!)) : undefined;
      if (summaryOut) stderr += `mcp-review-check: the report is not appended to $GITHUB_STEP_SUMMARY, as ${summaryOut[0]} writes that file\n`;
      else if (env.GITHUB_STEP_SUMMARY) stderr += appendStepSummary(env.GITHUB_STEP_SUMMARY, markdownReport(report, { cta: textOpts.cta, verbose: textOpts.verbose, rerun, drift, failOnDrift: textOpts.failOnDrift }, baselined, textOpts.diffOnly));
    }
    if (values.verbose) {
      if (snap.listing) stderr += `[listing]\n${listingDump(snap.listing, ciSafeLine)}\n`;
      if (!listingOnly && spec.kind === 'http') {
        const route = M!.proxy.proxyRouteLine(new URL(spec.url), env);
        if (route) stderr += ciSafeLine(route) + '\n';
      }
      // Server-controlled text (a URL, an error message, the stderr tail) shows control and format characters as
      // \u{..}, so an ESC sequence, a CR or a bidi override cannot rewrite the terminal or a CI log (F135), and no
      // line of it starts a GitHub workflow command (A07-04).
      for (const e of tracer?.exchanges ?? []) stderr += ciSafeLine(`[http] ${e.label}: ${e.method} ${e.url} -> ${e.status ?? e.error?.message} (${Math.round(e.durationMs)} ms${e.bodyMs !== undefined && e.bodyMs - e.durationMs > 1000 ? `, body ${Math.round(e.bodyMs)} ms` : ''})`) + '\n';
      if (stderrTail) stderr += `[stdio stderr]\n${stderrTail.split(/\r?\n/).map(ciSafeLine).join('\n')}\n`;
      stderr = scrub(stderr, redactor);
    }
    // A stop after the handshake is exit 4 at any --fail-on, so CI can tell "too slow" (4) from "unreachable" (3).
    // A partial check (no or a rejected token, tools/list failed, an exhausted snapshot byte budget) follows --fail-on unless --fail-on-incomplete.
    // --fail-on-drift: a tool change is exit 1 like a finding over --fail-on; drift alone never changes the code.
    // A comparison that could not be made (a baseline without fingerprints, a partial tools/list) must not pass a
    // --fail-on-drift gate silently: exit 1 with a warning, unless 3 or 4 already says more.
    const notCompared = values['fail-on-drift'] ? drift?.notCompared : undefined;
    // The advice depends on the side: a baseline without fingerprints is re-saved; a partial run must be fixed first, as
    // saving it would record no fingerprints either (A01-07).
    const advice = drift?.notComparedBy === 'run' ? 'fix this run (see the coverage line) before saving a baseline from it' : 're-save the baseline with --save-baseline';
    if (notCompared) stderr += `--fail-on-drift: tool definitions not compared (${notCompared.replace(/;? ?write it again with --save-baseline$/, '')}); ${advice}\n`;
    const code = snap.fatal ? 3 : snap.limits?.stopped ? 4 : values['fail-on-incomplete'] && partial ? 3 : report.summary.failed || textOpts.failOnDrift || notCompared ? 1 : 0;
    const s = report.summary;
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const fromBaseline = baselined ? ` · ${baselined.length} known from baseline${changes ? ` · ${plural(changes, 'tool change')}${textOpts.failOnDrift ? ' (--fail-on-drift)' : ''}` : ''}` : '';
    const summaryLine = `mcp-review-check: score ${scoreLabel(report)} · ${plural(s.errors, 'error')} · ${plural(s.warnings, 'warning')} · ${s.info} info${fromBaseline} · ${resultLine(report)}`;
    // The JSON report for --save-baseline and --json-output: the --format json document, baselined marks included,
    // rendered from the same redacted report. A file that cannot be written is exit 2, as for --output.
    const jsonDoc = !jsonOutputs.length ? '' : format === 'json' ? body : render(report, 'json', textOpts, rerun, sarifLocation, baselined);
    const written: string[] = [];
    let writeErrors = '';
    // No baseline is written by a run that did not connect (exit 3), was stopped (exit 4) or, with --fail-on-incomplete,
    // was partial (exit 3): it would replace an accepted baseline with a report that has no tool fingerprints (A01-02,
    // A01-03). That holds for every output naming the --baseline or --save-baseline file (--output in --format json,
    // --json-output), so the earlier baseline really is kept; --json-output to another file is still written.
    const unsaved = snap.fatal ? 'the run did not connect' : snap.limits?.stopped ? 'the run was stopped by --max-duration'
      : values['fail-on-incomplete'] && partial ? `the check is partial (${snap.coverage.toolLevel}) and --fail-on-incomplete is set` : undefined;
    const saveTo = jsonOutputs.find(([flag]) => flag === '--save-baseline')?.[1];
    const baselineFiles = [values.baseline, saveTo].filter((x): x is string => !!x);
    const keeps = (flag: string, path: string) => !!unsaved && (flag === '--save-baseline' || baselineFiles.some((b) => samePath(path, b)));
    for (const [flag, path] of outputs) {
      if (keeps(flag, path)) stderr += `warning: ${flag} not written: ${unsaved}; ${flag === '--save-baseline' ? 'the earlier baseline' : 'it names the baseline file, and the earlier baseline'}, if any, is kept${flag === '--output' ? ' (the report is printed to stdout instead)' : ''}\n`;
    }
    if (saveTo && !unsaved) {
      const noTools = incompleteTools(report.snap);
      if (noTools) stderr += `warning: --save-baseline: ${noTools}, so the baseline records no tool fingerprints and --fail-on-drift cannot compare tools against it\n`;
      // --baseline reads at most INPUT_FILE_CAP: a larger baseline would be exit 2 on every later run (A01-08).
      const bytes = Buffer.byteLength(jsonDoc);
      if (bytes > INPUT_FILE_CAP) stderr += `warning: --save-baseline: the report is ${(bytes / 1024 / 1024).toFixed(1)} MiB, over the ${INPUT_FILE_CAP / 1024 / 1024} MiB that --baseline reads, so a later --baseline run cannot use it\n`;
    }
    // A missing parent directory is created, as the documented first --save-baseline .mcp-review-check/baseline.json
    // needs in a fresh repository (A12-04); its writability was checked before connecting.
    const write = (path: string, text: string) => {
      mkdirSync(dirname(resolve(path)), { recursive: true });
      writeFileSync(path, text);
    };
    for (const [flag, path] of jsonOutputs) {
      if (keeps(flag, path)) continue;
      try {
        write(path, jsonDoc);
        if (!written.includes(path)) written.push(path);
      } catch (e) {
        writeErrors += `error: cannot write ${flag} ${path}: ${(e as Error).message}\n`;
      }
    }
    const jsonNote = written.length ? `JSON report written to ${written.join(', ')}` : '';
    const finalCode = writeErrors ? 2 : code;
    if (values.output && !keeps('--output', values.output)) {
      try {
        write(values.output, body);
      } catch (e) {
        // The server was checked: print the report instead of losing it, and report the write failure as exit 2.
        return done(2, body, `${writeErrors}error: cannot write --output ${values.output}: ${(e as Error).message} (the report is printed to stdout instead)\n`);
      }
      return done(finalCode, '', writeErrors + summaryLine + ` · report written to ${values.output}${jsonNote ? ` · ${jsonNote}` : ''}\n`);
    }
    return done(finalCode, body, writeErrors + (jsonNote ? `mcp-review-check: ${jsonNote}\n` : ''));
  } catch (e) {
    if (e instanceof UsageError || (e as { code?: string }).code?.startsWith?.('ERR_PARSE_ARGS')) {
      // parseArgs names an option without its "=value"; the rest of its message is not repeated.
      const message = configNote(e instanceof UsageError ? e.message : usageMessage(e as Error & { code?: string }), cfg, fromConfig);
      return done(2, '', `error: ${message}\nRun with --help for usage.\n`);
    }
    if (e instanceof ReportTooLargeError) {
      // Not an internal bug: the server was checked but its report does not fit one string. A message with a hint, no stack.
      const message = redactor && M ? M.redact.scrub(e.message, redactor) : e.message;
      if (env.GITHUB_ACTIONS === 'true') ann += `::error title=mcp-review-check::${escapeCommand(message)}\n`;
      return done(3, '', `error: ${message}\n`);
    }
    // In GitHub Actions this exit 3 also gets one ::error, with the first line of the redacted error.
    const first = env.GITHUB_ACTIONS === 'true' ? `fatal: ${(e as Error)?.message ?? e}` : '';
    // An error message can carry server text: control and format characters show as \u{..}, and no line of the stack
    // starts a workflow command (A07-04).
    const scrubbed = (x: string) => (redactor && M ? M.redact.scrub(x, redactor) : x);
    if (first) ann += `::error title=mcp-review-check::${escapeCommand(visibleText(scrubbed(first).split('\n')[0]))}\n`;
    const raw = `fatal: ${(e as Error).stack ?? e}`;
    const fatal = scrubbed(raw).split('\n').map(ciSafeLine).join('\n');
    stderr = scrubbed(stderr);
    return done(3, '', `${fatal}\n`);
  }
}

// `node dist/cli` runs dist/cli.js (Node adds the extension) with argv[1] still "dist/cli", which has no real path:
// try the typed path, then with ".js", so the CLI does not exit 0 without running.
const isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  for (const path of [arg, `${arg}.js`]) {
    try { return realpathSync(path) === fileURLToPath(import.meta.url); } catch { /* no such file: try the next form */ }
  }
  return false;
})();

if (isMain) {
  proxyOnCheck = true;
  // The stdio servers lead their own process group, so a terminal's Ctrl+C or Ctrl+\ reaches only the CLI: end
  // them, then die by the same signal (130, 131, 143), also when the run finishes first and exits; on Windows, where
  // a process cannot die by a signal, exit 128 + its number. A second signal SIGKILLs every server at once.
  const signals = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15 };
  let signalled = false;
  const interrupted = new AbortController();
  for (const [signal, n] of Object.entries(signals)) {
    process.on(signal, () => {
      if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K'); // the phase line, if one is shown
      // No check modules loaded yet (a signal during --help): no server was started.
      void (M ? M.connect.endAllNow(signalled) : Promise.resolve()).finally(() => process.exit());
      if (signalled) return;
      signalled = true;
      interrupted.abort(n);
      process.once('exit', () => {
        if (process.platform === 'win32') { process.exitCode = 128 + n; return; }
        for (const s of Object.keys(signals)) process.removeAllListeners(s);
        process.kill(process.pid, signal);
      });
    });
  }
  runCli(process.argv.slice(2), process.env, !!process.stdout.isTTY, interrupted.signal, !!process.stderr.isTTY).then(({ code, stdout, stderr }) => {
    // Both streams may be async pipes: exit only after each one is flushed, or stderr is cut at 64 KB.
    process.stderr.write(stderr, () => process.stdout.write(stdout, () => process.exit(code)));
  });
}
