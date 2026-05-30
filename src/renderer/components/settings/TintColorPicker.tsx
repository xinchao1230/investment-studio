import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  TintColor,
  TINT_COLOR_ORDER,
  TINT_COLORS,
  normalizeTintColor,
} from '../../lib/theme/tintColor';
import '../../styles/TintColorPicker.css';

/**
 * Detect the host platform once. Electron exposes a trusted `platform`
 * ('darwin' | 'win32' | ...); on the web we fall back to `navigator.platform`.
 * Drives the `data-platform` attribute so CSS can tune the popover shape
 * (rounded soft macOS flyout vs. squarer Fluent-like Windows flyout vs. a
 * neutral web panel) without any platform-specific APIs in the component.
 */
function detectPlatform(): 'mac' | 'windows' | 'web' {
  const electronPlatform = (window as { electronAPI?: { platform?: string } }).electronAPI?.platform;
  if (electronPlatform === 'darwin') return 'mac';
  if (electronPlatform === 'win32') return 'windows';
  if (electronPlatform) return 'web'; // some other electron platform (linux) -> neutral
  // Web fallback.
  const nav = navigator.platform?.toUpperCase() ?? '';
  if (nav.includes('MAC')) return 'mac';
  if (nav.includes('WIN')) return 'windows';
  return 'web';
}

export interface TintColorPickerProps {
  /** Currently selected tint (single source of truth, controlled by parent). */
  value: TintColor;
  /** Called when the user picks a different tint. */
  onChange: (next: TintColor) => void;
  /** Optional id wired to an external label for the trigger button. */
  triggerId?: string;
}

/**
 * Accessible single-select tint color picker.
 *
 * - Trigger: a button showing the selected color dot + name + chevron.
 * - Popover: a `role="listbox"` of options (dot + name + checkmark for the
 *   selected one), anchored to the right edge of the trigger.
 *
 * Keyboard model (WAI-ARIA listbox):
 *   Trigger — Enter/Space/ArrowDown/ArrowUp open the popover.
 *   Open    — ArrowUp/Down move the active option, Home/End jump, Enter/Space
 *             select + close, Escape closes (no change). Focus returns to the
 *             trigger after select or Escape.
 * Outside click also closes without changing the value.
 */
export const TintColorPicker: React.FC<TintColorPickerProps> = ({ value, onChange, triggerId }) => {
  const selected = normalizeTintColor(value);
  const [open, setOpen] = useState(false);
  // Which option is visually "active" (highlighted) while navigating by keyboard.
  const [activeIndex, setActiveIndex] = useState<number>(() =>
    Math.max(0, TINT_COLOR_ORDER.indexOf(selected)),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const platform = useMemo(detectPlatform, []);
  const listboxId = useId();
  const optionId = useCallback((index: number) => `${listboxId}-opt-${index}`, [listboxId]);

  const selectedDef = TINT_COLORS[selected];

  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger after closing (spec requirement).
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const commit = useCallback(
    (next: TintColor) => {
      if (next !== selected) onChange(next);
      closeAndRefocus();
    },
    [selected, onChange, closeAndRefocus],
  );

  // When opening, sync the active option to the current selection.
  const openPopover = useCallback(() => {
    setActiveIndex(Math.max(0, TINT_COLOR_ORDER.indexOf(selected)));
    setOpen(true);
  }, [selected]);

  // Move focus into the list when it opens so arrow keys are captured.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => listRef.current?.focus());
    }
  }, [open]);

  // Close on outside click (mousedown so it beats the trigger's onClick).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          openPopover();
          break;
        default:
          break;
      }
    },
    [openPopover],
  );

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLUListElement>) => {
      const last = TINT_COLOR_ORDER.length - 1;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i >= last ? 0 : i + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i <= 0 ? last : i - 1));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(last);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          commit(TINT_COLOR_ORDER[activeIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          closeAndRefocus();
          break;
        case 'Tab':
          // Let focus leave naturally, but close the popover.
          setOpen(false);
          break;
        default:
          break;
      }
    },
    [activeIndex, commit, closeAndRefocus],
  );

  return (
    <div ref={rootRef} className="tint-picker" data-platform={platform}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="tint-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPopover())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span
          className="tint-dot"
          style={{ backgroundColor: selectedDef.dot }}
          aria-hidden="true"
        />
        <span className="tint-picker-value">{selectedDef.name}</span>
        <span className="tint-picker-chevron-box" aria-hidden="true">
          <ChevronsUpDown className="tint-picker-chevron" size={14} />
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          className="tint-picker-popover"
          role="listbox"
          aria-label="Tint color"
          aria-activedescendant={optionId(activeIndex)}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
        >
          {TINT_COLOR_ORDER.map((id, index) => {
            const def = TINT_COLORS[id];
            const isSelected = id === selected;
            const isActive = index === activeIndex;
            return (
              <li
                key={id}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                className={`tint-option${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(id)}
              >
                <span
                  className="tint-dot"
                  style={{ backgroundColor: def.dot }}
                  aria-hidden="true"
                />
                <span className="tint-option-name">{def.name}</span>
                {isSelected && <Check className="tint-option-check" size={16} aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default TintColorPicker;
