/**
 * Global Branding Constants
 * Values injected at build time via webpack DefinePlugin (process.env.BRAND_NAME / BRAND_CONFIG).
 */

export const BRAND_NAME: string = process.env.BRAND_NAME || 'openkosmos';
export const APP_NAME: string = process.env.APP_NAME || 'OpenKosmos';

// BRAND_CONFIG is JSON-stringified by DefinePlugin; parse it at runtime.
const _rawConfig = process.env.BRAND_CONFIG;
export const BRAND_CONFIG: Record<string, string> = typeof _rawConfig === 'string'
  ? JSON.parse(_rawConfig)
  : (_rawConfig as any) || {};

export const getWindowTitle = () => BRAND_CONFIG.windowTitle || 'OpenKosmos AI Studio';
