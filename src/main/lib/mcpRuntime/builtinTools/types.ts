/**
 * Shared type definitions for built-in tools
 * Centrally manages common interfaces used by all built-in tools
 */

/**
 * Built-in tool definition interface
 * Describes the basic information and parameter schema of a tool
 */
export interface BuiltinToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

/**
 * Filesystem mutation kinds emitted by builtin tools so the renderer can
 * invalidate caches / refresh views.
 */
export type FsMutationKind = 'create' | 'modify' | 'delete';

/**
 * Single filesystem mutation produced by a builtin tool. `path` is always
 * an absolute path (file or directory). Consumers in the renderer subscribe
 * via the shared `useFsChanged` hook and filter by path prefix / equality.
 */
export interface FsMutation {
  path: string;
  kind: FsMutationKind;
}

/**
 * Tool execution result interface
 * Unified return format for tool execution
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  /**
   * Optional list of filesystem mutations performed by the tool. Stripped
   * by `BuiltinToolsManager.executeTool` before serializing the result to
   * the LLM, then broadcast to all renderer windows via `kosmos:fs-changed`.
   */
  mutations?: FsMutation[];
}