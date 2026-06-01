/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyTintColor,
  normalizeTintColor,
  getTintColorDefinition,
  TINT_COLORS,
  TINT_COLOR_ORDER,
  DEFAULT_TINT_COLOR,
} from '../tintColor';

describe('tintColor module', () => {
  beforeEach(() => {
    // Clean slate: strip any tokens a previous test wrote onto <html>.
    const el = document.documentElement;
    [
      '--si-gold',
      '--si-accent-strong',
      '--si-accent-soft',
      '--si-accent-hover',
      '--si-accent-active',
      '--app-tint-color',
      '--app-tint-color-rgb',
      '--app-tint-color-muted',
      '--app-tint-color-bg',
      '--app-focus-ring-color',
    ].forEach((t) => el.style.removeProperty(t));
  });

  it('has a definition for every ordered id', () => {
    for (const id of TINT_COLOR_ORDER) {
      expect(TINT_COLORS[id]).toBeTruthy();
      expect(TINT_COLORS[id].name).toBeTruthy();
      expect(TINT_COLORS[id].dot).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('default tint is "default" with a null ramp (no override)', () => {
    expect(DEFAULT_TINT_COLOR).toBe('default');
    expect(TINT_COLORS.default.ramp).toBeNull();
  });

  it('normalizeTintColor falls back to default for unknown values', () => {
    expect(normalizeTintColor('blue')).toBe('blue');
    expect(normalizeTintColor('not-a-color')).toBe('default');
    expect(normalizeTintColor(undefined)).toBe('default');
    expect(normalizeTintColor(123)).toBe('default');
  });

  it('getTintColorDefinition returns a safe definition', () => {
    expect(getTintColorDefinition('purple').id).toBe('purple');
    expect(getTintColorDefinition('garbage').id).toBe('default');
  });

  it('applyTintColor writes the five accent tokens for a real tint', () => {
    applyTintColor('blue');
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--si-gold')).toBe('#3A78B5');
    expect(s.getPropertyValue('--si-accent-strong')).toBe('#306294');
    expect(s.getPropertyValue('--si-accent-soft')).toBe('#E7EFF6');
    expect(s.getPropertyValue('--si-accent-hover')).toBe('#D4E1EF');
    expect(s.getPropertyValue('--si-accent-active')).toBe('#BCD1E6');
  });

  it('applyTintColor publishes app-level aliases including an rgb triple', () => {
    applyTintColor('blue');
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--app-tint-color')).toBe('#3A78B5');
    expect(s.getPropertyValue('--app-tint-color-rgb')).toBe('58, 120, 181');
    expect(s.getPropertyValue('--app-focus-ring-color')).toBe('#3A78B5');
  });

  it('includes the red tint with its ramp', () => {
    expect(TINT_COLOR_ORDER).toContain('red');
    expect(normalizeTintColor('red')).toBe('red');
    applyTintColor('red');
    expect(document.documentElement.style.getPropertyValue('--si-gold')).toBe('#F5341F');
  });

  it('applyTintColor("default") clears any previous override', () => {    applyTintColor('green');
    expect(document.documentElement.style.getPropertyValue('--si-gold')).toBe('#00BA7C');
    applyTintColor('default');
    // Cleared, so the inline override is gone and the CSS file value shows through.
    expect(document.documentElement.style.getPropertyValue('--si-gold')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--app-tint-color')).toBe('');
  });
});
