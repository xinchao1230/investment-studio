/**
 * DirtyEditorsContext
 * -------------------
 * Tracks which interactive editors currently hold unsaved changes,
 * keyed by a stable identifier (absolute file path).
 *
 * The state must live above every editor surface — OverlayFileViewer
 * modal, ContentTabs in-page editor, and any future inline editor —
 * because the user can switch between them, navigate routes, or close
 * the app while edits are pending. Local per-component `isDirty` state
 * would vanish on unmount and silently drop unsaved work.
 *
 * Anyone editing a file calls `markDirty(absPath)` when the buffer
 * diverges from the on-disk content and `markClean(absPath)` after a
 * successful save (or when the editor unmounts and the changes have
 * been discarded). `hasAnyDirty()` is the predicate consumed by the
 * `beforeunload` listener and the route-switch guard.
 *
 * Implementation: a `Set<string>` snapshot held in state. We rebuild
 * the Set on each mutation rather than mutating in place so React
 * picks up the change. Reads expose synchronous helpers via `useRef`
 * so callers inside event handlers (beforeunload, navigation guards)
 * see the freshest value without depending on render timing.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

interface DirtyEditorsContextValue {
  /** Mark `key` as having unsaved changes. Idempotent. */
  markDirty(key: string): void;
  /** Clear the dirty flag for `key`. Idempotent. */
  markClean(key: string): void;
  /** True if `key` is currently dirty. */
  isDirty(key: string): boolean;
  /** True if any editor is currently dirty (event-handler safe). */
  hasAnyDirty(): boolean;
  /** Snapshot of all dirty keys (event-handler safe). */
  getDirtyKeys(): string[];
  /** Reactive flag for components that want to re-render on changes. */
  anyDirty: boolean;
}

const DirtyEditorsContext = createContext<DirtyEditorsContextValue | null>(null);

export const DirtyEditorsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [dirtySet, setDirtySet] = useState<Set<string>>(() => new Set());
  // Mirror the latest value in a ref so synchronous handlers (the
  // `beforeunload` listener, click handlers in navigation) read the
  // current truth without waiting for a re-render.
  const dirtyRef = useRef<Set<string>>(dirtySet);
  dirtyRef.current = dirtySet;

  const markDirty = useCallback((key: string) => {
    setDirtySet((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const markClean = useCallback((key: string) => {
    setDirtySet((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const isDirty = useCallback(
    (key: string) => dirtyRef.current.has(key),
    [],
  );
  const hasAnyDirty = useCallback(() => dirtyRef.current.size > 0, []);
  const getDirtyKeys = useCallback(
    () => Array.from(dirtyRef.current),
    [],
  );

  const value = useMemo<DirtyEditorsContextValue>(
    () => ({
      markDirty,
      markClean,
      isDirty,
      hasAnyDirty,
      getDirtyKeys,
      anyDirty: dirtySet.size > 0,
    }),
    [markDirty, markClean, isDirty, hasAnyDirty, getDirtyKeys, dirtySet],
  );

  return (
    <DirtyEditorsContext.Provider value={value}>
      {children}
    </DirtyEditorsContext.Provider>
  );
};

/**
 * Returns the dirty-editors API. Falls back to a no-op stub if no
 * provider is mounted, so editor components can be rendered in
 * tests / storybook without the full app shell.
 */
export const useDirtyEditors = (): DirtyEditorsContextValue => {
  const ctx = useContext(DirtyEditorsContext);
  if (ctx) return ctx;
  // No-op stub — keeps editor components resilient to missing provider
  // (e.g. unit tests that mount just the editor).
  return {
    markDirty: () => undefined,
    markClean: () => undefined,
    isDirty: () => false,
    hasAnyDirty: () => false,
    getDirtyKeys: () => [],
    anyDirty: false,
  };
};
