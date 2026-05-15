/**
 * KOSMOS Placeholder Variables Manager
 * 
 * Manages KOSMOS variable placeholder presets, value computation and replacement.
 * 
 * Placeholder format: @KOSMOS_[NAME]
 * - Starts with @KOSMOS_
 * - Composed of uppercase letters, underscores, and digits
 * 
 * Example:
 * @KOSMOS_PROFILE_WORKSPACES_FOLDER -> {KOSMOS app user data folder}/profiles/{alias}/chat_workspaces
 */

import * as path from 'path';
import * as os from 'os';
import { getUserDataPath } from './pathUtils';

/**
 * KOSMOS placeholder variable name enum
 */
export enum KosmosPlaceholder {
  /** Profile's chat_workspaces folder path */
  PROFILE_WORKSPACES_FOLDER = '@KOSMOS_PROFILE_WORKSPACES_FOLDER',
  /** Research MCP runtime directory */
  RESEARCH_RUNTIME_DIR = '@KOSMOS_RESEARCH_RUNTIME_DIR',
  /** Research MCP bundled resources directory */
  RESEARCH_RESOURCES_DIR = '@KOSMOS_RESEARCH_RESOURCES_DIR',
  /** Tushare API token for research MCP */
  RESEARCH_TUSHARE_TOKEN = '@KOSMOS_RESEARCH_TUSHARE_TOKEN',
  /** Research MCP user data directory */
  RESEARCH_USER_DATA_DIR = '@KOSMOS_RESEARCH_USER_DATA_DIR',
}

/**
 * Placeholder type: identifies the value type returned by the placeholder
 */
export enum PlaceholderType {
  /** File path or folder path */
  PATH = 'PATH',
  /** Plain string */
  STRING = 'STRING',
}

/**
 * Placeholder metadata: contains type information for the placeholder
 */
const PLACEHOLDER_METADATA: Record<string, { type: PlaceholderType }> = {
  [KosmosPlaceholder.PROFILE_WORKSPACES_FOLDER]: { type: PlaceholderType.PATH },
  [KosmosPlaceholder.RESEARCH_RUNTIME_DIR]: { type: PlaceholderType.PATH },
  [KosmosPlaceholder.RESEARCH_RESOURCES_DIR]: { type: PlaceholderType.PATH },
  [KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN]: { type: PlaceholderType.STRING },
  [KosmosPlaceholder.RESEARCH_USER_DATA_DIR]: { type: PlaceholderType.PATH },
};

/**
 * KOSMOS placeholder regex
 * Matches format: @KOSMOS_[A-Z0-9_]+
 */
export const KOSMOS_PLACEHOLDER_REGEX = /@KOSMOS_[A-Z0-9_]+/g;

/**
 * Check if a string contains KOSMOS placeholders
 */
export function containsKosmosPlaceholder(value: string): boolean {
  if (typeof value !== 'string') return false;
  return KOSMOS_PLACEHOLDER_REGEX.test(value);
}

/**
 * Get all KOSMOS placeholders in a string
 */
export function extractKosmosPlaceholders(value: string): string[] {
  if (typeof value !== 'string') return [];
  // Reset regex lastIndex
  KOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
  const matches = value.match(KOSMOS_PLACEHOLDER_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * KOSMOS Placeholder Manager
 * Responsible for parsing and replacing KOSMOS variable placeholders
 */
export class KosmosPlaceholderManager {
  private static instance: KosmosPlaceholderManager;
  
  private constructor() {}
  
  static getInstance(): KosmosPlaceholderManager {
    if (!KosmosPlaceholderManager.instance) {
      KosmosPlaceholderManager.instance = new KosmosPlaceholderManager();
    }
    return KosmosPlaceholderManager.instance;
  }
  
  /**
   * Get the actual value of a placeholder
   * @param placeholder Placeholder name, e.g. @KOSMOS_PROFILE_WORKSPACES_FOLDER
   * @param context Context information containing required parameters like alias
   */
  getPlaceholderValue(placeholder: string, context: { alias: string }): string | null {
    if (!context.alias) {
      console.error('[KosmosPlaceholderManager] Missing required context: alias');
      return null;
    }
    
    let value: string | null = null;
    
    switch (placeholder) {
      case KosmosPlaceholder.PROFILE_WORKSPACES_FOLDER:
        value = this.getProfileWorkspacesFolderPath(context.alias);
        break;
      case KosmosPlaceholder.RESEARCH_RUNTIME_DIR:
        value = this.getResearchRuntimeDir();
        break;
      case KosmosPlaceholder.RESEARCH_RESOURCES_DIR:
        value = this.getResearchResourcesDir();
        break;
      case KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN:
        value = this.getResearchTushareToken(context.alias);
        break;
      case KosmosPlaceholder.RESEARCH_USER_DATA_DIR:
        value = getUserDataPath();
        break;
      default:
        console.warn(`[KosmosPlaceholderManager] Unknown placeholder: ${placeholder}`);
        return null;
    }
    
    // If it's a path type, apply platform-specific formatting
    if (value !== null) {
      const metadata = PLACEHOLDER_METADATA[placeholder];
      if (metadata?.type === PlaceholderType.PATH) {
        value = this.formatPathForPlatform(value);
      }
    }
    
    return value;
  }
  
  /**
   * Format path based on the current operating system
   * - Windows: use backslashes \
   * - Mac/Linux: use forward slashes /
   */
  private formatPathForPlatform(filePath: string): string {
    const platform = os.platform();
    
    if (platform === 'win32') {
      // Windows: replace all forward slashes with backslashes
      return filePath.replace(/\//g, '\\');
    } else {
      // Mac/Linux: replace all backslashes with forward slashes
      return filePath.replace(/\\/g, '/');
    }
  }
  
  /**
   * Format a complete string containing a path
   * When the string contains path segments, apply platform-specific adaptation
   * @param value String that may contain a path
   * @param isPath Whether it is a path type
   */
  formatValueForPlatform(value: string, isPath: boolean): string {
    if (!isPath) return value;
    return this.formatPathForPlatform(value);
  }
  
  /**
   * Get the profile's chat_workspaces folder path
   * Format: {KOSMOS app user data folder}/profiles/{alias}/chat_workspaces
   */
  private getProfileWorkspacesFolderPath(alias: string): string {
    const userDataPath = getUserDataPath();
    return path.join(userDataPath, 'profiles', alias, 'chat_workspaces');
  }

  /**
   * Get the research MCP runtime directory
   */
  private getResearchRuntimeDir(): string {
    const userDataPath = getUserDataPath();
    return path.join(userDataPath, 'runtimes', 'research-mcp');
  }

  /**
   * Get the research MCP bundled resources directory
   */
  private getResearchResourcesDir(): string {
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        // process.resourcesPath is electron-augmented; not present in ts-jest's root tsconfig types
        return path.join((process as { resourcesPath?: string }).resourcesPath!, 'mcp', 'research');
      } else {
        return path.join(app.getAppPath(), 'resources', 'mcp', 'research');
      }
    } catch {
      // Electron unavailable (e.g. Jest test environment)
      return path.join(process.cwd(), 'resources', 'mcp', 'research');
    }
  }

  /**
   * Get the Tushare API token from the user's profile
   */
  private getResearchTushareToken(alias: string): string {
    try {
      const { ProfileCacheManager } = require('./profileCacheManager');
      const profile = ProfileCacheManager.getInstance().getCachedProfile(alias);
      return profile?.researchApiTokens?.tushare ?? '';
    } catch {
      return '';
    }
  }
  
  /**
   * Check if the string contains path-type placeholders
   */
  private containsPathPlaceholder(value: string): boolean {
    KOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
    const matches = value.match(KOSMOS_PLACEHOLDER_REGEX);
    if (!matches) return false;
    
    return matches.some(placeholder => {
      const metadata = PLACEHOLDER_METADATA[placeholder];
      return metadata?.type === PlaceholderType.PATH;
    });
  }
  
  /**
   * Replace all KOSMOS placeholders in a string
   * @param value String containing placeholders
   * @param context Context information
   * @returns String with placeholders replaced
   */
  replacePlaceholders(value: string, context: { alias: string }): string {
    if (typeof value !== 'string') return value;
    
    // Check if path-type placeholders are present (for subsequent full-string formatting)
    const hasPathPlaceholder = this.containsPathPlaceholder(value);
    
    // Reset regex lastIndex
    KOSMOS_PLACEHOLDER_REGEX.lastIndex = 0;
    
    let result = value.replace(KOSMOS_PLACEHOLDER_REGEX, (match) => {
      const replacement = this.getPlaceholderValue(match, context);
      if (replacement !== null) {
        return replacement;
      }
      // If no corresponding value found, keep the original placeholder
      console.warn(`[KosmosPlaceholderManager] Could not resolve placeholder: ${match}`);
      return match;
    });
    
    // If path-type placeholders are present, apply platform path formatting to the entire result string
    // This handles cases like "@KOSMOS_PROFILE_WORKSPACES_FOLDER/pm-agent"
    if (hasPathPlaceholder) {
      result = this.formatPathForPlatform(result);
    }
    
    return result;
  }
  
  /**
   * Replace KOSMOS placeholders in all values of an object (e.g., env config)
   * @param obj Object containing placeholders
   * @param context Context information
   * @returns New object with placeholders replaced (original object is not modified)
   */
  replacePlaceholdersInObject<T extends Record<string, any>>(obj: T, context: { alias: string }): T {
    if (!obj || typeof obj !== 'object') return obj;
    
    const result: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.replacePlaceholders(value, context);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively handle nested objects
        result[key] = this.replacePlaceholdersInObject(value, context);
      } else {
        result[key] = value;
      }
    }
    
    return result as T;
  }
  
  /**
   * Get all supported placeholders and their descriptions
   */
  getSupportedPlaceholders(): Array<{ name: string; description: string }> {
    return [
      {
        name: KosmosPlaceholder.PROFILE_WORKSPACES_FOLDER,
        description: "Profile's chat_workspaces folder path: {user data}/profiles/{alias}/chat_workspaces"
      },
      {
        name: KosmosPlaceholder.RESEARCH_RUNTIME_DIR,
        description: "Research MCP runtime directory: {user data}/runtimes/research-mcp"
      },
      {
        name: KosmosPlaceholder.RESEARCH_RESOURCES_DIR,
        description: "Research MCP bundled resources directory"
      },
      {
        name: KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN,
        description: "Tushare API token for research MCP"
      },
      {
        name: KosmosPlaceholder.RESEARCH_USER_DATA_DIR,
        description: "Research MCP user data directory (same as app userData)"
      },
    ];
  }
}

// Export singleton instance
export const kosmosPlaceholderManager = KosmosPlaceholderManager.getInstance();
