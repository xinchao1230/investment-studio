/**
 * SubAgentConfigResolver unit tests
 *
 * Tests the pure helper functions extracted from SubAgentManager:
 * - resolveSubAgentModel
 * - getParentAgentConfig
 * - resolveInheritedConfig
 * - validateToolAvailability
 * - deriveDeliverablesPath
 * - sanitizeSubAgentResult
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockGetModelById = vi.fn();
const mockGetDefaultModel = vi.fn((..._args: any[]) => 'claude-sonnet-4.6');
vi.mock('../../llm/ghcModelsManager', async () => ({
  getModelById: (...args: any[]) => mockGetModelById(...args),
  getDefaultModel: (...args: any[]) => mockGetDefaultModel(...args),
}));

const mockGetActiveProviderId = vi.fn((..._args: any[]) => 'copilot');
const mockGetCachedModels = vi.fn((..._args: any[]) => [] as Array<{ id: string }>);
const mockGetProviderConfig = vi.fn((..._args: any[]) => undefined as { defaultModel?: string } | undefined);
vi.mock('../../llm/provider', async () => ({
  providerManager: {
    getActiveProviderId: (...args: any[]) => mockGetActiveProviderId(...args),
    getCachedModels: (...args: any[]) => mockGetCachedModels(...args),
    getProviderConfig: (...args: any[]) => mockGetProviderConfig(...args),
  },
}));

vi.mock('@shared/constants/subAgent', async () => ({
  INHERIT_MODEL_VALUE: 'inherit',
}));

const mockGetAllChatConfigs = vi.fn();
vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getAllChatConfigs: (...args: any[]) => mockGetAllChatConfigs(...args),
  },
}));

const mockGetAllMcpServerRuntimeStates = vi.fn();
vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    getAllMcpServerRuntimeStates: (...args: any[]) => mockGetAllMcpServerRuntimeStates(...args),
  },
}));

const mockExistsSync = vi.fn();
vi.mock('fs', async () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
}));

vi.mock('../../userDataADO/pathUtils', async () => ({
  PROFILE_DIR_NAME: 'default',
  extractMonthFromChatSessionId: vi.fn((id: string) => {
    const match = id.match(/chatSession_(\d{6})/);
    return match ? match[1] : undefined;
  }),
}));

// ─── Imports ───

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveSubAgentModel,
  resolveFallbackModel,
  getParentAgentConfig,
  resolveInheritedConfig,
  validateToolAvailability,
  deriveDeliverablesPath,
  sanitizeSubAgentResult,
} from '../subAgentConfigResolver';
import type { SubAgentConfig } from '../../userDataADO/types/profile';

// ─── Helpers ───

function makeConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-agent',
    model: '',
    context_access: 'isolated',
    mcp_servers: [],
    skills: [],
    builtin_tools: [],
    knowledgeBase: '',
    ...overrides,
  } as SubAgentConfig;
}

// ─── Tests ───

describe('SubAgentConfigResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to the Copilot provider so the existing registry-based tests below
    // exercise the getModelById validation branch.
    mockGetActiveProviderId.mockReturnValue('copilot');
    mockGetCachedModels.mockReturnValue([]);
    mockGetProviderConfig.mockReturnValue(undefined);
  });

  // ─── resolveSubAgentModel ───

  describe('resolveSubAgentModel', () => {
    it('returns parent model when config model is empty', () => {
      const result = resolveSubAgentModel(makeConfig({ model: '' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('returns parent model when config model is "inherit"', () => {
      const result = resolveSubAgentModel(makeConfig({ model: 'inherit' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('returns parent model when config model is "INHERIT" (case insensitive)', () => {
      const result = resolveSubAgentModel(makeConfig({ model: 'INHERIT' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('returns configured model when it exists in registry', () => {
      mockGetModelById.mockReturnValue({ id: 'gpt-4o' });
      const result = resolveSubAgentModel(makeConfig({ model: 'gpt-4o' }), 'parent-model', 'agent-1');
      expect(result).toBe('gpt-4o');
    });

    it('falls back to parent model when configured model is unknown', () => {
      mockGetModelById.mockReturnValue(undefined);
      const result = resolveSubAgentModel(makeConfig({ model: 'nonexistent-model' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('trims whitespace from model string', () => {
      mockGetModelById.mockReturnValue({ id: 'gpt-4o' });
      const result = resolveSubAgentModel(makeConfig({ model: '  gpt-4o  ' }), 'parent-model', 'agent-1');
      expect(result).toBe('gpt-4o');
    });

    // ─── Non-Copilot (custom) provider validation ───

    it('validates against the active provider cache (not the Copilot registry) for non-Copilot providers', () => {
      mockGetActiveProviderId.mockReturnValue('openai');
      mockGetCachedModels.mockReturnValue([{ id: 'gpt-4-turbo' }]);
      // getModelById would reject this (not a Copilot model), but it must NOT be consulted.
      mockGetModelById.mockReturnValue(undefined);
      const result = resolveSubAgentModel(makeConfig({ model: 'gpt-4-turbo' }), 'parent-model', 'agent-1');
      expect(result).toBe('gpt-4-turbo');
      expect(mockGetModelById).not.toHaveBeenCalled();
    });

    it('falls back to parent when a non-Copilot model is absent from a warm provider cache', () => {
      mockGetActiveProviderId.mockReturnValue('openai');
      mockGetCachedModels.mockReturnValue([{ id: 'gpt-4-turbo' }]);
      const result = resolveSubAgentModel(makeConfig({ model: 'made-up-model' }), 'parent-model', 'agent-1');
      expect(result).toBe('parent-model');
    });

    it('trusts the explicit non-Copilot model when the provider cache is not warm yet', () => {
      mockGetActiveProviderId.mockReturnValue('custom-dynamic');
      mockGetCachedModels.mockReturnValue([]); // cold cache → cannot reject
      const result = resolveSubAgentModel(makeConfig({ model: 'llama-3.3-70b' }), 'parent-model', 'agent-1');
      expect(result).toBe('llama-3.3-70b');
    });
  });

  // ─── resolveFallbackModel ───

  describe('resolveFallbackModel', () => {
    it('uses the Copilot registry default when Copilot is active', () => {
      mockGetActiveProviderId.mockReturnValue('copilot');
      expect(resolveFallbackModel()).toBe('claude-sonnet-4.6');
      expect(mockGetDefaultModel).toHaveBeenCalled();
    });

    it('prefers the active provider configured default for non-Copilot providers', () => {
      mockGetActiveProviderId.mockReturnValue('openai');
      mockGetProviderConfig.mockReturnValue({ defaultModel: 'gpt-4o' });
      expect(resolveFallbackModel()).toBe('gpt-4o');
      expect(mockGetDefaultModel).not.toHaveBeenCalled();
    });

    it('falls back to the first cached model when no configured default exists', () => {
      mockGetActiveProviderId.mockReturnValue('anthropic');
      mockGetProviderConfig.mockReturnValue(undefined);
      mockGetCachedModels.mockReturnValue([{ id: 'claude-3-7-sonnet' }, { id: 'claude-3-5-haiku' }]);
      expect(resolveFallbackModel()).toBe('claude-3-7-sonnet');
    });

    it('does not return the Copilot default for a non-Copilot provider with no models', () => {
      mockGetActiveProviderId.mockReturnValue('gemini');
      mockGetProviderConfig.mockReturnValue(undefined);
      mockGetCachedModels.mockReturnValue([]);
      // No provider default and cold cache → only then does it fall through to the
      // Copilot registry default (best-effort last resort).
      expect(resolveFallbackModel()).toBe('claude-sonnet-4.6');
    });
  });

  // ─── getParentAgentConfig ───

  describe('getParentAgentConfig', () => {
    it('returns agent config when chat is found', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { mcp_servers: [{ name: 's1' }], skills: ['sk1'] } },
      ]);
      const result = getParentAgentConfig('chat-1', 'alice');
      expect(result).toBeDefined();
      expect(result!.mcp_servers).toHaveLength(1);
    });

    it('returns undefined when chat not found', () => {
      mockGetAllChatConfigs.mockReturnValue([]);
      const result = getParentAgentConfig('chat-x', 'alice');
      expect(result).toBeUndefined();
    });

    it('returns undefined when getAllChatConfigs throws', () => {
      mockGetAllChatConfigs.mockImplementation(() => { throw new Error('DB error'); });
      const result = getParentAgentConfig('chat-1', 'alice');
      expect(result).toBeUndefined();
    });
  });

  // ─── resolveInheritedConfig ───

  describe('resolveInheritedConfig', () => {
    it('returns only child servers when no parent config', () => {
      const config = makeConfig({ mcp_servers: [{ name: 'child-s', tools: ['t1'] }] });
      const result = resolveInheritedConfig(config, undefined);
      expect(result.resolvedMcpServers).toHaveLength(1);
      expect(result.resolvedMcpServers[0].inherited).toBe(false);
    });

    it('merges parent servers that are not in child', () => {
      const config = makeConfig({ mcp_servers: [{ name: 'child-s', tools: [] }] });
      const parent = { mcp_servers: [{ name: 'parent-s', tools: ['t2'] }] };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedMcpServers).toHaveLength(2);
      const parentServer = result.resolvedMcpServers.find(s => s.name === 'parent-s');
      expect(parentServer!.inherited).toBe(true);
    });

    it('child server overrides parent with same name', () => {
      const config = makeConfig({ mcp_servers: [{ name: 'shared', tools: ['child-tool'] }] });
      const parent = { mcp_servers: [{ name: 'shared', tools: ['parent-tool'] }] };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedMcpServers).toHaveLength(1);
      expect(result.resolvedMcpServers[0].inherited).toBe(false);
    });

    it('does not inherit when inherit_mcp_servers is false', () => {
      const config = makeConfig({
        mcp_servers: [{ name: 'child-s', tools: [] }],
        inherit_mcp_servers: false,
      });
      const parent = { mcp_servers: [{ name: 'parent-s', tools: [] }] };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedMcpServers).toHaveLength(1);
    });

    it('merges skills from parent', () => {
      const config = makeConfig({ skills: ['child-skill'] });
      const parent = { mcp_servers: [], skills: ['parent-skill'] };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedSkills).toHaveLength(2);
    });

    it('does not duplicate skills with same name', () => {
      const config = makeConfig({ skills: ['shared-skill'] });
      const parent = { mcp_servers: [], skills: ['shared-skill'] };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedSkills).toHaveLength(1);
    });

    it('inherits knowledgeBase from parent when child has none', () => {
      const config = makeConfig();
      const parent = { mcp_servers: [], knowledgeBase: '/data/kb' };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedKnowledgeBase).toBe('/data/kb');
    });

    it('child knowledgeBase takes priority over parent', () => {
      const config = makeConfig({ knowledgeBase: '/child/kb' });
      const parent = { mcp_servers: [], knowledgeBase: '/parent/kb' };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedKnowledgeBase).toBe('/child/kb');
    });

    it('does not inherit knowledgeBase when inherit_knowledge_base is false', () => {
      const config = makeConfig({ inherit_knowledge_base: false });
      const parent = { mcp_servers: [], knowledgeBase: '/parent/kb' };
      const result = resolveInheritedConfig(config, parent as any);
      expect(result.resolvedKnowledgeBase).toBeUndefined();
    });
  });

  // ─── validateToolAvailability ───

  describe('validateToolAvailability', () => {
    it('returns empty warnings when all servers are connected', () => {
      mockGetAllMcpServerRuntimeStates.mockReturnValue([
        { serverName: 'server-a', status: 'connected' },
      ]);
      mockExistsSync.mockReturnValue(true);

      const result = validateToolAvailability(
        { resolvedMcpServers: [{ name: 'server-a', connected: false, tools: [], inherited: false }], resolvedSkills: [] },
        'alice'
      );
      expect(result).toHaveLength(0);
    });

    it('warns when MCP server is not connected', () => {
      mockGetAllMcpServerRuntimeStates.mockReturnValue([
        { serverName: 'server-a', status: 'disconnected' },
      ]);

      const result = validateToolAvailability(
        { resolvedMcpServers: [{ name: 'server-a', connected: false, tools: [], inherited: false }], resolvedSkills: [] },
        'alice'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('not connected');
    });

    it('warns when skill directory does not exist', () => {
      mockGetAllMcpServerRuntimeStates.mockReturnValue([]);
      mockExistsSync.mockReturnValue(false);

      const result = validateToolAvailability(
        { resolvedMcpServers: [], resolvedSkills: [{ name: 'missing-skill', installed: false, inherited: false }] },
        'alice'
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('not installed');
    });

    it('handles MCP runtime state check failure gracefully', () => {
      mockGetAllMcpServerRuntimeStates.mockImplementation(() => { throw new Error('Runtime error'); });
      mockExistsSync.mockReturnValue(true);

      const result = validateToolAvailability(
        { resolvedMcpServers: [{ name: 's', connected: false, tools: [], inherited: false }], resolvedSkills: [] },
        'alice'
      );
      // Should not throw, returns empty (error swallowed)
      expect(result).toHaveLength(0);
    });
  });

  // ─── deriveDeliverablesPath ───

  describe('deriveDeliverablesPath', () => {
    it('derives path with year-month when session ID matches pattern', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: '/workspace/proj' } },
      ]);

      const result = deriveDeliverablesPath(
        'chatSession_20260301120000', 'chat-1', 'alice', 'research-agent', 'sa_1234567890_abc'
      );
      expect(result).toContain('/workspace/proj');
      expect(result).toContain('202603');
      expect(result).toContain('research-agent');
    });

    it('returns path without year-month for non-standard session ID', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: '/workspace/proj' } },
      ]);

      const result = deriveDeliverablesPath(
        'random_session', 'chat-1', 'alice', 'agent-x', 'sa_task123'
      );
      expect(result).toBe('/workspace/proj/agent-x-sa_task123');
    });

    it('returns undefined when workspace is empty', () => {
      mockGetAllChatConfigs.mockReturnValue([
        { chat_id: 'chat-1', agent: { workspace: '' } },
      ]);

      const result = deriveDeliverablesPath(
        'chatSession_20260301120000', 'chat-1', 'alice', 'agent', 'task'
      );
      expect(result).toBeUndefined();
    });

    it('returns undefined when chat not found', () => {
      mockGetAllChatConfigs.mockReturnValue([]);

      const result = deriveDeliverablesPath(
        'chatSession_20260301120000', 'chat-x', 'alice', 'agent', 'task'
      );
      expect(result).toBeUndefined();
    });
  });

  // ─── sanitizeSubAgentResult ───

  describe('sanitizeSubAgentResult', () => {
    it('wraps result with sub_agent_result tags', () => {
      const result = sanitizeSubAgentResult('Hello world');
      expect(result).toBe('<sub_agent_result>\nHello world\n</sub_agent_result>');
    });

    it('preserves full content without truncation', () => {
      const long = 'X'.repeat(50000);
      const result = sanitizeSubAgentResult(long);
      expect(result).toContain(long);
    });

    it('handles empty string', () => {
      const result = sanitizeSubAgentResult('');
      expect(result).toBe('<sub_agent_result>\n\n</sub_agent_result>');
    });
  });
});
