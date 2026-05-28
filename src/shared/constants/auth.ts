// src/shared/constants/auth.ts
// Cross-process auth constants shared between main and renderer

/**
 * The user alias used for "Skip Login" mode (no GitHub auth).
 * Referenced by authManager, tokenMonitor, auth IPC, and authDataAdapter.
 */
export const SKIP_LOGIN_ALIAS = '_local' as const;
