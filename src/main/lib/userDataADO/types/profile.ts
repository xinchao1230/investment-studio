/**
 * Type definitions for Profile configuration V2
 */

import { getDefaultModel } from '../../llm/ghcModels';

/**
 * Skill configuration
 */
export interface SkillConfig {
  /** Skill name (also used as folder name) */
  name: string;
  /** Skill description */
  description: string;
  /** Skill version */
  version: string;
  /** Skill source */
  source: 'ON-DEVICE';
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  /** Name of the MCP server */
  name: string;
  /** Transport type ('stdio', 'sse', or 'StreamableHttp') */
  transport: 'stdio' | 'sse' | 'StreamableHttp' | string;
  /** Command to execute (for stdio transport) */
  command: string;
  /** Command line arguments */
  args: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Server URL (for sse/http transport) */
  url: string;
  /** Whether this server is currently in use */
  in_use: boolean;
  /** MCP server version */
  version?: string;
  /** MCP server source */
  source?: 'ON-DEVICE';
}

/**
 * User information from GitHub Copilot
 */
export interface GhcUser {
  /** User ID */
  id: string;
  /** GitHub username */
  login: string;
  /** User email address */
  email: string;
  /** User display name */
  name: string;
  /** User avatar URL */
  avatarUrl: string;
  /** GitHub Copilot plan type */
  copilotPlan: string;
}

/**
 * Authentication tokens for GitHub Copilot
 */
export interface GhcTokens {
  /** Refresh token */
  refresh: string;
  /** Access token */
  access: string;
  /** Token expiration timestamp */
  expires: number;
}

/**
 * Input/Output modalities supported by a model
 */
export interface ModelModalities {
  /** Supported input types */
  input: string[];
  /** Supported output types */
  output: string[];
}

/**
 * Model context and output limits
 */
export interface ModelLimit {
  /** Maximum context length */
  context: number;
  /** Maximum output length */
  output: number;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  /** Model ID */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Whether model supports attachments */
  attachment: boolean;
  /** Whether model supports reasoning */
  reasoning: boolean;
  /** Whether model supports temperature adjustment */
  temperature: boolean;
  /** Whether model supports tool calling */
  tool_call: boolean;
  /** Knowledge cutoff date */
  knowledge: string;
  /** Model release date */
  release_date: string;
  /** Last updated date */
  last_updated: string;
  /** Supported modalities */
  modalities: ModelModalities;
  /** Whether model has open weights */
  open_weights: boolean;
  /** Model limits */
  limit: ModelLimit;
}


/**
 * Sentinel key used in `lastActiveChatByTarget` to mark a global (non-target) research chat.
 * Reserved for future "Global" research scope; today only target-bound chats use real codes.
 */
export const RESEARCH_GLOBAL_TARGET_KEY = '__global__';

/**
 * ChatSession config (V2)
 */
export interface ChatSession {
 /** ChatSession ID, format: chatSession_YYYYMMDDHHMMSS */
  chatSession_id: string;
  /** Last updated time */
  last_updated: string;
  /** ChatSession title */
  title: string;
  /**
   * Research workspace target binding.
   * - `string`: bound to a specific target (e.g. stock code "603993").
   * - `null`: explicitly global research scope (reserved; no UI today).
   * - `undefined` / missing: legacy / non-research chat session.
   */
  targetCode?: string | null;
  /**
   * Cached target directory name (e.g. "海底捞_603993") relative to workspace root.
   * Avoids a profile lookup on every cwd resolution.
   * Only meaningful when `targetCode` is a string.
   */
  targetDir?: string;
}

/**
 * Agent MCP Server config (includes selected tools)
 */
export interface AgentMcpServer {
  /** MCP server name */
  name: string;
  /** List of selected tools for the current agent */
  tools: string[];
}

/**
 * Quick Start config item
 */
export interface QuickStartItem {
  /** Quick start title */
  title: string;
  /** Image URL (optional) */
  image?: string;
  /** Description */
  description: string;
  /** Triggered prompt */
  prompt: string;
}

/**
 * Zero States config - Agent initial state display
 */
export interface ZeroStates {
  /** Greeting message */
  greeting?: string;
  /** Quick start items list */
  quick_starts?: QuickStartItem[];
}

/**
 * Default Zero States config
 */
export const DEFAULT_ZERO_STATES: ZeroStates = {
  greeting: "",
  quick_starts: []
};

/**
 * Context Enhancement config
 */
export interface ContextEnhancement {
  /** Memory search config */
  search_memory: {
    /** Whether memory search is enabled */
    enabled: boolean;
    /** Semantic similarity threshold, range [0,1] */
    semantic_similarity_threshold: number;
    /** Semantic similarity top N result count */
    semantic_top_n: number;
  };
  /** Memory generation config */
  generate_memory: {
    /** Whether memory generation is enabled */
    enabled: boolean;
  };
}

/**
 * Chat Agent config (V2)
 */
export interface ChatAgent {
  /** Agent role */
  role: string;
  /** Agent emoji */
  emoji: string;
  /** Agent avatar URL */
  avatar?: string;
  /** Agent name */
  name: string;
  /** Model to use */
  model: string;
  /** Workspace directory path */
  workspace?: string;
  /** Knowledge Base directory path, defaults to workspace/knowledge */
  knowledgeBase?: string;
  /** Agent version */
  version?: string;
  /** Agent source */
  source?: 'ON-DEVICE';
  /** Agent-specific MCP server list (new structure: includes tool selection) */
  mcp_servers: AgentMcpServer[];
  /** System prompt */
  system_prompt: string;
  /** Context Enhancement config */
  context_enhancement?: ContextEnhancement;
  /** Skills name list used by the Agent */
  skills?: string[];
  /** Zero States config - Agent initial state display */
  zero_states?: ZeroStates;
}

/**
 * Chat config (V2) - persisted configuration
 */
export interface ChatConfig {
  /** Chat ID, format: chat_YYYYMMDDHHMMSS */
  chat_id: string;
  /** Chat type */
  chat_type: 'single_agent' | 'multi_agent';
  /** Single agent config (when chat_type is single_agent) */
  agent?: ChatAgent;
  /** Multi agent config (when chat_type is multi_agent) */
  agents?: ChatAgent[];
}

/**
 * Chat runtime config - includes dynamically loaded chatSessions
 * Used for frontend display and in-memory operations; chatSessions are not persisted to profile.json
 */
export interface ChatConfigRuntime extends ChatConfig {
  /** ChatSession list (dynamically loaded at runtime, not persisted) */
  chatSessions?: ChatSession[];
}

/**
 * Browser Control settings config
 */
export interface BrowserControlSettings {
  /** Browser type */
  browser: 'chrome' | 'edge';
}

/**
 * Profile V2 config interface (current)
 */
export interface ProfileV2 {
  /** Profile version */
  version: string;
  /** Created time */
  createdAt: string;
  /** Updated time */
  updatedAt: string;
  /** User alias */
  alias: string;
  /** Whether First Run Experience is completed */
  freDone?: boolean;
  /** Primary Agent, displayed first in the AgentChatList and used when the app starts. Defaults to Kobi */
  primaryAgent?: string;
  /** MCP server configs */
  mcp_servers: McpServerConfig[];
  /** Skills config list */
  skills?: SkillConfig[];
  /** Chat configs */
  chats: ChatConfig[];
  /** Voice Input settings config */
  voiceInputSettings?: VoiceInputSettings;
  /** Browser Control settings config */
  browserControl?: BrowserControlSettings;
  /**
   * Research workspace: most-recently-active chat session id per target.
   * Key: target code (or `RESEARCH_GLOBAL_TARGET_KEY` for global scope).
   * Value: chatSession_id last opened for that target.
   * Used to auto-restore the right chat when re-selecting a target.
   */
  lastActiveChatByTarget?: Record<string, string>;
  /**
   * Research workspace: per-provider API tokens (plain text, same security
   * level as mcp_servers[].env). Missing or empty string ⇒ not configured.
   */
  researchApiTokens?: {
    tushare?: string;
    eastmoney?: string;
  };
}

/**
 * Profile type definition
 */
export type Profile = ProfileV2;

/**
 * Version detection type guard
 */
export function isProfileV2(profile: any): profile is ProfileV2 {
  return (
    profile &&
    typeof profile === 'object' &&
    'alias' in profile &&              // V2-specific field
    'chats' in profile &&              // V2-specific field
    !('authProvider' in profile) &&    // V1 field not present
    !('ghcAuth' in profile) &&         // V1 field not present
    typeof profile.alias === 'string' &&
    Array.isArray(profile.chats)
  );
}


/**
 * Generic version detector
 */
export function detectProfileVersion(profile: any): 'v2' | 'unknown' {
  if (isProfileV2(profile)) {
    return 'v2';
  } else {
    return 'unknown';
  }
}

/**
 * Type guard to check if an object is a valid Profile (legacy)
 */
export function isProfile(obj: any): obj is Profile {
  return isProfileV2(obj);
}

/**
 * Type guard to check if an object is a valid MCP Server Config
 */
export function isMcpServerConfig(obj: any): obj is McpServerConfig {
  return (
    obj &&
    typeof obj.name === 'string' &&
    typeof obj.transport === 'string' &&
    ['stdio', 'sse', 'StreamableHttp'].includes(obj.transport) &&
    typeof obj.command === 'string' &&
    Array.isArray(obj.args) &&
    typeof obj.env === 'object' &&
    typeof obj.url === 'string' &&
    typeof obj.in_use === 'boolean'
  );
}

/**
 * Default Context Enhancement config
 */
export const DEFAULT_CONTEXT_ENHANCEMENT: ContextEnhancement = {
  search_memory: {
    enabled: false,
    semantic_similarity_threshold: 0.0,
    semantic_top_n: 5
  },
  generate_memory: {
    enabled: false
  }
};

/**
 * Default Chat Agent config (Kobi — generic assistant, default for openkosmos brand)
 */
export const DEFAULT_CHAT_AGENT: ChatAgent = {
  role: "Default Assistant",
  emoji: "🐬",
  avatar: "",
  name: "Kobi",
  model: getDefaultModel(),
  version: "1.0.0",
  source: "ON-DEVICE",
  knowledgeBase: "",
  mcp_servers: [
    {
      name: "builtin-tools",
      tools: []  // Empty array means use all tools from the server
    }
  ],
  system_prompt: "You are a highly capable AI assistant designed to help users with a wide variety of tasks. Your core capabilities include:\n\n**Communication & Analysis:**\n- Provide clear, accurate, and helpful responses to questions\n- Analyze complex problems and break them down into manageable parts\n- Adapt your communication style to match the user's needs and expertise level\n\n**Technical Assistance:**\n- Help with programming, debugging, and code review across multiple languages\n- Assist with data analysis, research, and information synthesis\n- Provide guidance on best practices and technical decision-making\n\n**Creative & Productive Support:**\n- Generate creative content including writing, brainstorming, and ideation\n- Help with planning, organization, and project management\n- Assist with document creation, editing, and formatting\n\n**Interaction Guidelines:**\n- Always strive for accuracy and cite sources when appropriate\n- Ask clarifying questions when requirements are unclear\n- Provide step-by-step explanations for complex procedures\n- Respect user privacy and maintain confidentiality\n- Be honest about limitations and uncertainties\n\n**Tools & Integration:**\n- Leverage available MCP servers and tools to enhance capabilities\n- Use web browsing, file operations, and data processing tools when beneficial\n- Integrate multiple information sources to provide comprehensive responses\n\nYour goal is to be a reliable, knowledgeable, and adaptable assistant that helps users accomplish their objectives efficiently and effectively.",
  context_enhancement: DEFAULT_CONTEXT_ENHANCEMENT,
  skills: ['skill-creator'],
  zero_states: DEFAULT_ZERO_STATES
};

/**
 * Default Chat Agent config (Stella — equity research analyst, default for investment-studio brand).
 *
 * Inherits Kobi's full system_prompt (Section A) and appends an investment research
 * specialty section (Section C). Uses the same builtin-tools MCP and skill-creator as Kobi,
 * plus the 6 investment skills shipped under workspace `skills/`.
 */
export const DEFAULT_CHAT_AGENT_STELLA: ChatAgent = {
  role: "Default Assistant",
  emoji: "📊",
  avatar: "",
  name: "Stella",
  model: getDefaultModel(),
  version: "1.0.0",
  source: "ON-DEVICE",
  knowledgeBase: "@KOSMOS_PORTFOLIO_DIR",
  mcp_servers: [
    {
      name: "builtin-tools",
      tools: []
    },
    {
      name: "research-mcp",
      tools: []
    }
  ],
  system_prompt:
    // ===== Section A: inherited verbatim from Kobi =====
    "You are a highly capable AI assistant designed to help users with a wide variety of tasks. Your core capabilities include:\n\n**Communication & Analysis:**\n- Provide clear, accurate, and helpful responses to questions\n- Analyze complex problems and break them down into manageable parts\n- Adapt your communication style to match the user's needs and expertise level\n\n**Technical Assistance:**\n- Help with programming, debugging, and code review across multiple languages\n- Assist with data analysis, research, and information synthesis\n- Provide guidance on best practices and technical decision-making\n\n**Creative & Productive Support:**\n- Generate creative content including writing, brainstorming, and ideation\n- Help with planning, organization, and project management\n- Assist with document creation, editing, and formatting\n\n**Interaction Guidelines:**\n- Always strive for accuracy and cite sources when appropriate\n- Ask clarifying questions when requirements are unclear\n- Provide step-by-step explanations for complex procedures\n- Respect user privacy and maintain confidentiality\n- Be honest about limitations and uncertainties\n\n**Tools & Integration:**\n- Leverage available MCP servers and tools to enhance capabilities\n- Use web browsing, file operations, and data processing tools when beneficial\n- Integrate multiple information sources to provide comprehensive responses\n\nYour goal is to be a reliable, knowledgeable, and adaptable assistant that helps users accomplish their objectives efficiently and effectively.\n\n" +
    // ===== Section C: Investment Research Specialty =====
    "## C. 投资分析专长（Investment Research Specialty）\n\n你的名字是 Stella 📊。在通用助手能力之上，你同时是一名资深的 A 股 / 美股 / 港股投资研究分析师，专注于上市公司基本面研究、财报解读、行业对比与量化初筛。\n\n### Skill 路由（用户意图 → 调用的 Skill）\n\n根据用户请求的语义意图，主动加载并遵循对应 Skill 的指令：\n\n- **深度报告 / 全面分析 / Initiation Report / 个股分析** → `stock-analyze`\n- **盈利预测 / 财务建模 / DCF / 估值** → `earnings-forecast`\n- **财报点评 / 季报年报解读 / Earnings Review** → `earnings-review`\n- **行业对比 / 同业比较 / Peer Analysis** → `industry-comparison`\n- **跟踪 / 边际变化 / 持续覆盖** → `marginal-tracking`\n- **选股 / 初筛 / Screener** → `stock-screening`\n\n### Portfolio 工作流（公司级文件管理）\n\n当用户提到一家具体公司（例如「贵州茅台 600519」「分析 NVDA」）时，遵循以下顺序，**严禁**对同一公司重复 `portfolio_init_target`：\n\n1. 先调用 `portfolio_list_targets` 查询该公司是否已建档；\n2. 若未建档，再调用 `portfolio_init_target` 创建标的目录；\n3. 调用 `portfolio_get_target_files` 确认现有目录结构与已有文件；\n4. 将本次分析产出写入该标的目录下的合适子目录，**复用既有结构**，不要新建平行目录。\n\n### 数据源约定（Tushare）\n\n- 财务/行情数据优先使用 Tushare Pro API。脚本约定遵循「双脚本模式」：一个 `fetch_*.py` 负责拉取并落盘 CSV / JSON，一个 `analyze_*.py` 读取落盘数据进行加工——避免在分析脚本中反复联网拉数据。\n- Tushare token 从用户 profile 的 `researchApiTokens.tushare` 读取，不要在代码中硬编码。\n- 所有引用的数值必须在文字旁注明：**数据来源（Tushare 接口名）+ 报告期 / 截止日期**。例：「2025Q3 营收 412.8 亿元（Tushare income, end_date=20250930）」。\n\n### 红旗审计 Checklist（Red-Flag Audit）\n\n在出具任何买入 / 增持类结论之前，主动执行以下五项检查，并在报告中显式标注结果（即使全部正常）：\n\n1. **经营性现金流 vs 净利润背离**：连续两期净现比 < 0.7 视为红旗；\n2. **应收账款 / 存货异常增长**：增速显著高于营收增速（>30 pct）；\n3. **商誉占净资产比例**：>30% 需提示减值风险，并追溯近 3 年减值历史；\n4. **关联交易占比**：关联方营收 / 采购 > 30% 需追问商业实质；\n5. **审计意见非标**：保留意见 / 无法表示意见 / 否定意见——一票否决。\n\n### 输出风格\n\n- 默认中文回答；专业术语保留英文原文（如 EBITDA、FCF、ROIC）。\n- 结构化：先结论（一句话），再分点论证，最后给出可执行的下一步建议或追问问题。\n- 不臆造数据。若信息缺失，明确说「需要拉取 / 用户补充 X」，并给出具体的 Tushare 接口或文件位置建议。",
  context_enhancement: DEFAULT_CONTEXT_ENHANCEMENT,
  skills: [
    'skill-creator',
    'stock-analyze',
    'earnings-forecast',
    'earnings-review',
    'industry-comparison',
    'marginal-tracking',
    'stock-screening'
  ],
  zero_states: {
    greeting: "你好，我是 Stella 📊 — 你的 AI 投资研究助手。可以帮你做深度分析、行业对比、财报点评、量化初筛。",
    quick_starts: [
      {
        title: "深度分析",
        description: "对一家上市公司做全面基本面分析",
        prompt: "请对 600519 贵州茅台 做一份深度基本面分析报告（公司概况、业务结构、财务、估值、风险）。"
      },
      {
        title: "行业对比",
        description: "对比同行业多家公司的关键指标",
        prompt: "请对比白酒行业 TOP5（贵州茅台、五粮液、洋河、泸州老窖、山西汾酒）的营收增速、毛利率、ROE 与估值。"
      },
      {
        title: "财报点评",
        description: "解读单季 / 年度财报",
        prompt: "请点评 002475 立讯精密 2025Q3 财报，重点关注收入结构、利润率与现金流变化。"
      },
      {
        title: "量化初筛",
        description: "按多因子条件筛选股票池",
        prompt: "在 A 股全市场筛选：PE(TTM) < 20、ROE(近 3 年均值) > 15%、营收近 3 年复合增速 > 10%。给出名单与关键指标。"
      }
    ]
  }
};

/**
 * Brand-aware factory: returns the default `ChatAgent` template appropriate for the brand.
 *
 * @param brandName Brand identifier; defaults to `process.env.BRAND_NAME` (webpack-injected).
 * @returns `DEFAULT_CHAT_AGENT_STELLA` for `investment-studio`, otherwise `DEFAULT_CHAT_AGENT` (Kobi).
 */
export function getDefaultChatAgent(brandName?: string): ChatAgent {
  const brand = brandName ?? process.env.BRAND_NAME;
  if (brand === 'investment-studio') {
    return DEFAULT_CHAT_AGENT_STELLA;
  }
  return DEFAULT_CHAT_AGENT;
}

/**
 * Brand-aware factory: returns the default `primaryAgent` name appropriate for the brand.
 *
 * @param brandName Brand identifier; defaults to `process.env.BRAND_NAME` (webpack-injected).
 * @returns `'Stella'` for `investment-studio`, otherwise `'Kobi'`.
 */
export function getDefaultPrimaryAgentName(brandName?: string): string {
  const brand = brandName ?? process.env.BRAND_NAME;
  if (brand === 'investment-studio') {
    return 'Stella';
  }
  return 'Kobi';
}

/**
 * Default Profile V2 config
 */
export const DEFAULT_PROFILE_V2: Partial<ProfileV2> = {
  version: "2.0.0",
  freDone: false,
  primaryAgent: "Kobi",
  mcp_servers: [],
  chats: []
};


/**
 * Default MCP server configuration
 */
export const DEFAULT_MCP_SERVER: McpServerConfig = {
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  env: {},
  url: "",
  in_use: true,
  version: "1.0.0",
  source: "ON-DEVICE"
};

/**
 * Default Browser Control config
 */
export const DEFAULT_BROWSER_CONTROL_SETTINGS: BrowserControlSettings = {
  browser: 'edge'
};

/**
 * Whisper model size options
 */
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'turbo';

/**
 * Whisper model information
 */
export interface WhisperModelInfo {
  /** Model size identifier */
  size: WhisperModelSize;
  /** Model file name */
  fileName: string;
  /** Model file size in bytes */
  fileSize: number;
  /** Human-readable file size */
  fileSizeDisplay: string;
  /** Download URL */
  downloadUrl: string;
  /** Description */
  description: string;
}

/**
 * Voice Input Settings configuration
 */
export interface VoiceInputSettings {
  /** Whisper model size to use for voice input */
  whisperModel: WhisperModelSize;
  /** Language for speech recognition: 'auto' for auto-detect or specific language code */
  language: string;
  /** Enable GPU acceleration (Vulkan on Windows/Linux, Metal on macOS) */
  useGPU?: boolean;
  /** Enable translation to English (only available for 'small', 'medium', and 'turbo' models) */
  translate?: boolean;
}

/**
 * Default Voice Input Settings
 */
export const DEFAULT_VOICE_INPUT_SETTINGS: VoiceInputSettings = {
  whisperModel: 'base',
  language: 'auto',
  useGPU: false,
  translate: false
};

/**
 * Whisper model definitions with download URLs and metadata
 */
export const WHISPER_MODELS: Record<WhisperModelSize, WhisperModelInfo> = {
  tiny: {
    size: 'tiny',
    fileName: 'ggml-tiny.bin',
    fileSize: 75_000_000,
    fileSizeDisplay: '75 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    description: 'Fast, good accuracy'
  },
  base: {
    size: 'base',
    fileName: 'ggml-base.bin',
    fileSize: 142_000_000,
    fileSizeDisplay: '142 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    description: 'Balanced (Recommended)'
  },
  small: {
    size: 'small',
    fileName: 'ggml-small-q8_0.bin',
    fileSize: 264_000_000,
    fileSizeDisplay: '264 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin',
    description: 'Better accuracy'
  },
  medium: {
    size: 'medium',
    fileName: 'ggml-medium-q5_0.bin',
    fileSize: 539_000_000,
    fileSizeDisplay: '539 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin',
    description: 'Best accuracy'
  },
  turbo: {
    size: 'turbo',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    fileSize: 574_000_000,
    fileSizeDisplay: '574 MB',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    description: 'Best accuracy'
  }
};

/**
 * Built-in Agent name constants
 * 
 * ===== Built-in Agents System =====
 * 
 * Built-in agents are system-preset agents with the following characteristics:
 * 1. 🏷️ Labeled with a "Built-in" badge
 * 2. 📍 Pinned below the navigation bar Divider (higher display priority than primaryAgent)
 * 3. 🔒 Cannot be deleted (delete button hidden in frontend + backend protection)
 * 
 * Built-in Agents: ['Kobi'] - Kobi is always visible
 */

/** kosmos branding built-in agent list (only Kobi) */
export const BUILTIN_AGENT_NAMES_KOSMOS: string[] = ['Kobi'];

/** investment-studio branding built-in agent list (only Stella) */
export const BUILTIN_AGENT_NAMES_INVESTMENT_STUDIO: string[] = ['Stella'];

/**
 * Get the list of built-in agent names for the given brand.
 *
 * @param brandName branding name; defaults to `process.env.BRAND_NAME` (webpack-injected).
 * @returns Array of built-in agent names
 *
 * @example
 * getBuiltinAgentNames('kosmos')             // ['Kobi']
 * getBuiltinAgentNames('investment-studio')  // ['Stella']
 * getBuiltinAgentNames()                     // brand-dependent
 */
export function getBuiltinAgentNames(brandName?: string): string[] {
  const brand = brandName ?? process.env.BRAND_NAME;
  if (brand === 'investment-studio') {
    return BUILTIN_AGENT_NAMES_INVESTMENT_STUDIO;
  }
  return BUILTIN_AGENT_NAMES_KOSMOS;
}

/**
 * Check if a given agent is a built-in agent
 * 
 * @param agentName Agent name (case-insensitive)
 * @param brandName branding name; defaults to `process.env.BRAND_NAME` (webpack-injected).
 * @returns true if it is a built-in agent, false otherwise
 * 
 * @example
 * isBuiltinAgent('Kobi')       // true (openkosmos)
 * isBuiltinAgent('Stella')     // true (investment-studio)
 * isBuiltinAgent('Custom Agent') // false
 */
export function isBuiltinAgent(agentName: string | undefined | null, brandName?: string): boolean {
  if (!agentName) return false;
  const builtinNames = getBuiltinAgentNames(brandName);
  return builtinNames.some(
    name => name.toLowerCase() === agentName.toLowerCase()
  );
}

/**
 * ChatSession utility functions
 */
export class ChatSessionUtils {
  /**
   * Generate a ChatSession ID
   */
  static generateChatSessionId(): string {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0');
    return `chatSession_${timestamp}`;
  }

  /**
   * Create a default ChatSession
   */
  static createDefaultChatSession(title: string = "New ChatSession"): ChatSession {
    return {
      chatSession_id: this.generateChatSessionId(),
      last_updated: new Date().toISOString(),
      title: title
    };
  }

  /**
   * Validate a ChatSession object
   */
  static isValidChatSession(obj: any): obj is ChatSession {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.chatSession_id === 'string' &&
      typeof obj.last_updated === 'string' &&
      typeof obj.title === 'string' &&
      obj.chatSession_id.startsWith('chatSession_')
    );
  }

  /**
   * Clean and validate a ChatSession array
   */
  static sanitizeChatSessions(chatSessions: any[]): ChatSession[] {
    if (!Array.isArray(chatSessions)) {
      return [];
    }

    return chatSessions
      .filter(chatSession => this.isValidChatSession(chatSession))
      .map(chatSession => ({
        chatSession_id: chatSession.chatSession_id,
        last_updated: chatSession.last_updated,
        title: chatSession.title || "Untitled ChatSession"
      }));
  }
}

/**
 * Default ChatSession config
 */
export const DEFAULT_CHAT_SESSION: ChatSession = {
  chatSession_id: "chatSession_20250101000000",
  last_updated: new Date().toISOString(),
  title: "Default ChatSession"
};
