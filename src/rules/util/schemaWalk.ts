// Recursive JSON Schema walker (§1.5).
import { isObj, type Obj } from './access.js';

export interface SchemaVisit {
  /** JSON pointer from the schema root. */
  path: string;
  /** Property name normalized to lowercase snake_case ('' for non-property nodes). */
  name: string;
  rawName: string;
  node: Obj;
  /** The node is the value of a `properties/<name>` entry. */
  viaProperty: boolean;
  /** Every step from the root is a `properties/<name>` step. */
  pure: boolean;
  depth: number;
}

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    // A lookahead, not /([A-Z]+)([A-Z][a-z])/: that form backtracks over a long uppercase run at every start (quadratic
    // on a 1 MB name of 'A's); this one gives the same output in linear time.
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1_')
    .replace(/[\s\-.]+/g, '_')
    .toLowerCase();
}

const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** decodeURIComponent that keeps the raw segment on malformed escapes (e.g. a stray '%'). */
function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** The node a local `#/...` JSON pointer names in `root`, or undefined. `#` is the root. */
export function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#')) return undefined;
  const parts = ref.slice(1).split('/').filter((p, i) => !(i === 0 && p === ''));
  let cur: unknown = root;
  for (const raw of parts) {
    const p = safeDecode(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) cur = cur[Number(p)];
    else if (isObj(cur)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

const MAX_DEPTH = 64;
const COMBINATORS = ['anyOf', 'oneOf', 'allOf'];
const SINGLE = ['not', 'if', 'then', 'else', 'additionalProperties', 'additionalItems', 'items', 'contains', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties'];
// name → subschema maps that are not properties. `dependencies` (draft-07) mixes subschemas with string arrays
// (the dependentRequired form); only the object values are schemas.
const SCHEMA_MAPS = ['$defs', 'definitions', 'dependentSchemas', 'dependencies'];

export function walkSchema(schema: unknown, visit: (v: SchemaVisit) => void): void {
  if (!isObj(schema)) return;
  const seen = new Set<Obj>();
  const go = (node: unknown, path: string, rawName: string, viaProperty: boolean, pure: boolean, depth: number) => {
    if (!isObj(node) || depth > MAX_DEPTH || seen.has(node)) return;
    seen.add(node);
    visit({ path: path || '/', name: rawName ? snakeCase(rawName) : '', rawName, node, viaProperty, pure, depth });
    if (isObj(node.properties)) {
      for (const [k, v] of Object.entries(node.properties)) go(v, `${path}/properties/${esc(k)}`, k, true, pure, depth + 1);
    }
    if (isObj(node.patternProperties)) {
      for (const [k, v] of Object.entries(node.patternProperties)) go(v, `${path}/patternProperties/${esc(k)}`, '', false, false, depth + 1);
    }
    for (const key of SINGLE) {
      const v = node[key];
      if (isObj(v)) go(v, `${path}/${key}`, '', false, false, depth + 1);
      else if (key === 'items' && Array.isArray(v)) v.forEach((s, i) => go(s, `${path}/items/${i}`, '', false, false, depth + 1));
    }
    if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((s, i) => go(s, `${path}/prefixItems/${i}`, '', false, false, depth + 1));
    for (const key of COMBINATORS) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach((s, i) => go(s, `${path}/${key}/${i}`, '', false, false, depth + 1));
    }
    for (const defs of SCHEMA_MAPS) {
      const d = node[defs];
      if (isObj(d)) for (const [k, v] of Object.entries(d)) go(v, `${path}/${defs}/${esc(k)}`, '', false, false, depth + 1);
    }
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
      go(resolvePointer(schema, node.$ref), `${path}/$ref`, rawName, viaProperty, false, depth + 1);
    }
  };
  go(schema, '', '', false, true, 0);
}

/** Resolve a local `$ref` (one level) for property inspection. */
export function deref(root: unknown, node: unknown): unknown {
  if (isObj(node) && typeof node.$ref === 'string') return resolvePointer(root, node.$ref) ?? node;
  return node;
}

/**
 * A property node seen through its local `$ref`: the target's keywords, overridden by the node's own (draft 2019-09+
 * lets siblings of `$ref` apply). The walker visits `{ $ref }` before its target, so rules that read a property's type,
 * enum or format must use this, or a pydantic/zod `$defs` enum reads as a free-form string. `unresolved` is set for a
 * `$ref` that does not resolve locally: its shape is unknown.
 */
export function resolvedNode(root: unknown, node: Obj): { node: Obj; unresolved: boolean } {
  let cur: Obj = node;
  const seen = new Set<Obj>([node]);
  const layers: Obj[] = [node];
  // Follow a short chain of local refs ($defs/A -> $defs/B), guarding against cycles.
  for (let i = 0; i < 8 && typeof cur.$ref === 'string'; i++) {
    const next = cur.$ref.startsWith('#') ? resolvePointer(root, cur.$ref) : undefined;
    if (!isObj(next)) return { node: Object.assign({}, ...layers.slice().reverse()), unresolved: true };
    if (seen.has(next)) break;
    seen.add(next);
    layers.push(next);
    cur = next;
  }
  return { node: Object.assign({}, ...layers.slice().reverse()), unresolved: false };
}

const NULL_KEYS = new Set(['type', 'title', 'description']);
/** A `{type: 'null'}` branch (title and description aside): an optional wrapper's null side adds no value. */
export const isNullBranch = (s: unknown): boolean =>
  isObj(s) && s.type === 'null' && Object.keys(s).every((x) => NULL_KEYS.has(x));

/**
 * A node seen through an optional wrapper (A05-05): pydantic `Optional[X]` and zod `.nullable()` emit
 * `{anyOf: [X, {type: 'null'}]}`, often with X a `$ref` into `$defs`. When anyOf/oneOf has exactly one branch that is
 * not a null branch, that branch, resolved through its local `$ref` chain, is merged under the node's own keywords
 * (the combinator itself dropped). Any other node is returned through resolvedNode unchanged. `unresolved` is set when
 * the node or the branch is a `$ref` that does not resolve locally (unknown shape).
 *
 * Used only where it can remove a false positive (free-form tests, the DATA non-text skips); rules that report on a
 * listed value (TOOL-023 method mix, TOOL-024) keep reading the node as written, so a patch adds no finding.
 */
export function unwrapNullable(root: unknown, node: Obj): { node: Obj; unresolved: boolean } {
  const r = resolvedNode(root, node);
  if (r.unresolved) return r;
  const base = r.node;
  delete base.$ref;
  for (const k of ['anyOf', 'oneOf']) {
    const list = base[k];
    if (!Array.isArray(list) || list.length < 2) continue;
    const rest = list.filter((s) => !isNullBranch(s));
    if (rest.length !== 1 || !isObj(rest[0])) continue;
    const inner = resolvedNode(root, rest[0]);
    if (inner.unresolved) return { node: base, unresolved: true };
    const own = { ...base };
    delete own[k];
    const merged: Obj = { ...inner.node, ...own };
    delete merged.$ref;
    return { node: merged, unresolved: false };
  }
  return { node: base, unresolved: false };
}

/**
 * The closed value list of a node: `enum`, `const`, or an anyOf/oneOf whose every branch is a `const`/`enum` branch (a
 * `{type: 'null'}` branch, as in an optional enum, adds no free value). One free branch such as `{type: 'string'}`
 * opens the list, so the node has no closed value list.
 *
 * `open: true` returns the listed values even when a free branch sits beside them: the values a mode or method switch
 * names ("GET" and "POST" next to `{type: 'string'}` still mix safe and unsafe methods, TOOL-023/024).
 * `root` resolves `$ref` branches; only the free-form tests pass it (A05-05).
 */
export function enumValues(node: Obj, opts: { open?: boolean; root?: unknown } = {}): unknown[] | undefined {
  if (Array.isArray(node.enum)) return node.enum;
  for (const k of ['oneOf', 'anyOf']) {
    const list = node[k];
    if (Array.isArray(list) && list.length) {
      const consts: unknown[] = [];
      let closed = true;
      for (const raw of list) {
        // With `root`, a `$ref` branch is read through its target (an Optional enum kept in `$defs`, A05-05).
        const s = opts.root !== undefined && isObj(raw) && typeof raw.$ref === 'string' ? resolvedBranch(opts.root, raw) : raw;
        if (isObj(s) && s.const !== undefined) consts.push(s.const);
        else if (isObj(s) && Array.isArray(s.enum)) consts.push(...s.enum);
        else if (isNullBranch(s)) continue;
        else closed = false;
      }
      if ((closed || opts.open) && consts.length) return consts;
    }
  }
  if (node.const !== undefined) return [node.const];
  return undefined;
}

/** A `$ref` branch through its local chain, or the branch itself when the chain does not resolve. */
function resolvedBranch(root: unknown, s: Obj): Obj {
  const r = resolvedNode(root, s);
  return r.unresolved ? s : r.node;
}

/** Structural metrics without following $ref (TOOL-020). */
export function schemaMetrics(schema: unknown): { depth: number; count: number } {
  let count = 0;
  let maxDepth = 0;
  const go = (node: unknown, depth: number) => {
    if (!isObj(node) || depth > MAX_DEPTH) return;
    count++;
    maxDepth = Math.max(maxDepth, depth);
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties' || k === 'patternProperties' || SCHEMA_MAPS.includes(k)) {
        if (isObj(v)) for (const s of Object.values(v)) go(s, depth + 1);
      } else if (COMBINATORS.includes(k) || k === 'prefixItems' || (k === 'items' && Array.isArray(v))) {
        if (Array.isArray(v)) for (const s of v) go(s, depth + 1);
      } else if (SINGLE.includes(k)) {
        go(v, depth + 1);
      }
    }
  };
  go(schema, 0);
  return { depth: maxDepth, count };
}
