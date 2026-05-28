import { ipcMain } from 'electron';

import { getAdvancedLogger } from '../lazy';
import type { Context } from './shared';
import { SystemPromptLlmWriter } from "../../lib/llm/systemPromptLlmWritter";
import { McpConfigLlmFormatter } from "../../lib/llm/mcpConfigLlmFormatter";
import { ChatSessionTitleLlmSummarizer } from "../../lib/llm/chatSessionTitleLlmSummarizer";
import { FileNameLlmGenerator } from "../../lib/llm/fileNameLlmGenerator";
import { DocumentSummaryLlmGenerator } from "../../lib/llm/documentSummaryLlmGenerator";
import { ensureModelsReady, getAllModels, getAllOpenKosmosUsedModels, getModelById, getModelCapabilities, validateModelId, getDefaultModel, isReasoningModel } from "../../lib/llm/ghcModelsManager";
import { providerManager, PROVIDER_TOKENIZER } from '../../lib/llm/provider';
import type { ProviderModel } from '../../lib/llm/provider';
import type { GhcCopilotModel } from '@shared/types/ghcChatTypes';

/**
 * Convert a ProviderModel to the GhcCopilotModel shape the renderer expects.
 * This adapter lets the existing ModelSelector and chat pipeline consume models
 * from any provider without changing their interface contracts.
 */
function providerModelToGhcFormat(m: ProviderModel): GhcCopilotModel {
  const tokenizer = PROVIDER_TOKENIZER[m.providerId] || 'cl100k_base';
  // Only build numeric limits when the source values exist. Computing
  // `maxContextTokens - (maxOutputTokens || 4096)` against an undefined
  // context window produces NaN, which silently corrupts the renderer's
  // token-budget logic (compression triggers, context-overflow recovery).
  const limits: Record<string, number> = {};
  if (typeof m.maxContextTokens === 'number') {
    limits.max_context_window_tokens = m.maxContextTokens;
    if (typeof m.maxOutputTokens === 'number') {
      const prompt = m.maxContextTokens - m.maxOutputTokens;
      if (prompt > 0) limits.max_prompt_tokens = prompt;
    } else {
      // Conservative: assume prompt budget ≈ context window minus a small reserve
      limits.max_prompt_tokens = m.maxContextTokens;
    }
  }
  if (typeof m.maxOutputTokens === 'number') {
    limits.max_output_tokens = m.maxOutputTokens;
  }

  return {
    id: m.id,
    name: m.name || m.id,
    object: 'model',
    version: '1.0',
    vendor: m.providerId,
    preview: false,
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: true,
    model_picker_category: 'versatile',
    billing: { is_premium: false, multiplier: 1 },
    supported_endpoints: ['/chat/completions'],
    capabilities: {
      family: m.providerId,
      object: 'model_capabilities',
      type: 'chat',
      tokenizer,
      limits,
      supports: {
        streaming: m.supportsStreaming,
        tool_calls: m.supportsTools,
        vision: m.supportsImages,
        parallel_tool_calls: false,
        structured_outputs: false,
      },
    },
  };
}

/** Check if the active provider is non-Copilot (API-key-based). Awaits init. */
async function isNonCopilotActive(): Promise<boolean> {
  await providerManager.waitUntilReady();
  return providerManager.getActiveProviderId() !== 'copilot';
}

export default function(ctx: Context) {

  // ===============================
  // LLM related IPC handlers
  // ===============================

  // System Prompt optimization
  ipcMain.handle('llm:improveSystemPrompt', async (event, userInputPrompt: string) => {
    try {
      const result = await SystemPromptLlmWriter.improveSystemPrompt(userInputPrompt);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // MCP config formatting
  ipcMain.handle('llm:formatMcpConfig', async (event, userInputMcpConfig: string) => {
    try {
      const result = await McpConfigLlmFormatter.formatMcpConfig(userInputMcpConfig);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Chat session title generation
  ipcMain.handle('llm:generateChatTitle', async (event, userMessage: string) => {
    try {
      const result = await ChatSessionTitleLlmSummarizer.generateTitle(userMessage);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // File name generation (auto-generate file name and extension based on content)
  ipcMain.handle('llm:generateFileName', async (event, content: string) => {
    try {
      const result = await FileNameLlmGenerator.generateFileName(content);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Document summary generation (generate LLM summary from extracted document text content)
  ipcMain.handle('llm:generateDocumentSummary', async (event, fileName: string, content: string, truncated: boolean = false) => {
    const logger = getAdvancedLogger();
    const startTime = Date.now();
    logger.info(`[DocSummary] IPC request — fileName="${fileName}", contentLength=${content?.length ?? 0}, truncated=${truncated}`, 'llm:generateDocumentSummary');
    try {
      const result = await DocumentSummaryLlmGenerator.generateSummary(fileName, content, truncated);
      const durationMs = Date.now() - startTime;
      if (result.success) {
        logger.info(`[DocSummary] IPC success — fileName="${fileName}", summaryLength=${result.summary?.length ?? 0}, summary="${(result.summary || '').substring(0, 120)}${(result.summary?.length ?? 0) > 120 ? '...' : ''}", duration=${durationMs}ms`, 'llm:generateDocumentSummary');
      } else {
        logger.warn(`[DocSummary] IPC generation failed — fileName="${fileName}", warnings=${JSON.stringify(result.warnings)}, errors=${JSON.stringify(result.errors)}, duration=${durationMs}ms`, 'llm:generateDocumentSummary');
      }
      return { success: true, data: result };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[DocSummary] IPC error — fileName="${fileName}", error="${errorMsg}", duration=${durationMs}ms`, 'llm:generateDocumentSummary');
      return { success: false, error: errorMsg };
    }
  });


  // ===============================
  // Models related IPC handlers
  // ===============================

  // Get all models (Copilot or active provider)
  ipcMain.handle('models:getAllModels', async () => {
    try {
      if (await isNonCopilotActive()) {
        const models = await providerManager.listModels();
        return { success: true, data: models.map(providerModelToGhcFormat) };
      }
      await ensureModelsReady();
      const models = getAllModels();
      return { success: true, data: models };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get list of models used by OpenKosmos (or all models from active provider)
  ipcMain.handle('models:getAllOpenKosmosUsedModels', async () => {
    try {
      if (await isNonCopilotActive()) {
        const models = await providerManager.listModels();
        return { success: true, data: models.map(providerModelToGhcFormat) };
      }
      await ensureModelsReady();
      const models = getAllOpenKosmosUsedModels();
      return { success: true, data: models };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get a single model by ID
  ipcMain.handle('models:getModelById', async (event, modelId: string) => {
    try {
      if (await isNonCopilotActive()) {
        const models = await providerManager.listModels();
        const found = models.find(m => m.id === modelId);
        return { success: true, data: found ? providerModelToGhcFormat(found) : null };
      }
      await ensureModelsReady();
      const model = getModelById(modelId);
      return { success: true, data: model };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get model capability information
  ipcMain.handle('models:getModelCapabilities', async (event, modelId: string) => {
    try {
      if (await isNonCopilotActive()) {
        const models = await providerManager.listModels();
        const found = models.find(m => m.id === modelId);
        if (found) {
          const ghc = providerModelToGhcFormat(found);
          return { success: true, data: ghc.capabilities };
        }
        // Return reasonable defaults for unknown models
        const defaultTokenizer = PROVIDER_TOKENIZER[providerManager.getActiveProviderId()] || 'cl100k_base';
        return {
          success: true,
          data: {
            family: 'unknown',
            object: 'model_capabilities',
            type: 'chat',
            tokenizer: defaultTokenizer,
            limits: { max_output_tokens: 4096 },
            supports: { streaming: true, tool_calls: true, vision: false },
          },
        };
      }
      await ensureModelsReady();
      const capabilities = getModelCapabilities(modelId);
      return { success: true, data: capabilities };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Validate whether model ID is valid
  ipcMain.handle('models:validateModelId', async (event, modelId: string) => {
    try {
      if (await isNonCopilotActive()) {
        const provider = providerManager.getActiveProvider();
        const isValid = await provider.validateModel(modelId);
        return { success: true, data: isValid };
      }
      await ensureModelsReady();
      const isValid = validateModelId(modelId);
      return { success: true, data: isValid };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get default model ID
  ipcMain.handle('models:getDefaultModel', async () => {
    try {
      if (await isNonCopilotActive()) {
        // For non-Copilot providers, return the first available model
        const models = await providerManager.listModels();
        return { success: true, data: models.length > 0 ? models[0].id : 'gpt-4o' };
      }
      const defaultModel = getDefaultModel();
      return { success: true, data: defaultModel };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Determine if it is a reasoning model
  ipcMain.handle('models:isReasoningModel', async (event, modelId: string) => {
    try {
      if (await isNonCopilotActive()) {
        // Heuristic for non-Copilot providers
        const id = modelId.toLowerCase();
        const isReasoning = /^o\d/.test(id) || id.includes('reasoner') || id.includes('deepseek-r');
        return { success: true, data: isReasoning };
      }
      await ensureModelsReady();
      const isReasoning = isReasoningModel(modelId);
      return { success: true, data: isReasoning };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
