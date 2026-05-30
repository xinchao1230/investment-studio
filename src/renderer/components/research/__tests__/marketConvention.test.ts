import { describe, it, expect } from 'vitest';
import {
  resolveMarketConvention,
  classifyDelta,
  deltaClassName,
} from '../marketConvention';

describe('resolveMarketConvention', () => {
  it('treats .SZ / .SH / .HK as CN convention (up=red)', () => {
    expect(resolveMarketConvention('宁德时代.SZ')).toBe('cn');
    expect(resolveMarketConvention('贵州茅台.SH')).toBe('cn');
    expect(resolveMarketConvention('Trip.com.HK')).toBe('cn');
  });

  it('treats US / unknown suffix as US convention (up=green)', () => {
    expect(resolveMarketConvention('AAPL.US')).toBe('us');
    expect(resolveMarketConvention('NVDA')).toBe('us');
    expect(resolveMarketConvention('')).toBe('us');
    expect(resolveMarketConvention(undefined)).toBe('us');
  });
});

describe('classifyDelta', () => {
  it('detects positive deltas', () => {
    expect(classifyDelta('+16% YoY')).toBe('up');
    expect(classifyDelta('+7%')).toBe('up');
    expect(classifyDelta('12.5%')).toBe('up');
    expect(classifyDelta('  +7%  ')).toBe('up'); // surrounding whitespace tolerated
    expect(classifyDelta('-5% QoQ')).toBe('down'); // short unit annotation allowed
  });

  it('returns null for prose that merely contains a percent', () => {
    // The cell must BE a delta token, not just mention one — otherwise
    // ordinary table prose gets miscolored red/green.
    expect(classifyDelta('margin 12%, up')).toBeNull();
    expect(classifyDelta('12% of revenue')).toBeNull();
    expect(classifyDelta('+16% YoY growth')).toBeNull(); // trailing prose, not a unit
    expect(classifyDelta('up 5% on the year')).toBeNull();
    expect(classifyDelta('gross margin 45.2%')).toBeNull();
  });

  it('detects negative deltas', () => {
    expect(classifyDelta('-5%')).toBe('down');
    expect(classifyDelta('−3.2%')).toBe('down');
  });

  it('returns null for non-delta text', () => {
    expect(classifyDelta('稳定')).toBeNull();
    expect(classifyDelta('已完成')).toBeNull();
    expect(classifyDelta('410亿港元')).toBeNull();
    expect(classifyDelta('')).toBeNull();
  });
});

describe('deltaClassName', () => {
  it('CN: up class / down class', () => {
    expect(deltaClassName('up', 'cn')).toBe('rw-delta-up');
    expect(deltaClassName('down', 'cn')).toBe('rw-delta-down');
  });

  it('US: flipped color variants', () => {
    expect(deltaClassName('up', 'us')).toBe('rw-delta-up-us');
    expect(deltaClassName('down', 'us')).toBe('rw-delta-down-us');
  });
});
