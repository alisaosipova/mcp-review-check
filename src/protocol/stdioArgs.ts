// Small shell-like tokenizer for --stdio: single quotes, double quotes, whitespace splitting. A backslash is literal
// outside quotes and, inside double quotes, everywhere but before a " (the Windows argv rule, on every OS, R-15), so
// Windows paths (C:\Users\me\server.js, "\\host\My Share\s.js", "C:\srv\\") survive.

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
        let n = 0; // 2n backslashes and " give n and end the quote, 2n+1 give n and a literal "
        while (input[i + n] === '\\') n++;
        if (input[i + n] === '"') { cur += '\\'.repeat(n >> 1) + (n % 2 ? '"' : ''); i += n + (n % 2); } else { cur += input.slice(i, i + n + 1); i += n + 1; }
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

/** One argument quoted for cmd.exe and PowerShell as the Windows argv rule reads it back (tokenizeCommand too, R-15). */
export function cmdQuote(arg: string): string {
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, '$&$&')}"`;
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
