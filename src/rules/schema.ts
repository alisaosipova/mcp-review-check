// TOOL-016..022: input/output schemas (§2.3).
import _Ajv2020 from 'ajv/dist/2020.js';
import _Ajv2019 from 'ajv/dist/2019.js';
import _AjvDraft7 from 'ajv';
import { perTool } from './tools.js';
import { defineRule, type RawFinding } from './types.js';
import { isObj, isStr } from './util/access.js';
import { deref, resolvePointer, schemaMetrics, walkSchema } from './util/schemaWalk.js';
import { capMessage, shortPointer } from './util/text.js';

type AjvLike = {
  validateSchema(s: unknown): boolean | Promise<unknown>;
  compile(s: unknown): unknown;
  removeSchema(s?: unknown): unknown;
  errors?: Array<{ instancePath?: string; message?: string }> | null;
  errorsText(e?: unknown): string;
};
type AjvCtor = new (opts: Record<string, unknown>) => AjvLike;
const unwrap = (m: unknown): AjvCtor => ((m as { default?: unknown }).default ?? m) as AjvCtor;
const Ajv2020 = unwrap(_Ajv2020);
const Ajv2019 = unwrap(_Ajv2019);
const AjvDraft7 = unwrap(_AjvDraft7);

const TOOLS_2026 = 'https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool';
const AJV_OPTS = { strict: false, validateSchema: true, logger: false, allErrors: false, addUsedSchema: false };

// Each dialect is accepted with http or https and with or without a trailing '#', but Ajv registers its
// meta-schema under one canonical id only (http for draft-07, https for 2019-09 and 2020-12): the copy handed
// to Ajv carries the canonical id, or Ajv throws "no schema with key or ref" for a valid schema.
const DIALECTS: Array<[RegExp, AjvCtor, string]> = [
  [/^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/, Ajv2020, 'https://json-schema.org/draft/2020-12/schema'],
  [/^https?:\/\/json-schema\.org\/draft\/2019-09\/schema#?$/, Ajv2019, 'https://json-schema.org/draft/2019-09/schema'],
  [/^https?:\/\/json-schema\.org\/draft-07\/schema#?$/, AjvDraft7, 'http://json-schema.org/draft-07/schema#'],
];

// One Ajv per dialect: building an instance compiles the meta-schema, which dominated runtime on large servers.
// addUsedSchema: false keeps tool schemas (and their $id) out of the shared instance; compile() callers remove
// the compiled schema from the cache afterwards.
const INSTANCES = new Map<AjvCtor, AjvLike>();
function instance(ctor: AjvCtor): AjvLike {
  let ajv = INSTANCES.get(ctor);
  if (!ajv) { ajv = new ctor(AJV_OPTS); INSTANCES.set(ctor, ajv); }
  return ajv;
}

export function ajvFor(schema: Record<string, unknown>): { ajv: AjvLike; unknownDialect?: string } {
  const s = schema.$schema;
  if (s === undefined) return { ajv: instance(Ajv2020) };
  const hit = isStr(s) ? DIALECTS.find(([re]) => re.test(s)) : undefined;
  if (hit) return { ajv: instance(hit[1]) };
  return { ajv: instance(Ajv2020), unknownDialect: String(s) };
}

/** A shallow copy for Ajv: a known dialect's `$schema` set to its canonical id, an unknown one removed. */
function ajvCopy(schema: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...schema };
  if (copy.$schema === undefined) return copy;
  const hit = isStr(copy.$schema) ? DIALECTS.find(([re]) => re.test(copy.$schema as string)) : undefined;
  if (hit) copy.$schema = hit[2];
  else delete copy.$schema;
  return copy;
}

/** Compile and drop the compiled schema from the shared instance's cache. */
function compileOnce(ajv: AjvLike, schema: Record<string, unknown>): unknown {
  try {
    return ajv.compile(schema);
  } finally {
    // removeSchema(object) also deletes by $id, which could hit a meta-schema id; keep those few in the cache.
    if (schema.$id === undefined && schema.id === undefined) { try { ajv.removeSchema(schema); } catch { /* not cached */ } }
  }
}

/** Validate `data` against `schema`; returns an error text or undefined. Used by RT-006. */
export function validateAgainst(schema: unknown, data: unknown): string | undefined {
  if (!isObj(schema)) return undefined;
  try {
    const { ajv } = ajvFor(schema);
    const copy = ajvCopy(schema);
    const validate = compileOnce(ajv, copy) as ((d: unknown) => boolean) & { errors?: unknown };
    return validate(data) ? undefined : ajv.errorsText(validate.errors);
  } catch (e) {
    return undefined; // schema problems are reported by TOOL-017
  }
}

/** The first `pattern` or `patternProperties` key that is not a valid unicode regular expression. */
export function invalidPattern(schema: unknown): string | undefined {
  let bad: string | undefined;
  const check = (p: unknown) => {
    if (bad || typeof p !== 'string') return;
    try { new RegExp(p, 'u'); } catch (e) { bad = (e as Error).message; }
  };
  walkSchema(schema, (v) => {
    check(v.node.pattern);
    if (isObj(v.node.patternProperties)) for (const k of Object.keys(v.node.patternProperties)) check(k);
  });
  return bad;
}

export const TOOL_016 = defineRule(
  {
    id: 'TOOL-016', title: 'inputSchema present with root type "object"', severity: { spec: 'error' }, needs: ['tools'],
    rationale: 'Tool arguments are always a JSON object.',
    fix: 'Set inputSchema to { type: "object", properties: {...} }.',
    sources: [TOOLS_2026],
  },
  (snap) => perTool(snap, (t) => {
    const s = t.inputSchema;
    if (s === undefined || s === null) return { message: 'inputSchema is missing' };
    if (!isObj(s)) return { message: 'inputSchema is not an object' };
    if (s.type !== 'object') return { message: `inputSchema root type is ${JSON.stringify(s.type)}, not "object"` };
    return undefined;
  }),
);

export const TOOL_017 = defineRule(
  {
    id: 'TOOL-017', title: 'Schemas valid for their dialect', severity: { spec: 'error' }, needs: ['tools'],
    rationale: 'Clients compile tool schemas; invalid schemas break the whole tool list in some hosts.',
    fix: 'Fix the schema so it validates against its JSON Schema meta-schema (2020-12 by default).',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage'],
  },
  (snap) => perTool(snap, (t) => {
    const out: RawFinding[] = [];
    for (const key of ['inputSchema', 'outputSchema'] as const) {
      const s = t[key];
      if (!isObj(s)) continue;
      const { ajv, unknownDialect } = ajvFor(s);
      const copy = ajvCopy(s);
      if (unknownDialect) out.push({ severity: 'warning', path: key, message: `${key} uses unknown $schema dialect ${unknownDialect}` });
      try {
        const ok = ajv.validateSchema(copy);
        if (ok === false) { out.push({ path: key, message: `${key} is not a valid schema: ${ajv.errorsText(ajv.errors)}` }); continue; }
        // Full compilation (code generation) cost ~30 ms per large schema and dominated runtime on big servers.
        // The meta-schema check above covers structure; the remaining compile-time failure in practice is an
        // invalid regular expression, which is checked directly (Ajv compiles patterns with the "u" flag).
        const bad = invalidPattern(copy);
        if (bad) out.push({ path: key, message: `${key} does not compile: ${bad.slice(0, 200)}` });
      } catch (e) {
        const err = e as Error & { missingRef?: string };
        if (err.missingRef !== undefined || /can't resolve reference/i.test(err.message)) continue; // TOOL-036 (local), TOOL-019 (network)
        out.push({ path: key, message: `${key} does not compile: ${err.message.slice(0, 200)}` });
      }
    }
    return out;
  }),
);

const COMPOSITION = ['anyOf', 'oneOf', 'allOf', 'not', 'if', '$ref'];
// Keywords that admit keys without listing them in `properties`: such a tool takes parameters.
const OPEN_KEYS = ['patternProperties', 'propertyNames', 'unevaluatedProperties', 'dependentSchemas', 'dependentRequired', 'dependencies'];

export const TOOL_018 = defineRule(
  {
    id: 'TOOL-018', title: 'Parameterless tool should set additionalProperties:false', severity: { spec: 'info' }, needs: ['tools'],
    rationale: 'An explicit empty object schema tells clients to send {}.',
    fix: 'Use { type: "object", additionalProperties: false } for tools without parameters.',
    sources: [TOOLS_2026],
  },
  (snap) => perTool(snap, (t) => {
    const s = t.inputSchema;
    if (!isObj(s) || s.type !== 'object') return undefined;
    const hasProps = isObj(s.properties) && Object.keys(s.properties).length > 0;
    if (hasProps || COMPOSITION.some((k) => s[k] !== undefined) || s.additionalProperties === false) return undefined;
    if (OPEN_KEYS.some((k) => s[k] !== undefined && s[k] !== false) || isObj(s.additionalProperties)) return undefined;
    return { message: 'tool takes no parameters but does not set additionalProperties: false' };
  }),
);

export const TOOL_019 = defineRule(
  {
    id: 'TOOL-019', title: 'No network $ref', severity: { spec: 'warning' }, needs: ['tools'],
    rationale: 'Clients must not fetch remote schemas; network refs fail to resolve.',
    fix: 'Inline the referenced schema or move it into $defs.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution'],
  },
  (snap) => perTool(snap, (t) => {
    const out: RawFinding[] = [];
    for (const key of ['inputSchema', 'outputSchema'] as const) {
      const root = t[key];
      if (!isObj(root)) continue;
      const base = isStr(root.$id) ? root.$id : undefined;
      const resolve = (ref: string): string | undefined => {
        let abs: string | undefined;
        try { abs = new URL(ref, base).href; } catch { abs = /^[a-z][a-z0-9+.-]*:/i.test(ref) ? ref : undefined; }
        return abs && /^[a-z][a-z0-9+.-]*:/i.test(abs) ? abs : undefined;
      };
      // The document's own resources: the root and every embedded schema with its own $id (e.g. in $defs).
      const local = new Set<string>();
      walkSchema(root, (v) => {
        const abs = isStr(v.node.$id) ? resolve(v.node.$id) : undefined;
        if (abs) local.add(abs.split('#')[0]);
      });
      walkSchema(root, (v) => {
        for (const k of ['$ref', '$dynamicRef']) {
          const ref = v.node[k];
          if (!isStr(ref) || ref.startsWith('#')) continue;
          const abs = resolve(ref);
          if (!abs || local.has(abs.split('#')[0])) continue;
          out.push({ path: `${key}${v.path === '/' ? '' : v.path}`, message: `${k} points outside the document: ${ref}` });
        }
      });
    }
    return out;
  }),
);

export const TOOL_020 = defineRule(
  {
    id: 'TOOL-020', title: 'Schema complexity bounded', severity: { spec: 'info' }, needs: ['tools'],
    rationale: 'Deep or huge schemas cost tokens and slow validation.',
    fix: 'Flatten the schema (depth <= 10, <= 200 subschemas).',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic#composition-keyword-resource-use'],
  },
  (snap) => perTool(snap, (t) => {
    // Both schemas are sent in tools/list, so both cost context tokens.
    const out: RawFinding[] = [];
    for (const key of ['inputSchema', 'outputSchema'] as const) {
      const { depth, count } = schemaMetrics(t[key]);
      if (depth > 10 || count > 200) out.push({ message: `${key} depth ${depth}, ${count} subschemas` });
    }
    return out;
  }),
);

// Keywords whose values are instance data, not subschemas: a `$ref` inside an enum value or a default is data. `x-`
// extensions are skipped too (an OpenAPI `x-` block may quote `#/components/...` refs of another document).
// Both apply only at keyword positions: inside a name map (properties, $defs, ...) the keys are user-chosen names.
const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples', 'example']);
const NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** An absolute URI without its fragment, or undefined for a relative one (or one URL cannot parse). */
function absDoc(ref: string, base?: string): string | undefined {
  try { return new URL(ref, base).href.split('#')[0]; } catch { return undefined; }
}

/**
 * The references of one schema document that cannot resolve inside it (A05-05): a local pointer (`#/$defs/Missing`) or
 * anchor (`#item`) with no target, and a relative reference (`common.json#/$defs/Item`) when no base `$id` makes it
 * absolute and no embedded resource carries that `$id`. References inside an embedded resource (a subschema with its
 * own `$id`) resolve against that resource and are not judged; absolute references to other documents are TOOL-019's.
 */
export function unresolvedRefs(root: Record<string, unknown>): Array<{ path: string; keyword: string; ref: string; why: string }> {
  const out: Array<{ path: string; keyword: string; ref: string; why: string }> = [];
  const base = isStr(root.$id) && SCHEME.test(root.$id) ? root.$id : undefined;
  const rootDoc = base ? absDoc(base) : undefined;
  const anchors = new Set<string>();
  const embeddedIds = new Set<string>();
  const refs: Array<{ path: string; keyword: string; ref: string }> = [];
  let count = 0;
  const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
  const walk = (node: unknown, path: string, depth: number, nameMap = false) => {
    if (depth > 64 || ++count > 20000) return;
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}/${i}`, depth + 1)); return; }
    if (!isObj(node)) return;
    if (nameMap) { for (const [k, v] of Object.entries(node)) walk(v, `${path}/${esc(k)}`, depth + 1); return; }
    const id = node === root ? undefined : isStr(node.$id) ? node.$id : undefined;
    if (id !== undefined && !id.startsWith('#')) {
      // An embedded resource: its own base and pointers. Only its $id matters here.
      embeddedIds.add(id.split('#')[0]);
      const abs = absDoc(id, base);
      if (abs) embeddedIds.add(abs);
      return;
    }
    for (const k of ['$anchor', '$dynamicAnchor']) if (isStr(node[k])) anchors.add(node[k] as string);
    if (isStr(node.$id) && node.$id.startsWith('#') && node.$id.length > 1) anchors.add(node.$id.slice(1)); // draft-07 plain-name $id
    for (const k of ['$ref', '$dynamicRef', '$recursiveRef']) if (isStr(node[k])) refs.push({ path, keyword: k, ref: node[k] as string });
    for (const [k, v] of Object.entries(node)) {
      if (!DATA_KEYWORDS.has(k) && !k.startsWith('x-')) walk(v, `${path}/${esc(k)}`, depth + 1, NAME_MAPS.has(k));
    }
  };
  walk(root, '', 0);
  const fragmentMissing = (frag: string): string | undefined => {
    if (frag === '' || frag === '#') return undefined;
    if (frag.startsWith('#/')) return resolvePointer(root, frag) === undefined ? 'names no subschema in the document' : undefined;
    let name = frag.slice(1);
    try { name = decodeURIComponent(name); } catch { /* keep */ }
    return anchors.has(name) ? undefined : 'names no $anchor in the document';
  };
  for (const r of refs) {
    const hash = r.ref.indexOf('#');
    const docPart = hash < 0 ? r.ref : r.ref.slice(0, hash);
    const frag = hash < 0 ? '' : r.ref.slice(hash);
    let why: string | undefined;
    if (docPart === '') why = fragmentMissing(frag);
    else if (embeddedIds.has(docPart)) why = undefined;
    else {
      const abs = absDoc(docPart, base);
      if (abs && (abs === rootDoc)) why = fragmentMissing(frag);
      else if (abs && embeddedIds.has(abs)) why = undefined;
      else if (!abs && !SCHEME.test(docPart)) why = 'is relative, and the schema has no absolute $id to resolve it against';
      // else: an absolute reference to another document (TOOL-019)
    }
    if (why) out.push({ ...r, why });
  }
  return out;
}

export const TOOL_036 = defineRule(
  {
    id: 'TOOL-036', title: 'Every $ref resolves inside the schema', severity: { spec: 'warning' }, needs: ['tools'],
    rationale: 'MCP schemas must be self-contained: a $ref to a missing $defs entry or anchor, or a relative file reference with no base, '
      + 'cannot be resolved, and hosts that compile the schema (Ajv: "can\'t resolve reference") reject the tool.',
    fix: 'Point the $ref at an existing $defs entry or $anchor, or inline the referenced schema into $defs.',
    sources: [
      'https://modelcontextprotocol.io/specification/2026-07-28/basic#ref-resolution',
      'https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1',
    ],
  },
  (snap) => perTool(snap, (t) => {
    const out: RawFinding[] = [];
    for (const key of ['inputSchema', 'outputSchema'] as const) {
      const root = t[key];
      if (!isObj(root)) continue;
      for (const r of unresolvedRefs(root)) {
        out.push({ path: `${key}${r.path}`, message: capMessage(`${shortPointer(`${key}${r.path}`)} ${r.keyword} ${JSON.stringify(r.ref.slice(0, 200))} ${r.why}`) });
      }
    }
    return out;
  }),
);

const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export const TOOL_021 = defineRule(
  {
    id: 'TOOL-021', title: 'x-mcp-header constraints', severity: { spec: 'error' }, needs: ['tools'],
    rationale: 'Streamable HTTP clients mirror x-mcp-header parameters into HTTP headers and drop tools that break the rules.',
    fix: 'Use a unique RFC 9110 token on a top-level string/integer/boolean property.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#schema-extension'],
  },
  (snap) => perTool(snap, (t) => {
    const out: RawFinding[] = [];
    const seen = new Map<string, string>();
    const suffix = ' Streamable HTTP clients will drop this tool.';
    walkSchema(t.inputSchema, (v) => {
      const h = v.node['x-mcp-header'];
      if (h === undefined || v.path.endsWith('/$ref')) return;
      if (!isStr(h) || !HEADER_TOKEN.test(h)) out.push({ path: v.path, message: `x-mcp-header ${JSON.stringify(h)} is not an RFC 9110 token.${suffix}` });
      if (isStr(h)) {
        const k = h.toLowerCase();
        if (seen.has(k)) out.push({ path: v.path, message: `x-mcp-header "${h}" duplicates ${seen.get(k)}.${suffix}` });
        else seen.set(k, v.path);
      }
      // A local $ref carries the type in its target; whether a client resolves it is not deterministic, so a primitive
      // target is not reported.
      const target = deref(t.inputSchema, v.node);
      const type = v.node.type ?? (isObj(target) ? target.type : undefined);
      if (!['string', 'integer', 'boolean'].includes(String(type))) {
        const what = type === undefined ? 'a property without a type' : `a ${JSON.stringify(type)} property`;
        out.push({ path: v.path, message: `x-mcp-header on ${what}.${suffix}` });
      }
      if (!v.pure) out.push({ path: v.path, message: `x-mcp-header is not on a plain properties chain.${suffix}` });
    });
    return out;
  }),
);

const SENSITIVE = /pass(word)?|secret|token|api[_-]?key|auth|credential|ssn|email|phone/i;

export const TOOL_022 = defineRule(
  {
    id: 'TOOL-022', title: 'x-mcp-header on a sensitive parameter', severity: { spec: 'warning' }, needs: ['tools'],
    rationale: 'HTTP headers are logged by proxies; sensitive values should stay in the body.',
    fix: 'Remove x-mcp-header from sensitive parameters.',
    sources: ['https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header'],
  },
  (snap) => perTool(snap, (t) => {
    const out: RawFinding[] = [];
    walkSchema(t.inputSchema, (v) => {
      const h = v.node['x-mcp-header'];
      if (h === undefined || v.path.endsWith('/$ref')) return;
      if (SENSITIVE.test(v.rawName) || (isStr(h) && SENSITIVE.test(h)) || v.node.format === 'password' || v.node.format === 'email') {
        out.push({ path: v.path, message: `sensitive parameter "${v.rawName}" is mirrored into header ${String(h)}` });
      }
    });
    return out;
  }),
);

// TOOL-035 vocabularies. Keywords: JSON Schema draft-04 to 2020-12 (core, applicator, validation, meta-data,
// format, content, unevaluated), OpenAPI 3.x schema-object extensions, and annotations common in MCP servers.
// Fixed list on purpose: only keys one edit away from one of these are reported, never "unknown" keys in general.
export const SCHEMA_KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$anchor', '$dynamicRef', '$dynamicAnchor', '$vocabulary', '$comment', '$defs', '$recursiveRef', '$recursiveAnchor',
  'id', 'definitions', 'dependencies',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'prefixItems', 'items', 'additionalItems', 'contains',
  'properties', 'patternProperties', 'additionalProperties', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties',
  'type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern',
  'maxItems', 'minItems', 'uniqueItems', 'maxContains', 'minContains', 'maxProperties', 'minProperties', 'required', 'dependentRequired',
  'title', 'description', 'default', 'deprecated', 'readOnly', 'writeOnly', 'examples', 'format',
  'contentEncoding', 'contentMediaType', 'contentSchema',
  'nullable', 'discriminator', 'xml', 'externalDocs', 'example',
]);
// Only keywords this long are typo targets: one edit away from `if`, `not`, `id`, `type` or `enum` is too often a real word.
const TYPO_MIN = 5;

/** Formats of JSON Schema 2020-12 (validation §7.3), earlier drafts, and the OpenAPI format registry (spec.openapis.org/registry/format). */
export const KNOWN_FORMATS = new Set([
  'date-time', 'date', 'time', 'duration', 'email', 'idn-email', 'hostname', 'idn-hostname', 'ipv4', 'ipv6', 'uri', 'uri-reference',
  'iri', 'iri-reference', 'uuid', 'uri-template', 'json-pointer', 'relative-json-pointer', 'regex',
  'host-name', 'ip-address', 'color', 'utc-millisec', 'style', 'phone',
  'base64url', 'binary', 'byte', 'char', 'commonmark', 'date-time-local', 'decimal', 'decimal128', 'double-int', 'double', 'float', 'html',
  'http-date', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'ipv4-cidr', 'ipv6-cidr', 'language', 'media-range',
  'password', 'sf-binary', 'sf-boolean', 'sf-decimal', 'sf-integer', 'sf-string', 'sf-token', 'time-local', 'unixtime',
]);

/** True when the Levenshtein distance between a and b is exactly 1 (one insertion, deletion or substitution). */
export function editDistanceOne(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// Singular forms more than one edit away from the plural keyword.
const SINGULAR: Record<string, string> = {
  property: 'properties', additionalProperty: 'additionalProperties', patternProperty: 'patternProperties', unevaluatedProperty: 'unevaluatedProperties',
};

/** The known keyword `key` is probably a misspelling of, if any. */
export function keywordTypo(key: string): string | undefined {
  if (SCHEMA_KEYWORDS.has(key) || key.startsWith('x-')) return undefined;
  if (Object.prototype.hasOwnProperty.call(SINGULAR, key)) return SINGULAR[key];
  for (const kw of SCHEMA_KEYWORDS) if (kw.length >= TYPO_MIN && editDistanceOne(key, kw)) return kw;
  // A swap of two adjacent letters (`requried`) is one edit in the common reading of "typo".
  for (const kw of SCHEMA_KEYWORDS) {
    if (kw.length < TYPO_MIN || kw.length !== key.length) continue;
    const d = [...kw].map((c, i) => (c === key[i] ? -1 : i)).filter((i) => i >= 0);
    if (d.length === 2 && d[1] === d[0] + 1 && kw[d[0]] === key[d[1]] && kw[d[1]] === key[d[0]]) return kw;
  }
  return undefined;
}

// Subschemas under these keys see properties declared by a sibling or parent, so their `required` is not checked.
const SHARED_SCOPE = /\/(allOf|anyOf|oneOf|not|if|then|else|dependentSchemas|dependencies)(\/|$)/;

export const TOOL_035 = defineRule(
  {
    id: 'TOOL-035', title: 'Schema lint: dangling required, keyword typos, unknown format', severity: { spec: 'info' }, needs: ['tools'],
    rationale: 'Validators ignore unknown keywords and unknown formats, so a misspelt `propeties` or `requried` silently drops the constraint, '
      + 'and a `required` entry naming a property that is not declared (in a schema that does not admit extra properties) is usually a typo that hosts cannot satisfy.',
    fix: 'Fix the keyword spelling, declare the required property (or drop it from `required`), and use a format from JSON Schema 2020-12 or the OpenAPI format registry.',
    sources: [
      'https://json-schema.org/draft/2020-12/json-schema-validation',
      'https://json-schema.org/draft/2020-12/json-schema-core',
      'https://spec.openapis.org/registry/format/',
      'https://modelcontextprotocol.io/specification/2026-07-28/basic#json-schema-usage',
    ],
  },
  (snap) => perTool(snap, (t) => {
    const out: RawFinding[] = [];
    for (const key of ['inputSchema', 'outputSchema'] as const) {
      walkSchema(t[key], (v) => {
        const at = `${key}${v.path === '/' ? '' : v.path}`;
        const n = v.node;
        // (a) dangling required
        if (Array.isArray(n.required) && isObj(n.properties) && !SHARED_SCOPE.test(v.path)) {
          const open = n.additionalProperties === true || isObj(n.additionalProperties) || n.patternProperties !== undefined
            || n.unevaluatedProperties === true || isObj(n.unevaluatedProperties)
            || ['allOf', 'anyOf', 'oneOf', '$ref', '$dynamicRef', 'if', 'dependentSchemas', 'dependencies'].some((k) => n[k] !== undefined);
          const props = n.properties;
          const missing = open ? [] : n.required.filter((r): r is string => isStr(r) && !Object.prototype.hasOwnProperty.call(props, r));
          if (missing.length) out.push({ path: at, message: `${key} requires ${missing.map((m) => `"${m}"`).join(', ')}, not declared in properties` });
        }
        // (b) misspelt keywords: the node's own keys are keywords (property names live inside `properties`)
        for (const k of Object.keys(n)) {
          const kw = keywordTypo(k);
          if (kw) out.push({ path: at, message: `${key} has "${k}", probably a misspelling of "${kw}" (ignored by validators)` });
        }
        // (c) unknown format
        if (isStr(n.format) && !KNOWN_FORMATS.has(n.format)) {
          out.push({ path: at, message: `${key} uses format "${n.format.slice(0, 80)}", not a JSON Schema 2020-12 or OpenAPI registry format` });
        }
      });
    }
    return out;
  }),
);

export const schemaRules = [TOOL_016, TOOL_017, TOOL_018, TOOL_019, TOOL_020, TOOL_021, TOOL_022, TOOL_035, TOOL_036];
