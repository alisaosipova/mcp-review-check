// POL: unsupported use cases and commercial content (§2.6).
import { defineRule, type RawFinding } from './types.js';
import { annotations, isStr, toolName } from './util/access.js';
import { extractLinks } from './util/html.js';
import { corpus, locationOf, nfkc, snippet, tokenize } from './util/text.js';
import { uiResources } from './util/ui.js';

const CLAUDE_POLICY = 'https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy';
const OAI_GUIDE = 'https://developers.openai.com/plugins/plugin-guidelines';

const MONEY_NAME = /(send|transfer|wire|pay|payout|withdraw|deposit|remit|swap|bridge|stake|buy|sell|trade|place_?order|execute_?(trade|order|payment|transaction)|sign_?transaction|broadcast_?(tx|transaction))/i;
const MONEY_WORDS = /\b(money|funds?|payments?|ach|sepa|swift|iban|bank|crypto(currency)?|bitcoin|btc|eth(ereum)?|usdc|usdt|stablecoin|wallet|securities|stocks?|shares)\b/i;

export const POL_001 = defineRule(
  {
    id: 'POL-001', title: 'Money or financial-asset transfer (heuristic)', severity: { claude: 'warning' }, needs: ['tools'],
    rationale: 'Moving money or financial assets is unsupported unless Anthropic has expressly permitted it in writing.',
    fix: 'Remove transfer tools, or obtain written permission before submitting.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => snap.tools.flatMap((t): RawFinding[] => {
    const name = toolName(t);
    if (annotations(t).readOnlyHint === true || !MONEY_NAME.test(name)) return [];
    const text = `${tokenize(name).join(' ')} ${isStr(t.description) ? t.description : ''}`;
    return MONEY_WORDS.test(text) ? [{ tool: name, message: 'looks like a money or asset transfer; unsupported unless Anthropic has expressly permitted it in writing' }] : [];
  }),
);

const MEDIA = /(generate|create|synthesi[sz]e|render|make|produce|edit)[_ -]?(an? )?(ai )?(image|images|photo|picture|art|artwork|illustration|avatar|video|clip|animation|audio|speech|voice|music|song|sound|podcast)/i;
const MEDIA2 = /\b(text[- ]to[- ](image|video|speech|audio|music)|tts|txt2img|img2img|stable diffusion|dall-?e|midjourney|voice clon)/i;
const DESIGN = /\b(diagram|chart|graph|slide|presentation|mockup|wireframe|ui|logo|flowchart|design asset)\b/i;

export const POL_002 = defineRule(
  {
    id: 'POL-002', title: 'AI image, video or audio generation (heuristic)', severity: { claude: 'warning' }, needs: ['tools'],
    rationale: 'AI media generation is an unsupported use case in the Claude directory (design tools excepted).',
    fix: 'Remove generative media tools, or explain the design-tool use case in your submission.',
    sources: [CLAUDE_POLICY],
  },
  (snap) => {
    const out: RawFinding[] = [];
    const texts: Array<{ text: string; tool?: string; where: string }> = snap.tools.map((t) => ({
      tool: toolName(t), where: 'tool',
      text: [tokenize(toolName(t)).join(' '), toolName(t), t.title, t.description].filter(isStr).join(' \n '),
    }));
    if (isStr(snap.instructions)) texts.push({ text: snap.instructions, where: 'instructions' });
    for (const { text, tool, where } of texts) {
      const n = nfkc(text);
      const m = MEDIA.exec(n) ?? MEDIA2.exec(n);
      if (!m) continue;
      const design = DESIGN.test(n);
      out.push({ tool, severity: design ? 'info' : undefined, message: `${where}: AI media generation${design ? ' (design-tool exemption likely applies)' : ''}: "${snippet(n, m.index, m[0].length)}"` });
    }
    return out;
  },
);

// Promotional phrasing addressed to the user. Bare nouns (coupon, discount code, free trial) are left out: a store-admin
// tool that creates coupons is functionality, not advertising.
const ADS = /\b(sponsored (content|by|listings?|results?)|advertisement:|paid placement|promoted (listing|product)s?|affiliate links?|use (the |our |my )?(promo|discount|coupon) ?code|(get|save|enjoy|take) (an extra )?\d+% off|\d+% off (your|all|today|now|everything|sitewide)|start (your|a) free trial|try (it )?free for \d+|subscribe now|upgrade to (pro|premium)|sign up (now|today))\b|\d+% off!/i;
const ENDORSE = /\b(official (chatgpt|openai|claude|anthropic)|endorsed by (openai|anthropic)|(openai|anthropic)[- ]approved)\b/i;

export const POL_003 = defineRule(
  {
    id: 'POL-003', title: 'Advertising, sponsored content, pricing or promotions', severity: { claude: 'warning', chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'Ads, promotions and implied endorsements are not allowed in tool metadata.',
    fix: 'Remove promotional language and implied endorsements.',
    sources: [CLAUDE_POLICY, OAI_GUIDE],
  },
  (snap) => corpus(snap).flatMap((e): RawFinding[] => {
    const text = nfkc(e.text);
    const m = ADS.exec(text) ?? ENDORSE.exec(text);
    return m ? [{ tool: e.tool, path: e.path, message: `${locationOf(e)}: "${snippet(text, m.index, m[0].length)}"` }] : [];
  }),
);

// Digital-goods and subscription upsell only. Checkout and cart are not upsell: physical-goods commerce must link to an
// external, merchant-hosted checkout.
const UPSELL = /\b(buy (more )?credits|purchase (more )?tokens|pricing plans?|upgrade (now|your (plan|subscription|account))|subscribe (now|to (our|a|the) (plan|subscription|premium))|premium (plan|subscription))\b/i;
const UPSELL_WORDS = new Set(['billing', 'upgrade', 'subscribe', 'subscription', 'subscriptions', 'pricing', 'plans']);
const CHECKOUT_WORDS = new Set(['checkout', 'cart']);
// Source-code hosts: a path such as /OpenZeppelin/contracts-upgradeable/blob/... names a repository, not a store page.
const CODE_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'raw.githubusercontent.com', 'gist.github.com', 'sourcegraph.com', 'npmjs.com', 'www.npmjs.com'];

/** The first word of `words` that is a whole path segment or a whole -/_/. separated part of one ("upgradeable" is not "upgrade"). */
export function pathWord(path: string, words: Set<string>): string | undefined {
  for (const seg of path.toLowerCase().split('/')) {
    if (words.has(seg)) return seg;
    const part = seg.split(/[-_.]/).find((x) => words.has(x));
    if (part) return part;
  }
  return undefined;
}

/** The upsell or checkout word in a widget link, or undefined (code hosts and unparsable links are skipped). */
export function linkKind(link: string): 'upsell' | 'checkout' | undefined {
  let u: URL;
  try { u = new URL(link, 'https://widget.invalid'); } catch { return undefined; }
  if (CODE_HOSTS.includes(u.hostname.toLowerCase())) return undefined;
  if (pathWord(u.pathname, UPSELL_WORDS)) return 'upsell';
  if (pathWord(u.pathname, CHECKOUT_WORDS)) return 'checkout';
  return undefined;
}

export const POL_004 = defineRule(
  {
    id: 'POL-004', title: 'Subscription upsell or checkout flow', severity: { chatgpt: 'warning' }, needs: ['tools'],
    rationale: 'OpenAI does not allow digital subscription upsells inside plugins.',
    fix: 'Remove upsell text and checkout links.',
    sources: [OAI_GUIDE],
  },
  (snap) => {
    const out: RawFinding[] = [];
    for (const e of corpus(snap)) {
      const text = nfkc(e.text);
      const m = UPSELL.exec(text);
      if (m) out.push({ tool: e.tool, message: `${locationOf(e)}: "${snippet(text, m.index, m[0].length)}"` });
    }
    for (const r of uiResources(snap)) {
      if (!r.html) continue;
      const m = UPSELL.exec(r.html);
      if (m) out.push({ resource: r.uri, message: `widget HTML: "${snippet(r.html, m.index, m[0].length)}"` });
      for (const link of extractLinks(r.html)) {
        const kind = linkKind(link);
        if (kind === 'upsell') { out.push({ resource: r.uri, message: `widget links to ${link}` }); break; }
        if (kind === 'checkout') {
          out.push({ resource: r.uri, severity: 'info', message: `widget links to ${link}: fine for physical goods (external checkout); digital goods and subscriptions may not be sold` });
          break;
        }
      }
    }
    return out;
  },
);

export const POL_005 = defineRule(
  {
    id: 'POL-005', title: 'Unofficial wrapper, demo or test server', severity: { chatgpt: 'info' }, needs: [],
    rationale: 'OpenAI rejects unofficial third-party wrappers, demos and tests.',
    fix: 'Submit only production servers for services you own or are authorized to represent.',
    sources: [OAI_GUIDE],
  },
  (snap) => {
    const si = snap.serverInfo ?? {};
    for (const k of ['name', 'title', 'description']) {
      const v = si[k];
      if (isStr(v)) {
        const m = /\b(unofficial|demo|sample|example|playground|wrapper for)\b/i.exec(v);
        if (m) return [{ message: `serverInfo.${k} mentions "${m[0]}"` }];
      }
    }
    return [];
  },
);

export const policyRules = [POL_001, POL_002, POL_003, POL_004, POL_005];
