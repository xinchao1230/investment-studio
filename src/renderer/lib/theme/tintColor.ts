/**
 * App-level Tint (accent) color system.
 *
 * Single source of truth for the user-selectable accent color. The app's
 * entire accent surface resolves through five CSS tokens defined in
 * `editorial-theme.css` (`--si-gold` + the `--si-accent-*` ramp). To re-tint
 * the whole UI at runtime we override exactly those five tokens on
 * `document.documentElement`; every derived token (pills, warm surfaces,
 * native `accent-color`, selected nav rows) follows automatically via the
 * existing `color-mix` chain — see editorial-theme.css.
 *
 * We also publish a parallel set of `--app-tint-*` aliases so feature code can
 * reference the tint by an app-level name without coupling to the `--si-`
 * brand tokens.
 *
 * This module owns ALL color values. Do not hardcode tint hex values in
 * components — import from here.
 */

/** Stable persisted enum values. Never rename — these live in app.json. */
export type TintColor =
  | 'default'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'pink'
  | 'orange'
  | 'purple'
  | 'red';

/** Default selection. "Default" keeps the app's built-in brand accent. */
export const DEFAULT_TINT_COLOR: TintColor = 'default';

/** Ordered list driving the picker UI. */
export const TINT_COLOR_ORDER: TintColor[] = [
  'default',
  'blue',
  'green',
  'yellow',
  'pink',
  'orange',
  'purple',
  'red',
];

/**
 * Per-tint definition.
 *
 * - `base`    maps to `--si-gold`: text/icon/border/CTA accent.
 * - `strong`  maps to `--si-accent-strong`: deeper step for filled-CTA hover
 *             and white-on-fill legibility.
 * - `soft`/`hover`/`active` map to `--si-accent-soft/-hover/-active`: pale
 *             tints of the hue for fill states. These also drive the selected
 *             sidebar row and other accent-fill surfaces.
 * - `dot`     is the swatch color shown in the picker (usually === base, but
 *             neutral "Default" uses a representative gray dot while leaving the
 *             brand accent untouched).
 *
 * Soft/hover/active are precomputed (rather than color-mixed at runtime) so the
 * values are stable, inspectable, and apply identically on every engine.
 */
export interface TintColorDefinition {
  id: TintColor;
  name: string;
  /** Picker swatch dot. */
  dot: string;
  /**
   * The five accent tokens, in `--si-` terms. `null` for "default" means
   * "do not override — fall back to the brand accent baked into the CSS".
   */
  ramp: {
    base: string;
    strong: string;
    soft: string;
    hover: string;
    active: string;
  } | null;
}

/**
 * Central color map. The five-step ramps were generated from each base hue:
 * `strong` is base darkened ~18%, `soft` is base mixed ~12% into white,
 * `hover` ~22%, `active` ~34%. They mirror the relationship the brand accent
 * already encodes in editorial-theme.css.
 */
export const TINT_COLORS: Record<TintColor, TintColorDefinition> = {
  default: {
    id: 'default',
    name: 'Default',
    // The picker swatch previews the color this option actually produces.
    // "Default" keeps the built-in brand accent (`--si-gold` in
    // editorial-theme.css), so the dot uses that literal hex — NOT a neutral
    // gray, and NOT `var(--si-gold)` (which would mirror the currently-applied
    // tint instead of the default). Keep in sync with editorial-theme.css.
    dot: '#7a96c1',
    ramp: null,
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    // Muted slate blue, RGB(58,120,181).
    dot: '#3A78B5',
    ramp: {
      base: '#3A78B5',
      strong: '#306294',
      soft: '#E7EFF6',
      hover: '#D4E1EF',
      active: '#BCD1E6',
    },
  },
  green: {
    id: 'green',
    name: 'Green',
    // Emerald green, RGB(0,186,124).
    dot: '#00BA7C',
    ramp: {
      base: '#00BA7C',
      strong: '#009966',
      soft: '#E0F7EF',
      hover: '#C7F0E2',
      active: '#A8E8D2',
    },
  },
  yellow: {
    id: 'yellow',
    name: 'Yellow',
    // Yellow needs an unusually dark `strong` so white text on a filled CTA
    // stays legible against the bright base.
    dot: '#FFCC00',
    ramp: {
      base: '#FFCC00',
      strong: '#9A7B00',
      soft: '#FFF6D6',
      hover: '#FFEEAD',
      active: '#FFE176',
    },
  },
  pink: {
    id: 'pink',
    name: 'Pink',
    // A true pink (hue ~338deg). Apple's systemPink (#FF2D55) reads as red
    // next to the other swatches, so we lighten/shift it toward a clearer pink.
    dot: '#FF4F8B',
    ramp: {
      base: '#FF4F8B',
      strong: '#D1356E',
      soft: '#FFE6EF',
      hover: '#FFCFE0',
      active: '#FFAECB',
    },
  },
  orange: {
    id: 'orange',
    name: 'Orange',
    // Muted terracotta orange, RGB(216,117,85).
    dot: '#D87555',
    ramp: {
      base: '#D87555',
      strong: '#B16046',
      soft: '#FAEEEB',
      hover: '#F6E1DA',
      active: '#F2D0C5',
    },
  },
  purple: {
    id: 'purple',
    name: 'Purple',
    dot: '#AF52DE',
    ramp: {
      base: '#AF52DE',
      strong: '#8636B8',
      soft: '#F4E6FB',
      hover: '#E8CEF6',
      active: '#D7AEEF',
    },
  },
  red: {
    id: 'red',
    name: 'Red',
    // Pure vivid red — the "rise red" used in Chinese A-share tickers
    // (up = red), RGB(245,52,31). Warm, fully saturated; clearly separated
    // from Pink (hue ~340) so the two never read alike.
    dot: '#F5341F',
    ramp: {
      base: '#F5341F',
      strong: '#C92B19',
      soft: '#FEE7E4',
      hover: '#FDD2CE',
      active: '#FCBAB3',
    },
  },
};

/** Narrow an arbitrary persisted value back to a known TintColor. */
export function normalizeTintColor(value: unknown): TintColor {
  if (typeof value === 'string' && value in TINT_COLORS) {
    return value as TintColor;
  }
  return DEFAULT_TINT_COLOR;
}

/** Convenience accessor with safe fallback. */
export function getTintColorDefinition(value: unknown): TintColorDefinition {
  return TINT_COLORS[normalizeTintColor(value)];
}

/** Parse a `#rrggbb` string into an "r, g, b" triple for rgba() consumers. */
function hexToRgbTriple(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '0, 0, 0';
  const intValue = parseInt(m[1], 16);
  const r = (intValue >> 16) & 0xff;
  const g = (intValue >> 8) & 0xff;
  const b = intValue & 0xff;
  return `${r}, ${g}, ${b}`;
}

/** The five brand tokens we override. */
const SI_TOKENS = [
  '--si-gold',
  '--si-accent-strong',
  '--si-accent-soft',
  '--si-accent-hover',
  '--si-accent-active',
] as const;

/** The app-level aliases we publish alongside the brand tokens. */
const APP_ALIAS_TOKENS = [
  '--app-tint-color',
  '--app-tint-color-rgb',
  '--app-tint-color-muted',
  '--app-tint-color-bg',
  '--app-focus-ring-color',
] as const;

/**
 * Apply a tint color by writing CSS variables onto the given root element
 * (defaults to <html>). For "default" we clear our overrides so the values
 * baked into editorial-theme.css show through.
 *
 * Idempotent and cheap — safe to call on startup and on every selection.
 */
export function applyTintColor(
  tint: TintColor,
  root: HTMLElement = document.documentElement,
): void {
  const def = TINT_COLORS[normalizeTintColor(tint)];

  if (!def.ramp) {
    // "Default": remove every override so the brand accent (editorial-theme.css)
    // resolves. Clearing matters — otherwise switching back to Default would
    // leave a previous tint stuck on the root element.
    for (const token of [...SI_TOKENS, ...APP_ALIAS_TOKENS]) {
      root.style.removeProperty(token);
    }
    return;
  }

  const { base, strong, soft, hover, active } = def.ramp;

  // Override the five brand accent tokens — the whole accent surface (CTAs,
  // links, focus rings, pills, warm surfaces, native accent-color, selected
  // nav rows) resolves through these.
  root.style.setProperty('--si-gold', base);
  root.style.setProperty('--si-accent-strong', strong);
  root.style.setProperty('--si-accent-soft', soft);
  root.style.setProperty('--si-accent-hover', hover);
  root.style.setProperty('--si-accent-active', active);

  // Publish app-level aliases for feature code that prefers an app-scoped name.
  root.style.setProperty('--app-tint-color', base);
  root.style.setProperty('--app-tint-color-rgb', hexToRgbTriple(base));
  root.style.setProperty('--app-tint-color-muted', strong);
  root.style.setProperty('--app-tint-color-bg', soft);
  root.style.setProperty('--app-focus-ring-color', base);
}
