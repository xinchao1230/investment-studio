/**
 * Lightweight runtime detection for "which window are we rendering in".
 *
 * The renderer bundle is shared between the main window and the separate
 * Settings window. The Settings window is opened by the main process via
 *   loadURL('http://localhost:3000/#/settings/...')   // dev
 *   loadFile(indexHtml, { hash: '/settings/...' })   // prod
 * so the URL hash is reliably set before React mounts.
 *
 * Inside the settings window the user never navigates away from `#/settings/`,
 * so a hash-prefix check is sufficient.
 */

let cached: boolean | null = null;

export function isSettingsWindow(): boolean {
  if (cached !== null) return cached;
  cached =
    typeof window !== 'undefined' &&
    typeof window.location?.hash === 'string' &&
    window.location.hash.startsWith('#/settings');
  return cached;
}
