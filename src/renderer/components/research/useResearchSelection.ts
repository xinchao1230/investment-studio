// React hook persisting the Research workspace's left-sidebar selection
// (currently-selected target + expanded rows) to sessionStorage.
//
// Why sessionStorage (not localStorage):
//   - tabsByCode lives in localStorage (durable across app restarts).
//   - Selection state should NOT survive app restart — fresh launch = clean
//     initial state, matching the existing UX contract.
//   - But it MUST survive intra-session route changes (e.g. /research →
//     /settings → Back), because ResearchPage unmounts on those.
//   - sessionStorage gives us exactly that: per-renderer-process lifetime.
//
// Persistence semantics mirror useTabsByCode:
//   - 300ms debounce on normal writes.
//   - Destructive lifecycle (delete target, profile switch) → flushNow().
//   - beforeunload / pagehide / unmount → flush.
//
// Storage key: `rw:selection:<profileAlias>` — per-profile isolation.
// Payload: { version: 1, selectedCode: string|null, expandedCodes: string[] }
//
// Orphan cleanup: on first knownCodes load, drop selectedCode and
// expandedCodes entries whose stockCode is no longer in the portfolio.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_VERSION = 1;
const DEBOUNCE_MS = 300;

type Persisted = {
  version: number;
  selectedCode: string | null;
  expandedCodes: string[];
};

type Snapshot = {
  selectedCode: string | null;
  expandedCodes: Set<string>;
};

function storageKey(profileAlias: string): string {
  return `rw:selection:${profileAlias}`;
}

function emptySnapshot(): Snapshot {
  return { selectedCode: null, expandedCodes: new Set<string>() };
}

function readFromStorage(profileAlias: string): Snapshot {
  try {
    const raw = sessionStorage.getItem(storageKey(profileAlias));
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as Persisted;
    if (!parsed || typeof parsed !== 'object') return emptySnapshot();
    if (parsed.version !== STORAGE_VERSION) {
      console.warn(
        '[useResearchSelection] unknown storage version',
        parsed.version,
        '— ignoring',
      );
      return emptySnapshot();
    }
    const selectedCode =
      typeof parsed.selectedCode === 'string' ? parsed.selectedCode : null;
    const expanded = Array.isArray(parsed.expandedCodes)
      ? parsed.expandedCodes.filter((c) => typeof c === 'string')
      : [];
    return { selectedCode, expandedCodes: new Set(expanded) };
  } catch (err) {
    console.warn(
      '[useResearchSelection] failed to parse sessionStorage, starting fresh:',
      err,
    );
    return emptySnapshot();
  }
}

function writeToStorage(profileAlias: string, snap: Snapshot): void {
  try {
    const payload: Persisted = {
      version: STORAGE_VERSION,
      selectedCode: snap.selectedCode,
      expandedCodes: Array.from(snap.expandedCodes),
    };
    sessionStorage.setItem(storageKey(profileAlias), JSON.stringify(payload));
  } catch (err) {
    console.warn('[useResearchSelection] failed to write sessionStorage:', err);
  }
}

export interface UseResearchSelectionReturn {
  selectedCode: string | null;
  setSelectedCode: React.Dispatch<React.SetStateAction<string | null>>;
  expandedCodes: Set<string>;
  setExpandedCodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Force-flush pending state synchronously (bypass debounce). */
  flushNow: () => void;
  /**
   * True once this hook has hydrated from sessionStorage for the current
   * profileAlias. Callers can gate "post-hydration" side-effects on this
   * to avoid double-firing during the initial empty-state render.
   */
  hydrated: boolean;
}

/**
 * Hook persisting the left-sidebar selection state.
 *
 * @param profileAlias - The current user/profile alias. State is isolated
 *   per-profile. Pass an empty string while the alias isn't loaded yet —
 *   the hook will hold an empty snapshot and skip persistence until a real
 *   alias arrives.
 * @param knownCodes - Optional set of stockCodes currently in the portfolio.
 *   On the first non-null knownCodes we see (per alias), we drop orphan
 *   selectedCode + expandedCodes entries.
 */
export function useResearchSelection(
  profileAlias: string,
  knownCodes: Set<string> | null | undefined,
): UseResearchSelectionReturn {
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // Track which alias we've hydrated for, so an alias change re-loads.
  const loadedAliasRef = useRef<string | null>(null);

  // Re-load when alias becomes available or changes.
  useEffect(() => {
    if (!profileAlias) return;
    if (loadedAliasRef.current === profileAlias) return;
    loadedAliasRef.current = profileAlias;
    const fromDisk = readFromStorage(profileAlias);
    setSelectedCode(fromDisk.selectedCode);
    setExpandedCodes(fromDisk.expandedCodes);
    setHydrated(true);
  }, [profileAlias]);

  // Orphan cleanup once per alias, after knownCodes is available.
  const orphanCleanupDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profileAlias) return;
    if (!knownCodes) return;
    if (orphanCleanupDoneRef.current === profileAlias) return;
    orphanCleanupDoneRef.current = profileAlias;
    setSelectedCode((prev) => (prev && !knownCodes.has(prev) ? null : prev));
    setExpandedCodes((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const c of prev) {
        if (knownCodes.has(c)) next.add(c);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [profileAlias, knownCodes]);

  // Debounced persistence on every state change.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSnapshotRef = useRef<Snapshot>({ selectedCode, expandedCodes });
  latestSnapshotRef.current = { selectedCode, expandedCodes };

  useEffect(() => {
    if (!profileAlias) return;
    // Skip writes until we've actually hydrated from disk for this alias —
    // otherwise the initial empty-state render would overwrite stored data.
    if (loadedAliasRef.current !== profileAlias) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      writeToStorage(profileAlias, latestSnapshotRef.current);
      debounceTimerRef.current = null;
    }, DEBOUNCE_MS);
  }, [selectedCode, expandedCodes, profileAlias]);

  // Flush on unmount / page hide so we don't lose in-flight debounced writes.
  useEffect(() => {
    const flush = () => {
      if (!profileAlias) return;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      writeToStorage(profileAlias, latestSnapshotRef.current);
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
    writeToStorage(profileAlias, latestSnapshotRef.current);
  }, [profileAlias]);

  return useMemo(
    () => ({
      selectedCode,
      setSelectedCode,
      expandedCodes,
      setExpandedCodes,
      flushNow,
      hydrated,
    }),
    [selectedCode, expandedCodes, flushNow, hydrated],
  );
}
