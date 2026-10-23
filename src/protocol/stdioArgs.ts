// Small shell-like tokenizer for --stdio (single quotes, double quotes, backslash escapes).

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
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[i + 1];
      has = true;
      i += 2;
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
