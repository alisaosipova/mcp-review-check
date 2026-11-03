// Config file: --config <file>, or mcp-review-check.config.json / .mcp-review-check.json in --cwd or the working
// directory. A JSON object whose keys are the long option names in camelCase (failOn for --fail-on); the CLI turns
// each value into the string or list the flag would give, so the file goes through the same validation as the flags,
// and a flag on the command line overrides the file's key. Errors name the file and the key, never a value.
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** The files looked for, in this order, when --config is not given (and --no-config is not). */
export const CONFIG_FILES = ['mcp-review-check.config.json', '.mcp-review-check.json'] as const;

/** A usage error (exit 2) about the config file. Names the file and the key, never quotes a value. */
export class ConfigError extends Error {}

type Kind = 'string' | 'number' | 'boolean' | 'list' | 'pairs';

/** Config key → value kind. `number` takes a JSON number or a string, as --timeout "30000" would. */
const KEYS: Record<string, Kind> = {
  target: 'string', format: 'string', output: 'string', sarifLocation: 'string', timeout: 'number', maxDuration: 'number',
  failOn: 'string', failOnSpec: 'boolean', failOnIncomplete: 'boolean', baseline: 'string', saveBaseline: 'string', jsonOutput: 'string',
  local: 'boolean', noLocal: 'boolean', active: 'boolean', activeAuth: 'boolean', toolArgs: 'string',
  header: 'pairs', bearer: 'string', env: 'pairs', cwd: 'string', ignore: 'list',
  noColor: 'boolean', verbose: 'boolean', quiet: 'boolean', checklist: 'boolean',
  failOnDrift: 'boolean', diffOnly: 'boolean', pluginDir: 'string', openaiManifest: 'string',
};

/** Keys holding a file or directory path: relative to the config file's directory, not to the working directory. */
const PATH_KEYS = new Set(['output', 'baseline', 'saveBaseline', 'jsonOutput', 'toolArgs', 'cwd', 'pluginDir', 'openaiManifest']);

/** The keys besides the options: the server to check. */
const TARGET_KEYS = new Set(['url', 'stdio', 'args']);

export interface LoadedConfig {
  /** The file as found or given. */
  file: string;
  /** Long option name (fail-on) → the value as parseArgs would give it: a string, true, or a list of strings. */
  options: Record<string, string | true | string[]>;
  /** Long option name → the config key it came from, for error messages. */
  keys: Record<string, string>;
  /** The server: `url`, `stdio` as a --stdio "<command>" string, or `stdio` + `args` (or a `stdio` array) verbatim. */
  url?: string;
  stdio?: string;
  command?: string[];
  /** Warnings for stderr (secrets in the file). */
  warnings: string[];
}

/** failOn → fail-on. */
export const optionName = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** fail-on → failOn. */
export const configKey = (option: string) => option.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** A key from the file for an error message: quoted, cut, control characters shown as \u{..}. */
function shownKey(key: string): string {
  const cut = key.length > 40 ? `${key.slice(0, 40)}…` : key;
  return JSON.stringify(cut).replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (ch) => `\\u{${ch.codePointAt(0)!.toString(16).toUpperCase()}}`);
}

/** The first config file that exists in `dir`, or undefined. */
export function findConfig(dir: string): string | undefined {
  for (const name of CONFIG_FILES) {
    const p = join(dir, name);
    if (statSync(p, { throwIfNoEntry: false })) return p;
  }
  return undefined;
}

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isStrMap = (v: unknown): v is Record<string, string> => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');

/**
 * Reads and checks a config file (UTF-8 with or without a BOM, or UTF-16LE with its BOM, as Windows editors save it).
 * `given` is true for --config: the CLI names the option in the messages.
 */
export function loadConfig(file: string, given: boolean): LoadedConfig {
  const where = given ? `--config ${file}` : `config file ${file}`;
  let raw: Buffer;
  try { raw = readFileSync(file); } catch (e) {
    const code = (e as { code?: string }).code;
    throw new ConfigError(`cannot read ${where}: ${code === 'ENOENT' ? 'no such file' : code === 'EISDIR' ? 'it is a directory' : (code ?? 'read failed')}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse((raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8')).replace(/^\uFEFF/, ''));
  } catch {
    // A JSON syntax error message quotes the file (which may hold a token): name the problem only.
    throw new ConfigError(`${where} is not valid JSON`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new ConfigError(`${where} must contain a JSON object of options, such as {"failOn": "warning"}`);
  const base = dirname(resolve(file));
  const out: LoadedConfig = { file, options: {}, keys: {}, warnings: [] };
  const wrong = (key: string, what: string) => new ConfigError(`${where}: key ${shownKey(key)} must be ${what} (the value is not shown)`);
  const d = doc as Record<string, unknown>;

  for (const [key, value] of Object.entries(d)) {
    if (TARGET_KEYS.has(key)) continue;
    const kind = Object.hasOwn(KEYS, key) ? KEYS[key] : undefined;
    if (!kind) {
      const near = configKey(key) !== key && Object.hasOwn(KEYS, configKey(key)) ? `; did you mean "${configKey(key)}"?` : '';
      throw new ConfigError(`${where}: unknown key ${shownKey(key)}${near || ' (keys are the long option names in camelCase, such as failOn, and url or stdio for the server)'}`);
    }
    const opt = optionName(key);
    let v: string | true | string[] | undefined;
    if (kind === 'string') {
      if (typeof value !== 'string') throw wrong(key, 'a string');
      v = PATH_KEYS.has(key) && value !== '' && !isAbsolute(value) ? resolve(base, value) : value;
    } else if (kind === 'number') {
      if (typeof value === 'number') v = String(value);
      else if (typeof value === 'string') v = value;
      else throw wrong(key, 'a number');
    } else if (kind === 'boolean') {
      if (typeof value !== 'boolean') throw wrong(key, 'true or false');
      v = value || undefined; // false is the same as leaving the key out
    } else if (kind === 'list') {
      if (typeof value === 'string') v = [value];
      else if (isStrList(value)) v = value;
      else throw wrong(key, 'a string or an array of strings');
    } else {
      // header: ["Name: value"] or {"Name": "value"}; env: ["K=V"] or {"K": "V"}.
      const sep = key === 'header' ? ': ' : '=';
      if (isStrList(value)) v = value;
      else if (isStrMap(value)) {
        for (const name of Object.keys(value)) if (!name || name.includes(sep.trim())) throw new ConfigError(`${where}: key ${shownKey(key)} has a name that is empty or contains "${sep.trim()}" (the value is not shown)`);
        v = Object.entries(value).map(([name, x]) => `${name}${sep}${x}`);
      } else throw wrong(key, key === 'header' ? 'an array of "Name: value" strings or an object {"Name": "value"}' : 'an array of "K=V" strings or an object {"K": "V"}');
    }
    if (v === undefined) continue;
    out.options[opt] = v;
    out.keys[opt] = key;
  }

  // The server: url, or stdio (a command line split as --stdio "<command>" is, or an array kept verbatim) with args.
  if (d.url !== undefined && d.stdio !== undefined) throw new ConfigError(`${where}: give either key "url" or key "stdio", not both`);
  if (d.url !== undefined) {
    if (typeof d.url !== 'string') throw wrong('url', 'a string');
    out.url = d.url;
  }
  if (d.args !== undefined && d.stdio === undefined) throw new ConfigError(`${where}: key "args" needs key "stdio" (the program to start)`);
  if (d.stdio !== undefined) {
    if (d.args !== undefined && !isStrList(d.args)) throw wrong('args', 'an array of strings');
    if (typeof d.stdio === 'string' && d.args === undefined) out.stdio = d.stdio;
    else if (typeof d.stdio === 'string') out.command = [d.stdio, ...(d.args as string[])];
    else if (isStrList(d.stdio)) out.command = [...d.stdio, ...((d.args as string[] | undefined) ?? [])];
    else throw wrong('stdio', 'a string or an array of strings');
    if (out.command && !out.command.length) throw new ConfigError(`${where}: key "stdio" needs a command`);
  }

  const secrets = ['header', 'bearer'].filter((k) => k in out.keys || Object.hasOwn(d, k));
  if (secrets.length) {
    out.warnings.push(`warning: ${where} holds ${secrets.join(' and ')} values: a secret in a config file is easily committed; give the token with $MCP_REVIEW_CHECK_TOKEN instead\n`);
  }
  return out;
}
