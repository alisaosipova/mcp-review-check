// DATA: data collection (§2.5). Scope: walkSchema over inputSchemas plus the corpus.
import type { Snapshot } from '../snapshot.js';
import { defineRule, type RawFinding, type Severity } from './types.js';
import { isObj, toolName } from './util/access.js';
import { deref, resolvedNode, unwrapNullable, walkSchema, type SchemaVisit } from './util/schemaWalk.js';
import { corpus, foldNote, locationOf, scanEntry, snippet } from './util/text.js';

const CLAUDE_POLICY = 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy';
const OAI_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';

interface NameRule { re: RegExp; severity?: Severity; label: string; skip?: (v: SchemaVisit, root: unknown) => boolean }

/**
 * A skip tested on the node as written and, for a local $ref, on the node it resolves to (A05-04): `{$ref: '#/$defs/Hours'}`
 * with Hours an integer is as non-text as `{type: 'integer'}`. Also through an optional wrapper (A05-05): pydantic
 * `int | None` is `{anyOf: [{type: 'integer'}, {type: 'null'}]}`. The resolved node can only add a skip, never remove one.
 */
const orResolved = (test: (node: Record<string, unknown>, v: SchemaVisit) => boolean) => (v: SchemaVisit, root: unknown): boolean =>
  test(v.node, v) || (typeof v.node.$ref === 'string' && test(resolvedNode(root, v.node).node, v))
  || ((Array.isArray(v.node.anyOf) || Array.isArray(v.node.oneOf)) && test(unwrapNullable(root, v.node).node, v));

/** Match property names across all input schemas; one finding per tool+path. */
function scanNames(snap: Snapshot, rules: NameRule[], extra?: (v: SchemaVisit, root: unknown) => RawFinding | undefined): RawFinding[] {
  const out: RawFinding[] = [];
  const seen = new Set<string>();
  for (const t of snap.tools) {
    const tool = toolName(t);
    walkSchema(t.inputSchema, (v) => {
      if (!v.viaProperty || v.path.endsWith('/$ref')) return;
      const key = `${tool}|${v.path}`;
      for (const r of rules) {
        if (r.re.test(v.name) && !r.skip?.(v, t.inputSchema) && !seen.has(key)) {
          seen.add(key);
          out.push({ tool, path: v.path, severity: r.severity, message: `parameter "${v.rawName}" ${r.label}` });
          return;
        }
      }
      const f = extra?.(v, t.inputSchema);
      if (f && !seen.has(key)) { seen.add(key); out.push({ tool, path: v.path, ...f }); }
    });
  }
  return out;
}

function scanText(snap: Snapshot, re: RegExp, label: string, severity?: Severity): RawFinding[] {
  const out: RawFinding[] = [];
  for (const e of corpus(snap)) {
    const text = scanEntry(e);
    const m = re.exec(text);
    if (m) out.push({ tool: e.tool, path: e.path, severity, message: `${locationOf(e)} ${label}: "${snippet(text, m.index, m[0].length)}"${text === e.text ? '' : foldNote(e.text, { index: m.index, length: m[0].length })}` });
  }
  return out;
}

// Bare `memory` is not here: a VM or cache size parameter is called `memory` too. Nor is bare `transcript`: meeting,
// call and video tools take a transcript the user supplies. Both are weak names below.
const STRONG_CONVO = /^(conversation(_?(history|context|log|summary|memory|transcript))?|chat_?(history|log|transcript|memory|memories)|conversation_?memories|message_?history|previous_?messages|prior_?turns|all_?messages|full_?context|context_?window|system_?prompt|user_?prompt)$/i;
const WEAK_CONVO = /^(messages|history|thread|context|background|user_context|additional_context|memory|memories|transcript)$/i;
/** Weak names only count for parameters that can carry text (a numeric `memory` is a size, a numeric `history` a count). */
const NON_TEXT = new Set(['integer', 'number', 'boolean']);
const isNonText = (node: Record<string, unknown>) =>
  typeof node.type === 'string' ? NON_TEXT.has(node.type) : Array.isArray(node.type) && node.type.length > 0 && node.type.every((t) => NON_TEXT.has(t as string));

function isRoleContentArray(v: SchemaVisit, root: unknown): boolean {
  if (v.node.type !== 'array') return false;
  const items = deref(root, v.node.items);
  if (!isObj(items)) return false;
  const p = isObj(items.properties) ? items.properties : {};
  return 'role' in p && 'content' in p;
}

export const DATA_001 = defineRule(
  {
    id: 'DATA-001', title: 'Requests conversation history, transcripts, memory or system prompt', severity: { claude: 'error', chatgpt: 'error' }, needs: ['tools'],
    rationale: 'Servers may not collect the conversation, memory or system prompt.',
    fix: 'Ask only for the specific inputs the tool needs.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => [
    ...scanNames(
      snap,
      [
        // A name match on a parameter that cannot carry text (an integer `context_window` in tokens) is no request (A05-06).
        { re: STRONG_CONVO, label: 'requests conversation data', skip: orResolved(isNonText) },
        { re: WEAK_CONVO, severity: 'warning', label: 'may request conversation data (check it is not chat history)', skip: orResolved(isNonText) },
      ],
      (v, root) => (isRoleContentArray(v, root) ? { message: `parameter "${v.rawName}" is an array of {role, content} messages` } : undefined),
    ),
    // Text detection is a regex heuristic, so it is a warning (§1.2). The nouns are anchored to the chat itself:
    // "full history of status changes" is not conversation data, and "send all messages matching the filter" in a
    // messaging tool is the channel's messages, so `all` needs a chat or conversation qualifier.
    ...scanText(snap, /\b(entire|full|whole|complete) (conversation|chat|transcript)s?\b|\b(include|pass|send|provide) (the )?(user'?s )?((previous|prior) (chat |conversation )?|all (chat |conversation ))messages\b|\bcontents of (your|the (chat|conversation)'?s?) memory\b/i, 'asks for conversation data', 'warning'),
    // A capture verb and a user/conversation object, within one sentence: querying an analytics product is fine.
    ...scanText(snap, /\b(log|logs|logged|record|records|store|stores|send|sends|collect|collects)\b[^.]{0,30}\b(the )?(user'?s? )?(?<!\blog )(prompts?|messages?|quer(y|ies)|conversations?)\b[^.]{0,30}\b(for )?(logging|analytics|telemetry|tracking)\b/i, 'captures prompts for logging/analytics', 'warning'),
  ],
);

export const DATA_002 = defineRule(
  {
    id: 'DATA-002', title: 'Reads Claude memory, chat history or user uploads', severity: { claude: 'warning' }, needs: ['tools'],
    rationale: "Accessing Claude's memory or chat history is not allowed.",
    fix: 'Remove features that read the host memory or chat history.',
    sources: [CLAUDE_POLICY],
  },
  // `memory` needs an owner that is the host or the chat: "read the memory usage of the VM" and the entities of a
  // knowledge-graph memory server are not Claude's memory. The other objects name the chat on their own.
  (snap) => scanText(snap, /\b(read|access|retrieve|search|export|sync)\b[^.]{0,30}\b((claude|assistant|model|host)'?s memor(y|ies)|(your|chat|conversation) memor(y|ies)|memor(y|ies) of (the|this|your) (conversation|chat)|chat history|conversation summar(y|ies)|past conversations|project knowledge)\b/i, 'accesses host memory or chat history'),
);

const SECRET_NAMES = /^(password|passwd|pwd|pass_?phrase|api_?key|apikey|secret|client_?secret|access_?token|refresh_?token|bearer|auth_?token|session_?token|otp|totp|mfa(_?code)?|2fa(_?code)?|verification_?code|private_?key|seed_?phrase|mnemonic)$/i;
// Compound names whose last segment is a secret (new_password, github_token, aws_secret_access_key) are a word-list
// match, so a warning (§1.2). The last segment decides: password_policy and token_count are not secrets.
const SECRET_SUFFIX = /^([a-z0-9]+_)+(password|passwd|pass_?phrase|token|secret|api_?key|access_?key|secret_?key|private_?key)$|^(credentials?|authorization)$/i;
// Pagination and request tokens are not credentials.
const NOT_SECRET = /(^|_)(page|next|cursor|continuation|sync|idempotency|request|max|num|input|output)_token$/i;

export const DATA_003 = defineRule(
  {
    id: 'DATA-003', title: 'Inputs solicit secrets or credentials', severity: { chatgpt: 'error', claude: 'warning' }, needs: ['tools'],
    rationale: 'Credentials must never pass through the model.',
    fix: 'Use OAuth. Never route credentials through the model.',
    sources: [OAI_GUIDE],
  },
  (snap) => [
    ...scanNames(snap, [
      { re: SECRET_NAMES, label: 'solicits a secret' },
      { re: SECRET_SUFFIX, severity: 'warning', label: 'may solicit a secret', skip: (v, root) => NOT_SECRET.test(v.name) || orResolved(isNonText)(v, root) },
      { re: /^pin$/i, severity: 'warning', label: 'may be a PIN code' },
    ]),
    ...scanText(snap, /(provide|enter|paste|include|send) (your|the user'?s) (password|api key|token|secret|otp|one-time code|system prompt)/i, 'asks for a secret'),
  ],
);

export const DATA_004 = defineRule(
  {
    id: 'DATA-004', title: 'Inputs collect restricted data (PCI, PHI, government IDs)', severity: { chatgpt: 'error' }, needs: ['tools'],
    rationale: 'Payment card data, health records and government IDs are restricted.',
    fix: 'Remove restricted-data inputs; use a compliant hosted flow instead.',
    sources: [OAI_GUIDE],
  },
  // Unambiguous card, government-ID and health-record names are errors; names that also fit ordinary data
  // (account_number, exp_month, license_number) are warnings.
  (snap) => scanNames(snap, [
    { re: /^(card_?number|credit_?card(_number)?|cc_?num(ber)?|cvv2?|cvc|(card_?)?(cvv2?|cvc)_?(code)?|card_?security_?code|card_?expir(y|ation)(_(date|month|year))?|card_?exp(_(date|month|year))?|ssn(_last_?4)?|social_?security(_number)?|national_?id|passport(_(number|no|num|id))?|drivers?_?licen[cs]e(_(number|no|num))?|aadhaar(_number)?|medical_?record(_number)?|mrn|health_?insurance_?id|insurance_?member_?id)$/i, label: 'collects restricted data' },
    { re: /^(pan|tin|tax_?id|iban|diagnosis|exp(iry)?_date|exp(iry)?_(month|year)|routing_?number|(bank_)?account_?number|bank_?account|licen[cs]e_?number|nino|sin)$/i, severity: 'warning', label: 'may collect restricted data' },
  ]),
);

// An `address` can be an e-mail, network or wallet address, and a boolean `long` is an output flag.
const NON_PLACE_FORMATS = new Set(['email', 'idn-email', 'ipv4', 'ipv6', 'uri', 'url', 'hostname', 'idn-hostname', 'mac']);
const NON_PLACE_ADDRESS = /\b(e-?mail|ip(v4|v6)?|mac|wallet|contract|ethereum|eth|bitcoin|btc|solana|crypto|blockchain|hex|0x[0-9a-f]*|memory|hostname|url|web)\b/i;
const notAPlace = orResolved((node, v): boolean => {
  if (node.type === 'boolean') return true;
  if (typeof node.format === 'string' && NON_PLACE_FORMATS.has(node.format.toLowerCase())) return true;
  return v.name === 'address' && typeof node.description === 'string' && NON_PLACE_ADDRESS.test(node.description);
});

export const DATA_005 = defineRule(
  {
    id: 'DATA-005', title: 'Inputs request precise user location', severity: { chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'ChatGPT provides coarse location; precise location needs justification.',
    fix: 'Use the coarse location the host provides in `_meta["openai/userLocation"]`.',
    sources: [OAI_GUIDE],
  },
  (snap) => scanNames(snap, [
    { re: /^(lat|latitude|lng|lon|long|longitude|coords?|coordinates|gps|geo(location)?|street(_address)?|address)$/i, label: 'requests a precise location', skip: notAPlace },
    { re: /^(postal_?code|zip(_?code)?)$/i, severity: 'info', label: 'requests a postal code' },
  ]),
);

export const dataRules = [DATA_001, DATA_002, DATA_003, DATA_004, DATA_005];
