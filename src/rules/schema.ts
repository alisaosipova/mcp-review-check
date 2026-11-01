// TOOL-016..022: input/output schemas (§2.3).
import _Ajv2020 from 'ajv/dist/2020.js';
import _Ajv2019 from 'ajv/dist/2019.js';
import _AjvDraft7 from 'ajv';
import { perTool } from './tools.js';
import { defineRule, type RawFinding } from './types.js';
import { isObj, isStr } from './util/access.js';
import { deref, schemaMetrics, walkSchema } from './util/schemaWalk.js';

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
        if (err.missingRef !== undefined || /can't resolve reference/i.test(err.message)) continue; // TOOL-019
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
      const baseNoFrag = base?.split('#')[0];
      walkSchema(root, (v) => {
        for (const k of ['$ref', '$dynamicRef']) {
          const ref = v.node[k];
          if (!isStr(ref) || ref.startsWith('#')) continue;
          let abs: string | undefined;
          try { abs = new URL(ref, base).href; } catch { abs = /^[a-z][a-z0-9+.-]*:/i.test(ref) ? ref : undefined; }
          if (!abs || !/^[a-z][a-z0-9+.-]*:/i.test(abs)) continue;
          if (baseNoFrag && abs.split('#')[0] === baseNoFrag) continue;
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
    const { depth, count } = schemaMetrics(t.inputSchema);
    if (depth > 10 || count > 200) return { message: `inputSchema depth ${depth}, ${count} subschemas` };
    return undefined;
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

export const schemaRules = [TOOL_016, TOOL_017, TOOL_018, TOOL_019, TOOL_020, TOOL_021, TOOL_022];
