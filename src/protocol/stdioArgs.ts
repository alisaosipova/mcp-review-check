// Small shell-like tokenizer for --stdio: single quotes, double quotes (with \" \\ \$ \` escapes inside),
// whitespace splitting. A backslash outside quotes is literal so Windows paths (C:\Users\me\server.js) survive.

export function tokenizeCommand(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated single quote');
      cur += input.slice(i + 1, end);
      has = true;
      i = end + 1;
    } else if (c === '"') {
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length && /["\\$`]/.test(input[i + 1])) i++;
        cur += input[i++];
      }
      if (i >= input.length) throw new Error('unterminated double quote');
      has = true;
      i++;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
      i++;
    } else {
      cur += c;
      has = true;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}

/**
 * Splits the `--stdio -- <command> [args...]` form off argv: a bare `--stdio` (no value of its own) plus a `--`
 * separator makes everything after `--` the command, verbatim and untokenized. Other argv is returned unchanged.
 */
export function splitStdioArgv(argv: string[]): { args: string[]; command?: string[] } {
  const sep = argv.indexOf('--');
  if (sep < 0) return { args: argv };
  const head = argv.slice(0, sep);
  const i = head.findIndex((a, k) => a === '--stdio' && (k === head.length - 1 || head[k + 1].startsWith('-')));
  if (i < 0) return { args: argv };
  return { args: [...head.slice(0, i), ...head.slice(i + 1)], command: argv.slice(sep + 1) };
}
