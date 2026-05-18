/**
 * Unit tests for TerminalInstance.prepareCommand() on macOS / zsh.
 *
 * Regression coverage for the MCP "Process exited with code 127" failure where
 * a stdio MCP server with an absolute command path containing a space (e.g.
 * `/Users/.../Library/Application Support/.../uv`) was being split on the
 * first space by parseCommandString and then handed to zsh unquoted, causing:
 *
 *   zsh:10: no such file or directory: /Users/.../Library/Application
 *
 * The fix has two parts (TerminalInstance.ts → prepareCommand):
 *   1. When args are provided separately (always true for MCP transport),
 *      treat `command` as the full executable path — do NOT call
 *      parseCommandString (which would split it on the first space).
 *   2. Quote executable paths that contain spaces on ALL platforms, not just
 *      Windows.
 */

// Mock electron app before any imports
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/Users/test/Library/Application Support/test-app'),
    getName: jest.fn().mockReturnValue('test-app'),
    isReady: jest.fn().mockReturnValue(true),
    on: jest.fn(),
    whenReady: jest.fn().mockResolvedValue(undefined),
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
}));

// Mock RuntimeManager (system mode → no bin shim injection in createShellWrapper)
jest.mock('../../runtime/RuntimeManager', () => ({
  runtimeManager: {
    getMode: jest.fn().mockReturnValue('system'),
    isInternal: jest.fn().mockReturnValue(false),
    getBinPath: jest.fn().mockReturnValue('/Users/test/Library/Application Support/test-app/bin'),
    resolveCommand: jest.fn((cmd: string) => cmd),
  },
}));

// Mock PlatformConfigManager to behave like darwin/zsh
jest.mock('../PlatformConfigManager', () => ({
  PlatformConfigManager: {
    getInstance: () => ({
      getShellProfile: (_shell?: string) => ({
        command: '/bin/zsh',
        args: ['-l', '-i'], // interactive shell → exercises createShellWrapper branch
        supportsPersistent: true,
      }),
      getDefaultShell: () => 'zsh',
      getConfig: () => ({
        shells: {
          zsh: { command: '/bin/zsh', args: ['-l', '-i'], supportsPersistent: true },
        },
        defaultShell: 'zsh',
        pathSeparator: ':',
        executableExtensions: [''],
      }),
      untildify: (p: string) => p,
    }),
  },
}));

import { TerminalInstance } from '../TerminalInstance';
import { TerminalConfig } from '../types';

class TestableTerminalInstance extends TerminalInstance {
  public async testPrepareCommand(): Promise<{ executable: string; args: string[]; shell: boolean }> {
    return (this as any).prepareCommand('');
  }
}

function createMcpConfig(command: string, args: string[]): TerminalConfig {
  return {
    command,
    args,
    cwd: '/Users/test',
    type: 'mcp_transport',
    shell: 'zsh',
    persistent: true,
  };
}

describe('TerminalInstance.prepareCommand on macOS (zsh)', () => {
  const originalPlatform = process.platform;

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('MCP stdio server with absolute path containing a space', () => {
    // Real-world failing config from a user's research-mcp server.
    const command = '/Users/michaelfei_0/Library/Application Support/investment-studio-app/bin/uv';
    const args = [
      '--directory',
      '/Users/michaelfei_0/Workspace/Trade/investment-studio-folder',
      'run',
      '-m',
      'research_mcp',
    ];

    it('should NOT split the executable path at the space in "Application Support"', async () => {
      const instance = new TestableTerminalInstance(createMcpConfig(command, args));

      const result = await instance.testPrepareCommand();

      // Final element of args is the wrapped script passed to `zsh -c`.
      const wrapperScript = result.args[result.args.length - 1];

      // BUG REGRESSION: must not contain a bare truncated path on its own.
      expect(wrapperScript).not.toMatch(/(^|\s)\/Users\/michaelfei_0\/Library\/Application\s+Support\/[^\s"']/);

      // The full executable path must appear quoted as a single token.
      expect(wrapperScript).toContain('"/Users/michaelfei_0/Library/Application Support/investment-studio-app/bin/uv"');
    });

    it('should preserve the args array in order after the quoted executable', async () => {
      const instance = new TestableTerminalInstance(createMcpConfig(command, args));

      const result = await instance.testPrepareCommand();
      const wrapperScript = result.args[result.args.length - 1];

      // Executable + each arg should appear in order on the last line of the wrapper.
      const lines = wrapperScript.split('\n');
      const lastLine = lines[lines.length - 1];

      expect(lastLine).toBe(
        '"/Users/michaelfei_0/Library/Application Support/investment-studio-app/bin/uv" --directory /Users/michaelfei_0/Workspace/Trade/investment-studio-folder run -m research_mcp'
      );
    });

    it('should spawn /bin/zsh -c (not -i) and not request shell:true', async () => {
      const instance = new TestableTerminalInstance(createMcpConfig(command, args));

      const result = await instance.testPrepareCommand();

      expect(result.executable).toBe('/bin/zsh');
      expect(result.args.slice(0, -1)).toEqual(['-l', '-c']); // -i removed, -c added
      expect(result.shell).toBe(false);
    });
  });

  describe('MCP stdio server with simple command (no spaces)', () => {
    it('should not add quotes around plain command names like "uvx"', async () => {
      const instance = new TestableTerminalInstance(createMcpConfig('uvx', ['some-mcp-server']));

      const result = await instance.testPrepareCommand();
      const wrapperScript = result.args[result.args.length - 1];
      const lastLine = wrapperScript.split('\n').pop()!;

      expect(lastLine).toBe('uvx some-mcp-server');
    });
  });

  describe('args containing spaces (independent of executable)', () => {
    it('should quote args with spaces and keep the executable quoted', async () => {
      const instance = new TestableTerminalInstance(
        createMcpConfig('/Users/me/Library/Application Support/app/bin/uv', [
          '--config',
          '/Users/me/My Documents/research.toml',
        ])
      );

      const result = await instance.testPrepareCommand();
      const lastLine = result.args[result.args.length - 1].split('\n').pop()!;

      expect(lastLine).toBe(
        '"/Users/me/Library/Application Support/app/bin/uv" --config "/Users/me/My Documents/research.toml"'
      );
    });
  });

  describe('command already pre-quoted by caller', () => {
    it('should not double-quote a command that is already wrapped in quotes', async () => {
      const instance = new TestableTerminalInstance(
        createMcpConfig('"/Users/me/Library/Application Support/app/bin/uv"', ['run', '-m', 'mcp'])
      );

      const result = await instance.testPrepareCommand();
      const lastLine = result.args[result.args.length - 1].split('\n').pop()!;

      // Single set of quotes — no `""..""`.
      expect(lastLine).toBe(
        '"/Users/me/Library/Application Support/app/bin/uv" run -m mcp'
      );
    });
  });
});
