// RFC 9110 WWW-Authenticate challenge-list parser (§1.5).

export interface Challenge {
  scheme: string;
  params: Record<string, string>;
  token68?: string;
  /** Params whose value was neither a token nor a quoted-string (e.g. an unquoted URL), read leniently up to `,`. */
  unquoted?: string[];
}

/** A challenge scheme that carries OAuth bearer-token parameters (resource_metadata, scope, error). */
export function isBearerLike(c: { scheme: string }): boolean {
  return c.scheme === 'bearer' || c.scheme === 'dpop';
}

const TOKEN = /[!#$%&'*+.^_`|~0-9A-Za-z-]/;

export function parseWwwAuthenticate(header: string | null | undefined): Challenge[] {
  if (!header) return [];
  const s = header;
  let i = 0;
  const out: Challenge[] = [];
  const skipWs = () => { while (i < s.length && /[ \t]/.test(s[i])) i++; };
  const skipWsComma = () => { while (i < s.length && /[ \t,]/.test(s[i])) i++; };
  const readToken = () => { const start = i; while (i < s.length && TOKEN.test(s[i])) i++; return s.slice(start, i); };
  const readQuoted = () => {
    let v = '';
    i++; // opening quote
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\' && i + 1 < s.length) i++;
      v += s[i++];
    }
    i++; // closing quote
    return v;
  };

  skipWsComma();
  while (i < s.length) {
    const scheme = readToken();
    if (!scheme) { i++; skipWsComma(); continue; }
    const ch: Challenge = { scheme: scheme.toLowerCase(), params: {} };
    out.push(ch);
    skipWs();
    const rest = s.slice(i);
    const isParam = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+[ \t]*=[ \t]*("|[!#$%&'*+.^_`|~0-9A-Za-z-])/.test(rest);
    const t68 = isParam ? null : /^[A-Za-z0-9\-._~+/]+=*(?=[ \t]*(,|$))/.exec(rest);
    if (t68) {
      ch.token68 = t68[0];
      i += t68[0].length;
      skipWsComma();
      continue;
    }
    // auth-params
    while (i < s.length) {
      skipWsComma();
      const before = i;
      const name = readToken();
      skipWs();
      if (!name || s[i] !== '=') { i = before; break; } // next challenge starts
      i++;
      skipWs();
      let value: string;
      if (s[i] === '"') value = readQuoted();
      else {
        // RFC 9110 allows only a token here, but servers send unquoted URLs (resource_metadata=https://...). Read up
        // to the next comma or whitespace as the MCP SDK client does, rather than cutting at ':' and parsing the rest
        // as a phantom challenge.
        value = readToken();
        const start = i;
        while (i < s.length && !/[\s,]/.test(s[i])) i++;
        if (i > start) {
          value += s.slice(start, i);
          (ch.unquoted ??= []).push(name.toLowerCase());
        }
      }
      ch.params[name.toLowerCase()] = value;
      skipWs();
      if (s[i] === ',') i++;
    }
    skipWsComma();
  }
  return out;
}
