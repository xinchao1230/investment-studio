import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

// Stage a temp dir that mimics the bundled resources layout so the registry's
// candidate ladder finds AGENT.md via the resourcesPath fallback.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-agent-reg-'));
const fakeAppPath = path.join(tempRoot, 'app');
const fakeResources = path.join(tempRoot, 'resources');
fs.mkdirSync(fakeAppPath, { recursive: true });
fs.mkdirSync(path.join(fakeResources, 'examples', 'agents'), { recursive: true });

function writeAgentMd(name: string, body: string): void {
  const dir = path.join(fakeResources, 'examples', 'agents', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENT.md'), body, 'utf-8');
}

vi.mock('electron', () => ({
  app: { getAppPath: () => fakeAppPath, getPath: () => fakeAppPath },
}));

// Override process.resourcesPath so the registry's fallback ladder finds the
// staged AGENT.md files under <fakeResources>/examples/agents/<name>. Restored
// in afterAll to avoid leaking into other test files.
const originalResourcesPath = (process as any).resourcesPath;
(process as any).resourcesPath = fakeResources;

// Force a brand that has known built-in agent names. Restored in afterAll so
// that other test files run under their default brand.
const originalBrand = process.env.BRAND_NAME;
process.env.BRAND_NAME = 'investment-studio';

writeAgentMd(
  'market-researcher',
  `---\nname: market-researcher\ndescription: Stub for unit tests\n---\n\nBody.`,
);
writeAgentMd(
  'kyc-screener',
  `---\nname: kyc-screener\ndescription: Stub for unit tests\n---\n\nBody.`,
);

import { BuiltinAgentRegistry } from '../builtinAgentRegistry';

describe('BuiltinAgentRegistry', () => {
  beforeEach(() => {
    BuiltinAgentRegistry.resetForTests();
  });

  it('loads built-in agents from the staged resources directory', () => {
    const list = BuiltinAgentRegistry.getInstance().list('investment-studio');
    const names = list.map(a => a.name);
    expect(names).toContain('market-researcher');
    expect(names).toContain('kyc-screener');
  });

  it('marks loaded agents with source="BUILTIN"', () => {
    const list = BuiltinAgentRegistry.getInstance().list('investment-studio');
    for (const cfg of list) {
      expect(cfg.source).toBe('BUILTIN');
    }
  });

  it('returns an empty list for brands with no built-ins', () => {
    const list = BuiltinAgentRegistry.getInstance().list('openkosmos');
    expect(list).toEqual([]);
  });

  it('has() reserves every name across known brands, regardless of disk presence', () => {
    const reg = BuiltinAgentRegistry.getInstance();
    expect(reg.has('market-researcher')).toBe(true);
    expect(reg.has('model-builder')).toBe(true);
    expect(reg.has('kyc-screener')).toBe(true);
    expect(reg.has('totally-made-up-agent')).toBe(false);
  });

  it('get() returns the cached config for an existing built-in', () => {
    const cfg = BuiltinAgentRegistry.getInstance().get('market-researcher', 'investment-studio');
    expect(cfg).toBeDefined();
    expect(cfg?.name).toBe('market-researcher');
  });

  it('get() returns undefined for unknown names', () => {
    const cfg = BuiltinAgentRegistry.getInstance().get('does-not-exist', 'investment-studio');
    expect(cfg).toBeUndefined();
  });

  it('resolveAgentFile() returns an absolute AGENT.md path for staged built-ins', () => {
    const file = BuiltinAgentRegistry.getInstance().resolveAgentFile('market-researcher');
    expect(file).not.toBeNull();
    expect(file!.endsWith(path.join('market-researcher', 'AGENT.md'))).toBe(true);
    expect(fs.existsSync(file!)).toBe(true);
  });

  it('resolveAgentFile() returns null for non-built-in names', () => {
    expect(BuiltinAgentRegistry.getInstance().resolveAgentFile('user-agent')).toBeNull();
  });
});

afterAll(() => {
  if (originalBrand === undefined) {
    delete process.env.BRAND_NAME;
  } else {
    process.env.BRAND_NAME = originalBrand;
  }
  if (originalResourcesPath === undefined) {
    delete (process as any).resourcesPath;
  } else {
    (process as any).resourcesPath = originalResourcesPath;
  }
});
