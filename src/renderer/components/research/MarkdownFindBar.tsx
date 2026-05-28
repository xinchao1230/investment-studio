/**
 * MarkdownFindBar — small overlay for in-page text search inside a
 * rendered markdown preview (or any DOM subtree). Mounts DOM-level
 * <mark> wrappers around matches and scrolls the current match into
 * view. Cleans up wrappers on close/unmount/query change.
 *
 * Why a DOM-mutation approach instead of a controlled React render?
 * The preview is produced by ReactMarkdown across deeply nested
 * components. Re-rendering it with injected <mark> nodes would
 * require either a custom renderer for every block element or a
 * post-render text-walk; the latter is what we do and it's the
 * simplest path that works with the existing component tree.
 *
 * The mutation is safe because:
 *   - ReactMarkdown only re-renders when its source `content` prop
 *     changes. While the find bar is open the parent's content stays
 *     stable (we close the bar on tab switch).
 *   - On query change / unmount we unwrap every <mark> we created
 *     (identified by a private data attribute) and call
 *     `parent.normalize()` to coalesce the original text nodes.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface MarkdownFindBarProps {
  /** Element whose descendants should be searched. May be null while
   *  the parent is still mounting; the bar will recompute when the
   *  ref settles. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Called when the user presses Esc or clicks the close button. */
  onClose: () => void;
}

const MARK_ATTR = 'data-md-find-mark';
const CURRENT_ATTR = 'data-md-find-current';
const HIGHLIGHT_BG = '#fde68a'; // amber-200
const CURRENT_BG = '#f97316'; // orange-500
const CURRENT_FG = 'white';

/** Remove every <mark> wrapper we previously injected and merge the
 *  resulting adjacent text nodes back together. */
function clearMarks(root: HTMLElement | null): void {
  if (!root) return;
  const marks = Array.from(root.querySelectorAll(`mark[${MARK_ATTR}]`));
  for (const m of marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  }
  if (marks.length > 0) root.normalize();
}

/** Walk text nodes under `root`, wrap every occurrence of `query`
 *  in a <mark> element, and return the marks in document order so
 *  the caller can navigate prev/next. */
function findAndMark(
  root: HTMLElement,
  query: string,
  caseSensitive: boolean,
): HTMLElement[] {
  if (!query) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      // Defensive: skip nodes already inside a mark we own.
      if (tag === 'MARK' && parent.hasAttribute(MARK_ATTR)) {
        return NodeFilter.FILTER_REJECT;
      }
      const v = node.nodeValue;
      return v && v.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  // Materialize first — we'll be mutating the tree while iterating.
  const textNodes: Text[] = [];
  let n: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi');

  const marks: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? '';
    re.lastIndex = 0;
    const ranges: Array<{ s: number; e: number }> = [];
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(text)) !== null) {
      ranges.push({ s: m.index, e: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
    if (ranges.length === 0) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const { s, e } of ranges) {
      if (s > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, s)));
      }
      const mark = document.createElement('mark');
      mark.setAttribute(MARK_ATTR, '');
      mark.style.backgroundColor = HIGHLIGHT_BG;
      mark.style.color = 'inherit';
      mark.style.borderRadius = '2px';
      mark.textContent = text.slice(s, e);
      frag.appendChild(mark);
      marks.push(mark);
      cursor = e;
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    parent.replaceChild(frag, textNode);
  }
  return marks;
}

export const MarkdownFindBar: React.FC<MarkdownFindBarProps> = ({
  containerRef,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the input on mount so the user can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Re-mark on query / caseSensitive change. Also runs on mount.
  useEffect(() => {
    const root = containerRef.current;
    clearMarks(root);
    if (!root || !query) {
      setMatches([]);
      setCurrentIndex(0);
      return;
    }
    const found = findAndMark(root, query, caseSensitive);
    setMatches(found);
    setCurrentIndex(0);
  }, [query, caseSensitive, containerRef]);

  // Apply "current match" styling + scroll into view. Runs whenever
  // the navigation index changes OR the match set is rebuilt.
  useEffect(() => {
    matches.forEach((m, i) => {
      if (i === currentIndex) {
        m.setAttribute(CURRENT_ATTR, '');
        m.style.backgroundColor = CURRENT_BG;
        m.style.color = CURRENT_FG;
        m.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        m.removeAttribute(CURRENT_ATTR);
        m.style.backgroundColor = HIGHLIGHT_BG;
        m.style.color = 'inherit';
      }
    });
  }, [currentIndex, matches]);

  // Unmount cleanup. Snapshot the container at effect time so we
  // unwrap the right node even if the parent has swapped it out.
  useEffect(() => {
    const root = containerRef.current;
    return () => {
      clearMarks(root);
    };
  }, [containerRef]);

  const next = useCallback(() => {
    setCurrentIndex((i) => (matches.length === 0 ? 0 : (i + 1) % matches.length));
  }, [matches.length]);

  const prev = useCallback(() => {
    setCurrentIndex((i) =>
      matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length,
    );
  }, [matches.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const counter = useMemo(() => {
    if (!query) return '';
    if (matches.length === 0) return '0/0';
    return `${currentIndex + 1}/${matches.length}`;
  }, [query, matches.length, currentIndex]);

  return (
    <div
      // Floats over the preview area's top-right corner. The parent
      // is the body section (position:relative), so this stays put
      // when the inner preview scrolls.
      className="absolute top-2 right-4 z-20 flex items-center gap-1 bg-white border border-[var(--rw-border)] rounded shadow-md px-2 py-1 text-[12px]"
      role="search"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find…"
        className="w-44 px-1.5 py-0.5 outline-none bg-transparent text-[var(--rw-text)]"
      />
      <span className="text-[var(--rw-text-3)] min-w-[3rem] text-right tabular-nums">
        {counter}
      </span>
      <button
        type="button"
        onClick={() => setCaseSensitive((v) => !v)}
        className={`p-1 rounded text-[11px] font-semibold ${
          caseSensitive
            ? 'bg-[var(--rw-accent,#3b82f6)]/15 text-[var(--rw-accent,#3b82f6)]'
            : 'hover:bg-black/5 text-[var(--rw-text-2)]'
        }`}
        title="Case sensitive"
      >
        Aa
      </button>
      <button
        type="button"
        onClick={prev}
        disabled={matches.length === 0}
        className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        onClick={next}
        disabled={matches.length === 0}
        className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
      >
        <X size={14} />
      </button>
    </div>
  );
};
