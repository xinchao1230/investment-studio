// src/main/startup/ipc/provider.ts
/**
 * IPC handlers for the multi-provider LLM abstraction layer.
 *
 * Channels:
 *   provider:getAll           — list all registered providers with their info
 *   provider:getActive        — get the currently active provider ID
 *   provider:switch           — switch the active provider
 *   provider:getConfig        — get config for a specific provider
 *   provider:updateConfig     — update config for a specific provider
 *   provider:testConnection   — test connectivity for a provider
 *   provider:listModels       — list models from a specific provider
 *   provider:openConfigFile   — open the raw provider-config.json file
 *   provider:hasApiKeyProvider — check if any API-key provider is configured
 *   provider:isActiveProviderUsable — check if the active provider is usable now
 */

import { ipcMain, shell } from 'electron';
import type { Context } from './shared';
import { providerManager, type ProviderId, type ProviderConfig } from '../../lib/llm/provider';

export default function handleProviderIPC(ctx: Context) {

  // Get info for all registered providers
  ipcMain.handle('provider:getAll', async () => {
    try {
      const infos = providerManager.getAllProviderInfos();
      return { success: true, data: infos };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get the active provider ID
  ipcMain.handle('provider:getActive', async () => {
    try {
      await providerManager.waitUntilReady();
      const activeId = providerManager.getActiveProviderId();
      return { success: true, data: activeId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Switch the active provider
  ipcMain.handle('provider:switch', async (_event, targetId: ProviderId) => {
    try {
      const result = await providerManager.switchProvider(targetId);
      return result; // Already { success, error? }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get config for a specific provider
  ipcMain.handle('provider:getConfig', async (_event, id: ProviderId) => {
    try {
      await providerManager.waitUntilReady();
      const config = providerManager.getProviderConfig(id);
      // Strip encrypted API key from the response. Keep rawModels so Settings can
      // show the user exactly what the latest model-listing API returned.
      const safeConfig = config ? { ...config, apiKey: config.apiKey ? '••••••••' : undefined } : undefined;
      return { success: true, data: safeConfig };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('provider:openConfigFile', async () => {
    try {
      await providerManager.waitUntilReady();
      const filePath = await providerManager.ensureConfigFile();
      const error = await shell.openPath(filePath);
      if (error) {
        return { success: false, filePath, error };
      }
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Update config for a specific provider (API key, base URL, etc.)
  ipcMain.handle('provider:updateConfig', async (_event, id: ProviderId, updates: Partial<ProviderConfig>) => {
    try {
      const result = await providerManager.updateProviderConfig(id, updates);
      return result; // Already { success, error? }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Test connection for a specific provider (or active if omitted)
  ipcMain.handle('provider:testConnection', async (_event, id?: ProviderId) => {
    try {
      const result = await providerManager.testConnection(id);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // List models from a specific provider (or active if omitted)
  ipcMain.handle('provider:listModels', async (_event, id?: ProviderId) => {
    try {
      let models;
      if (id) {
        const provider = providerManager.getProvider(id);
        if (!provider) {
          return { success: false, error: `Provider ${id} not found` };
        }
        models = await provider.listModels();
      } else {
        models = await providerManager.listModels();
      }
      // Strip raw metadata to reduce IPC payload size
      const cleaned = models.map(({ raw, ...rest }) => rest);
      return { success: true, data: cleaned };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Check if any API-key-based provider is enabled (for skip-login detection).
  // Must NEVER throw — this is a probe used by the sign-in screen to decide
  // whether to enable the "Skip Login" button before the user is signed in.
  ipcMain.handle('provider:hasApiKeyProvider', async () => {
    try {
      if (!ctx.currentUserAlias) {
        // Load the _local profile config without triggering the throw-on-missing
        // path inside initializeForSkipLogin(). We deliberately do not propagate
        // errors here: a missing provider should answer "false", not crash.
        try {
          await providerManager.loadConfigForProbe();
        } catch {
          return { success: true, data: false };
        }
      } else {
        await providerManager.waitUntilReady();
      }
      const has = providerManager.hasApiKeyProvider();
      return { success: true, data: has };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Whether the ACTIVE provider is usable right now (non-Copilot, enabled, and
  // credential-ready). Backs the Settings "Back to workspace" enable gate, which
  // must stay disabled when the active pointer is stale (e.g. aimed at a provider
  // the user has since disabled). Must NEVER throw — it gates a UI button.
  ipcMain.handle('provider:isActiveProviderUsable', async () => {
    try {
      if (!ctx.currentUserAlias) {
        try {
          await providerManager.loadConfigForProbe();
        } catch {
          return { success: true, data: false };
        }
      } else {
        await providerManager.waitUntilReady();
      }
      const usable = providerManager.isActiveProviderUsable();
      return { success: true, data: usable };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
