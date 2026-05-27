import { BRAND_NAME } from '@shared/constants/branding';

// Resolve the brand-specific app icon at runtime using the active BRAND_NAME
// (injected via webpack DefinePlugin from the active brand config).
// Falls back to openkosmos if the brand asset is missing.
let resolvedAppIcon: string;
try {
  const iconModule = require(`../assets/${BRAND_NAME}/app.svg`);
  resolvedAppIcon = iconModule.default || iconModule;
} catch (error) {
  console.error(`[brandIcon] Failed to load app icon for brand "${BRAND_NAME}"; falling back to openkosmos.`, error);
  try {
    const fallback = require('../assets/openkosmos/app.svg');
    resolvedAppIcon = fallback.default || fallback;
  } catch {
    resolvedAppIcon = '';
  }
}

export const appIcon: string = resolvedAppIcon;
