/**
 * Global Branding Constants
 * Hardcoded to investment-studio — single-brand build.
 * Values mirror brands/investment-studio/config.json.
 */

// Widen to `string` (not literal types) so brand-conditional comparisons
// elsewhere — e.g. `BRAND_NAME === 'investment-studio'` — still typecheck.
export const APP_NAME: string = 'Investment Studio';
export const BRAND_NAME: string = 'investment-studio';
export const BRAND_CONFIG: Record<string, string> = {
  appId: 'com.investment-studio.app',
  productName: 'Investment Studio',
  userDataName: 'investment-studio-app',
  description: 'Investment Studio - AI Investment Research Workstation',
  copyright: 'Copyright 2026',
  author: 'xinchao1230',
  feedbackLink: 'https://github.com/xinchao1230/investment-studio/issues',
  filenamePrefix: 'InvestmentStudio',
  shortcutName: 'Investment Studio',
  windowTitle: 'Investment Studio',
  systemPromptAddendum: '',
};

export const getWindowTitle = () => BRAND_CONFIG.windowTitle;
