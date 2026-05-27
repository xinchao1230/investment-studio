/**
 * useFsChanged - shared hook for subscribing to `kosmos:fs-changed`
 * broadcasts emitted by `BuiltinToolsManager.executeTool` whenever any
 * builtin tool declares filesystem mutations.
 *
 * The hook:
 *  - Filters incoming mutations through a user-supplied predicate
 *  - Buffers matches in a trailing-edge debounce window (default 80ms)
 *  - Within a window, dedupes by path; merges kinds with priority
 *    `delete` > `create` > `modify` so the consumer sees the final state
 *  - Cleans up the timer + listener on unmount (any pending flush is
 *    dropped intentionally — the consumer is gone)
 *
 * Predicate and callback are stored in refs so changes to those don't
 * cause re-subscription churn; only `deps` controls subscription identity.
 */

import type { DependencyList } from 'react';
import { useEffect, useRef } from 'react';

export type FsMutationKind = 'create' | 'modify' | 'delete';

export interface FsMutation {
  path: string;
  kind: FsMutationKind;
}

export interface FsChangedEvent {
  tool: string;
  mutations: FsMutation[];
  timestamp: number;
}

export type FsChangedPredicate = (mutation: FsMutation) => boolean;
export type FsChangedCallback = (
  matched: FsMutation[],
  event: FsChangedEvent,
) => void;

export interface UseFsChangedOptions {
  /** Trailing-edge debounce window in ms. Default 80. Set 0 to disable. */
  debounceMs?: number;
}

/** Predicate helper: match any path under `prefix`. Empty prefix → no match. */
export function pathStartsWith(prefix: string): FsChangedPredicate {
  return (m) => !!prefix && m.path.startsWith(prefix);
}

/** Predicate helper: match exact absolute path. */
export function pathEquals(abs: string): FsChangedPredicate {
  return (m) => m.path === abs;
}

function mergeKind(a: FsMutationKind, b: FsMutationKind): FsMutationKind {
  if (a === 'delete' || b === 'delete') return 'delete';
  if (a === 'create' || b === 'create') return 'create';
  return 'modify';
}

export function useFsChanged(
  predicate: FsChangedPredicate,
  callback: FsChangedCallback,
  deps: DependencyList,
  options?: UseFsChangedOptions,
): void {
  const debounceMs = options?.debounceMs ?? 80;

  // Stash latest predicate / callback so the subscription doesn't churn.
  const predicateRef = useRef(predicate);
  const callbackRef = useRef(callback);
  predicateRef.current = predicate;
  callbackRef.current = callback;

  useEffect(() => {
    const api = (window as any).electronAPI?.builtinTools?.onFsChanged;
    if (typeof api !== 'function') {
      // No-op in environments without the preload bridge (tests, etc.).
      return;
    }

    let buffer = new Map<string, FsMutation>();
    let lastEvent: FsChangedEvent | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      if (buffer.size === 0 || !lastEvent) return;
      const matched = Array.from(buffer.values());
      const ev = lastEvent;
      buffer = new Map();
      lastEvent = null;
      try {
        callbackRef.current(matched, ev);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[useFsChanged] callback threw:', err);
      }
    };

    const unsubscribe = api((event: FsChangedEvent) => {
      // Note: predicate may capture stale closures from the previous render,
      // but it's read off ref so it's always the latest version.
      const matched = event.mutations.filter(predicateRef.current);
      if (matched.length === 0) return;

      for (const m of matched) {
        const existing = buffer.get(m.path);
        if (existing) {
          buffer.set(m.path, { path: m.path, kind: mergeKind(existing.kind, m.kind) });
        } else {
          buffer.set(m.path, m);
        }
      }
      lastEvent = event;

      if (debounceMs <= 0) {
        flush();
      } else {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      buffer.clear();
      lastEvent = null;
      try { unsubscribe?.(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
