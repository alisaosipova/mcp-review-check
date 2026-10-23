// The rule catalog.
import { annotationRules } from './annotations.js';
import { appsRules } from './apps.js';
import { authRules } from './auth.js';
import { dataRules } from './data.js';
import { injectionRules } from './injection.js';
import { policyRules } from './policy.js';
import { runtimeRules } from './runtime.js';
import { schemaRules } from './schema.js';
import { serverRules } from './server.js';
import { specRules } from './spec.js';
import { toolRules } from './tools.js';
import type { Rule } from './types.js';

export const CATALOG_DATE = '2026-10-22';

const byId = (a: Rule, b: Rule) => a.id.localeCompare(b.id, 'en', { numeric: true });

const CATEGORY_ORDER = ['SRV', 'SPEC', 'TOOL', 'INJ', 'DATA', 'POL', 'APPS', 'AUTH', 'RT'];

export const RULES: Rule[] = [
  ...serverRules, ...specRules, ...toolRules, ...annotationRules, ...schemaRules, ...injectionRules,
  ...dataRules, ...policyRules, ...appsRules, ...authRules, ...runtimeRules,
].sort((a, b) => CATEGORY_ORDER.indexOf(a.id.split('-')[0]) - CATEGORY_ORDER.indexOf(b.id.split('-')[0]) || byId(a, b));

export { MANUAL_ITEMS, manualChecklist } from './manual.js';
export { runRules, activePlatforms } from './engine.js';
