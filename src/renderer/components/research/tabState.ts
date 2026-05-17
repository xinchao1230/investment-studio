// Per-target tab state management for the Research page.
//
// Each stock target has its own `TargetTabState` (an ordered set of opened
// files + the currently-active one). Tabs are ordered by a fractional index
// (sortKey), Jira/Figma/Linear style, so that:
//   - Inserting a new tab between two siblings doesn't renumber anything
//   - Removing a tab doesn't shift the keys of its neighbours
//   - The on-disk persisted representation is stable across sessions
//
// Active-tab fallback rule (when active tab is closed OR its file goes
// missing): pick the right neighbour first, fall back to the left, return
// null if neither exists. This matches Chrome/VSCode default behaviour and
// was explicitly chosen by the user (no LRU stack).
//
// All functions are pure & deterministic so they can be unit-tested without
// any React mocking.

import { generateKeyBetween } from 'fractional-indexing';

export type TabRecord = {
  absPath: string;
  sortKey: string;
};

export type TargetTabState = {
  tabs: TabRecord[];
  activeAbsPath: string | null;
};

export type TabsByCode = Record<string /* stockCode */, TargetTabState>;

// ---------- queries ----------

export function emptyState(): TargetTabState {
  return { tabs: [], activeAbsPath: null };
}

/**
 * Return tabs in display order (ascending sortKey, lexicographic).
 * Never mutates the input.
 */
export function sortedTabs(state: TargetTabState | undefined): TabRecord[] {
  if (!state) return [];
  return [...state.tabs].sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0,
  );
}

// ---------- mutations (return new state) ----------

/**
 * Open `absPath` in the given target. If the file is already in the tab list,
 * just activate it. Otherwise append a new tab at the end with a fresh
 * fractional-index key greater than every existing key.
 */
export function openTab(
  state: TargetTabState | undefined,
  absPath: string,
): TargetTabState {
  const cur = state ?? emptyState();
  if (cur.tabs.some((t) => t.absPath === absPath)) {
    // De-dupe: existing tab, just promote to active.
    return cur.activeAbsPath === absPath ? cur : { ...cur, activeAbsPath: absPath };
  }
  const sorted = sortedTabs(cur);
  const lastKey = sorted.length > 0 ? sorted[sorted.length - 1].sortKey : null;
  const newKey = generateKeyBetween(lastKey, null);
  return {
    tabs: [...cur.tabs, { absPath, sortKey: newKey }],
    activeAbsPath: absPath,
  };
}

/**
 * Close the tab matching `absPath`. If it was the active tab, pick a
 * fallback using the right-first-then-left rule. Returns the same reference
 * when no change was needed.
 */
export function closeTab(
  state: TargetTabState,
  absPath: string,
): TargetTabState {
  if (!state.tabs.some((t) => t.absPath === absPath)) return state;
  const sorted = sortedTabs(state);
  const remainingSorted = sorted.filter((t) => t.absPath !== absPath);
  let nextActive = state.activeAbsPath;
  if (state.activeAbsPath === absPath) {
    const validPaths = new Set(remainingSorted.map((t) => t.absPath));
    nextActive = pickFallbackActive(sorted, absPath, validPaths);
  }
  return { tabs: remainingSorted, activeAbsPath: nextActive };
}

/**
 * Mark `absPath` as the active tab (must already be present). No-op if the
 * tab doesn't exist in this target — callers should `openTab` first.
 */
export function activateTab(
  state: TargetTabState,
  absPath: string,
): TargetTabState {
  if (state.activeAbsPath === absPath) return state;
  if (!state.tabs.some((t) => t.absPath === absPath)) return state;
  return { ...state, activeAbsPath: absPath };
}

/**
 * Rewrite an existing tab's absPath (used after a rename or move). Returns
 * the same reference if `oldAbsPath` isn't present. If `newAbsPath` already
 * exists as a separate tab, the old entry is dropped (the new one wins) and
 * the active tab is updated if it pointed at either. Preserves sortKey so
 * the renamed tab keeps its position.
 */
export function renameTab(
  state: TargetTabState | undefined,
  oldAbsPath: string,
  newAbsPath: string,
): TargetTabState {
  if (!state) return emptyState();
  if (oldAbsPath === newAbsPath) return state;
  const idx = state.tabs.findIndex((t) => t.absPath === oldAbsPath);
  if (idx < 0) return state;
  const collideIdx = state.tabs.findIndex((t) => t.absPath === newAbsPath);
  let tabs: TabRecord[];
  if (collideIdx >= 0 && collideIdx !== idx) {
    // Target path already open in another tab — drop the old entry and
    // keep the existing newAbsPath tab in its current slot.
    tabs = state.tabs.filter((_, i) => i !== idx);
  } else {
    tabs = state.tabs.map((t, i) =>
      i === idx ? { absPath: newAbsPath, sortKey: t.sortKey } : t,
    );
  }
  const activeAbsPath =
    state.activeAbsPath === oldAbsPath ? newAbsPath : state.activeAbsPath;
  return { tabs, activeAbsPath };
}

/**
 * Drop any tabs whose absPath isn't in `validPaths`. If the active tab is
 * dropped, run the right-first-then-left fallback against the *original*
 * sort order so the user lands on a sensible neighbour. If the active was
 * null but valid tabs exist, activate the first.
 */
export function reconcileWithFileSystem(
  state: TargetTabState | undefined,
  validPaths: Set<string>,
): TargetTabState {
  if (!state) return emptyState();
  const sorted = sortedTabs(state);
  const validTabs = sorted.filter((t) => validPaths.has(t.absPath));
  if (validTabs.length === sorted.length) {
    // Nothing dropped. If the active is still valid, keep state as-is.
    if (!state.activeAbsPath || validPaths.has(state.activeAbsPath)) {
      return state;
    }
  }
  let nextActive: string | null = state.activeAbsPath;
  if (nextActive && !validPaths.has(nextActive)) {
    nextActive = pickFallbackActive(sorted, nextActive, validPaths);
  } else if (!nextActive && validTabs.length > 0) {
    nextActive = validTabs[0].absPath;
  } else if (validTabs.length === 0) {
    nextActive = null;
  }
  return { tabs: validTabs, activeAbsPath: nextActive };
}

// ---------- helpers ----------

/**
 * Right-first-then-left fallback search. Walks the original sort order
 * starting from the slot of `activePath` and returns the nearest absPath
 * present in `validPaths`. Returns null if none exist.
 *
 * Exported only for unit testing — production code shouldn't need to call
 * this directly.
 */
export function pickFallbackActive(
  originalSorted: TabRecord[],
  activePath: string,
  validPaths: Set<string>,
): string | null {
  const oldIdx = originalSorted.findIndex((t) => t.absPath === activePath);
  if (oldIdx < 0) return null;
  for (let i = oldIdx + 1; i < originalSorted.length; i++) {
    if (validPaths.has(originalSorted[i].absPath)) return originalSorted[i].absPath;
  }
  for (let i = oldIdx - 1; i >= 0; i--) {
    if (validPaths.has(originalSorted[i].absPath)) return originalSorted[i].absPath;
  }
  return null;
}
