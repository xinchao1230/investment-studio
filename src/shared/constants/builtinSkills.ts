/**
 * Built-in skills configuration
 * Shared between main process and renderer process
 */

/**
 * Built-in skill names that are pre-installed and cannot be deleted.
 * These skills are automatically installed during FRE and startup updates.
 *
 * NOTE: This is the union across all brands. For brand-specific filtering use
 * {@link getBuiltinSkillNamesForBrand}.
 */
export const BUILTIN_SKILL_NAMES: string[] = [
  'skill-creator',
  'stock-analyze',    // investment-studio only
  'earnings-forecast', // investment-studio only
  'earnings-review',  // investment-studio only
  'industry-comparison', // investment-studio only
  'marginal-tracking', // investment-studio only
  'stock-screening',  // investment-studio only
];

/**
 * Brand-scoped builtin skill list — used by FRE seeder + agent skill auto-attach.
 */
export function getBuiltinSkillNamesForBrand(brandName: string): string[] {
  if (brandName === 'investment-studio') {
    return [
      'skill-creator',
      'stock-analyze',
      'earnings-forecast',
      'earnings-review',
      'industry-comparison',
      'marginal-tracking',
      'stock-screening',
    ];
  }
  return ['skill-creator'];
}

/**
 * Check if a skill is a built-in skill
 * @param skillName The skill name to check
 * @returns true if the skill is built-in
 */
export function isBuiltinSkill(skillName: string): boolean {
  return BUILTIN_SKILL_NAMES.includes(skillName);
}
