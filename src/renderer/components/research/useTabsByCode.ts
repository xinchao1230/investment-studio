// React hook wrapping `TabsByCode` state with localStorage persistence.
//
// Persistence semantics:
//   - Normal mutations (open/close/select/reconcile) are written on a
//     300ms debounce, so a burst of clicks doesn't hammer localStorage.
//   - Destructive lifecycle events (target deleted, target created) call
//     `flushNow()` so they're durable immediately even if the app crashes
//     within the debounce window. This is the critical guarantee for the
//     "recreated same-stockCode target" anti-bug case.
//
// Storage key: `rw:tabsByCode:<profileAlias>` — per-profile isolation.
// Stored payload: `{ version: 1, data: TabsByCode }` so we can migrate later.
//
// Orphan cleanup: on mount, we accept an optional `knownCodes` set and
// drop any entries whose stockCode isn't in the current portfolio. This
// handles the case where a target was deleted between sessions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TabsByCode } from './tabState';

const STORAGE_VERSION = 1;
const DEBOUNCE_MS = 300;

type Persisted = { version: number; data: TabsByCode };

function storageKey(profileAlias: string): string {
  return `rw:tabsByCode:${profileAlias}`;
}

function readFromStorage(profileAlias: string): TabsByCode {
  try {
    const raw = localStorage.getItem(storageKey(profileAlias));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || typeof parsed !== 'object') return {};
    if (parsed.version !== STORAGE_VERSION) {
      // Future: migrations go here. For now treat as empty.
      console.warn(
        '[useTabsByCode] unknown storage version',
        parsed.version,
        '— ignoring',
      );
      return {};
    }
    return (parsed.data && typeof parsed.data === 'object') ? parsed.data : {};
  } catch (err) {
    console.warn('[useTabsByCode] failed to parse localStorage, starting fresh:', err);
    return {};
  }
}

function writeToStorage(profileAlias: string, data: TabsByCode): void {
  try {
    const payload: Persisted = { version: STORAGE_VERSION, data };
    localStorage.setItem(storageKey(profileAlias), JSON.stringify(payload));
  } catch (err) {
    console.warn('[useTabsByCode] failed to write localStorage:', err);
  }
}

export interface UseTabsByCodeReturn {
  tabsByCode: TabsByCode;
  setTabsByCode: React.Dispatch<React.SetStateAction<TabsByCode>>;
  /** Force-flush pending state to localStorage synchronously (bypass debounce). */
  flushNow: () => void;
}

/**
 * Hook managing per-target tab state with localStorage persistence.
 *
 * @param profileAlias - The current user/profile alias. State is isolated
 *   per-profile. Pass an empty string while the alias isn't loaded yet —
 *   the hook will hold an empty state and skip persistence until a real
 *   alias arrives.
 * @param knownCodes - Optional set of stockCodes currently in the portfolio.
 *   On the first non-empty knownCodes we see, we drop orphan entries (codes
 *   not in the set). Pass `null`/`undefined` to skip orphan cleanup.
 */
export function useTabsByCode(
  profileAlias: string,
  knownCodes: Set<string> | null | undefined,
): UseTabsByCodeReturn {
  const [tabsByCode, setTabsByCode] = useState<TabsByCode>({});

  // Track which alias we've already hydrated from storage, so an alias
  // change re-loads from the right key.
  const loadedAliasRef = useRef<string | null>(null);

  // Re-load when alias becomes available or changes.
  useEffect(() => {
    if (!profileAlias) return;
    if (loadedAliasRef.current === profileAlias) return;
    loadedAliasRef.current = profileAlias;
    const fromDisk = readFromStorage(profileAlias);
    setTabsByCode(fromDisk);
  }, [profileAlias]);

  // Orphan cleanup: once we have a known portfolio code set, drop any
  // localStorage entries whose stockCode is no longer in the portfolio.
  // We only run this once per (alias, knownCodes-non-null) pair to avoid
  // wiping state mid-session if the user temporarily has an empty list.
  const orphanCleanupDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profileAlias) return;
    if (!knownCodes) return;
    // Run once per alias.
    if (orphanCleanupDoneRef.current === profileAlias) return;
    orphanCleanupDoneRef.current = profileAlias;
    setTabsByCode((prev) => {
      const codes = Object.keys(prev);
      const orphans = codes.filter((c) => !knownCodes.has(c));
      if (orphans.length === 0) return prev;
      const next = { ...prev };
      for (const c of orphans) delete next[c];
      // Flush immediately so a subsequent crash doesn't resurrect them.
      writeToStorage(profileAlias, next);
      return next;
    });
  }, [profileAlias, knownCodes]);

  // Debounced persistence on every state change.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStateRef = useRef<TabsByCode>(tabsByCode);
  latestStateRef.current = tabsByCode;

  useEffect(() => {
    if (!profileAlias) return;
    // Skip persistence on the very first hydration tick (state was just
    // loaded from disk, no need to immediately write it back).
    if (loadedAliasRef.current !== profileAlias) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      writeToStorage(profileAlias, latestStateRef.current);
      debounceTimerRef.current = null;
    }, DEBOUNCE_MS);
    return () => {
      // Note: we intentionally do NOT clear the timer on unmount cleanup
      // of the *same* effect run — the debounce should still fire. Only
      // overwrite on the next run, which the line above handles.
    };
  }, [tabsByCode, profileAlias]);

  // Flush on unmount / page hide so we don't lose in-flight debounced writes.
  useEffect(() => {
    const flush = () => {
      if (!profileAlias) return;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      writeToStorage(profileAlias, latestStateRef.current);
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [profileAlias]);

  const flushNow = useCallback(() => {
    if (!profileAlias) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    writeToStorage(profileAlias, latestStateRef.current);
  }, [profileAlias]);

  return useMemo(
    () => ({ tabsByCode, setTabsByCode, flushNow }),
    [tabsByCode, flushNow],
  );
}
