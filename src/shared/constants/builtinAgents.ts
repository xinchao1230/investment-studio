/**
 * Built-in agents configuration
 * Shared between main process and renderer process
 *
 * Mirrors the skill seeding pattern (builtinSkills.ts) but for sub-agents.
 * Agents listed here are auto-installed from resources/examples/agents/
 * into user profiles on post-login seeding.
 */

/**
 * Built-in agent names for the investment-studio brand.
 * These agents are automatically seeded into user profiles at startup.
 * The seeder is idempotent: agents already present are skipped.
 */
export const INVESTMENT_STUDIO_BUILTIN_AGENTS: string[] = [
  'market-researcher',
  'model-builder',
  'earnings-reviewer',
  // FSI imports — investment banking coverage
  'pitch-agent',
  'meeting-prep-agent',
  // FSI imports — fund operations
  'valuation-reviewer',
  'gl-reconciler',
  'month-end-closer',
  'statement-auditor',
  // FSI imports — compliance operations
  'kyc-screener',
];

/**
 * Skills that are exclusively used by sub-agents and should NOT be attached
 * to the main agent (Stella). These skills are installed for the sub-agents
 * to use but the main agent should delegate to the sub-agent instead of
 * invoking these skills directly.
 */
export const SUBAGENT_EXCLUSIVE_SKILLS: string[] = [
  'earnings-analysis',
  'earnings-review',
  'audit-xls',
  'morning-note',
  // Fund-operations skills — Stella should delegate to gl-reconciler / month-end-closer / statement-auditor / valuation-reviewer
  'gl-recon',
  'break-trace',
  'accrual-schedule',
  'roll-forward',
  'nav-tieout',
  // Compliance skills — Stella should delegate to kyc-screener
  'kyc-doc-parse',
  'kyc-rules',
];

/**
 * Get builtin agent names for a specific brand.
 */
export function getBuiltinAgentNamesForBrand(brandName: string): string[] {
  if (brandName === 'investment-studio') {
    return [...INVESTMENT_STUDIO_BUILTIN_AGENTS];
  }
  return [];
}
