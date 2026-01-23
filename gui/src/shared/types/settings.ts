// Shared settings types for both main and renderer processes

export type AgentTool = 'claude' | 'cursor' | 'cursor-cli' | 'codex'
export type TerminalMode = 'tmux' | 'tabs'
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'opusplan'
export type CursorCLIModel =
  | 'composer-1'
  | 'auto'
  | 'sonnet-4.5'
  | 'sonnet-4.5-thinking'
  | 'opus-4.5'
  | 'opus-4.5-thinking'
  | 'opus-4.1'
  | 'gemini-3-pro'
  | 'gemini-3-flash'
  | 'gpt-5.2'
  | 'gpt-5.2-high'
  | 'gpt-5.1'
  | 'gpt-5.1-high'
  | 'gpt-5.1-codex'
  | 'gpt-5.1-codex-high'
  | 'gpt-5.1-codex-max'
  | 'gpt-5.1-codex-max-high'
  | 'grok'
export type CodexModel = 'gpt-5.2-codex'
export type WorkflowMode = 'planning' | 'dev'
export type ClaudeOutputMode = 'terminal' | 'json-ui'

export interface NotificationSettings {
  enabled: boolean // Enable/disable OS notifications
  cooldownSeconds: number // Cooldown duration (default: 30)
}

export interface DefaultToolSettings {
  tool: AgentTool // Default tool for new assignments
  claudeModel: ClaudeModel // Default Claude model
  cursorCLIModel: CursorCLIModel // Default Cursor CLI model
  // Note: Codex model is hardcoded to gpt-5.2-codex per CLAUDE.md
}

export interface DefaultAgentSettings {
  workflowMode: WorkflowMode // Default workflow (planning vs dev)
  yoloMode: boolean // Default YOLO mode
  chromeIntegration: boolean // Default Chrome/browser automation
}

export interface TerminalSettings {
  terminalMode: TerminalMode // tmux (default) or tabs (legacy)
}

/**
 * Settings for Claude Code config import feature.
 */
export interface ClaudeConfigSettings {
  enabled: boolean               // Master toggle for imports
  enabledPlugins: string[]       // List of enabled plugin IDs (empty = all enabled)
  disabledAgentIds: string[]     // Specific agent IDs to skip
  autoRefresh: boolean           // Watch for config changes
}

/**
 * Settings for Claude output mode (terminal vs JSON UI).
 */
export interface ClaudeUISettings {
  outputMode: ClaudeOutputMode   // 'terminal' (classic) or 'json-ui' (conversation view)
  showStreamingText: boolean     // Show text as it streams in real-time
  collapseToolResults: boolean   // Auto-collapse tool results by default
  maxConversationItems: number   // Memory limit: max items to keep in conversation history
}

export interface AppSettings {
  notifications: NotificationSettings
  defaultTool: DefaultToolSettings
  defaultAgent: DefaultAgentSettings
  terminal: TerminalSettings
  claudeConfig: ClaudeConfigSettings // Claude Code plugin import settings
  claudeUI: ClaudeUISettings         // Claude output mode settings (terminal vs JSON UI)
  version: number // Schema version for migrations
}

// Default settings for new users or migration
export const DEFAULT_SETTINGS: AppSettings = {
  notifications: {
    enabled: true,
    cooldownSeconds: 30
  },
  defaultTool: {
    tool: 'claude',
    claudeModel: 'opusplan',
    cursorCLIModel: 'auto'
  },
  defaultAgent: {
    workflowMode: 'planning',
    yoloMode: true,
    chromeIntegration: true
  },
  terminal: {
    terminalMode: 'tmux'
  },
  claudeConfig: {
    enabled: true,
    enabledPlugins: [],
    disabledAgentIds: [],
    autoRefresh: true
  },
  claudeUI: {
    outputMode: 'terminal',      // Safe default, users can opt-in to json-ui
    showStreamingText: true,
    collapseToolResults: true,
    maxConversationItems: 500    // Memory limit
  },
  version: 4
}

// Display name mappings for UI dropdowns
export const TOOL_DISPLAY_NAMES: Record<AgentTool, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  'cursor-cli': 'Cursor CLI',
  codex: 'OpenAI Codex'
}

export const CLAUDE_MODEL_DISPLAY_NAMES: Record<ClaudeModel, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  opusplan: 'Opus Plan'
}

export const CURSOR_CLI_MODEL_DISPLAY_NAMES: Record<CursorCLIModel, string> = {
  'composer-1': 'Composer 1',
  auto: 'Auto',
  'sonnet-4.5': 'Sonnet 4.5',
  'sonnet-4.5-thinking': 'Sonnet 4.5 Thinking',
  'opus-4.5': 'Opus 4.5',
  'opus-4.5-thinking': 'Opus 4.5 Thinking',
  'opus-4.1': 'Opus 4.1',
  'gemini-3-pro': 'Gemini 3 Pro',
  'gemini-3-flash': 'Gemini 3 Flash',
  'gpt-5.2': 'GPT 5.2',
  'gpt-5.2-high': 'GPT 5.2 High',
  'gpt-5.1': 'GPT 5.1',
  'gpt-5.1-high': 'GPT 5.1 High',
  'gpt-5.1-codex': 'GPT 5.1 Codex',
  'gpt-5.1-codex-high': 'GPT 5.1 Codex High',
  'gpt-5.1-codex-max': 'GPT 5.1 Codex Max',
  'gpt-5.1-codex-max-high': 'GPT 5.1 Codex Max High',
  grok: 'Grok'
}

export const TERMINAL_MODE_DISPLAY_NAMES: Record<TerminalMode, string> = {
  tmux: 'Tmux (recommended)',
  tabs: 'Tabs (legacy)'
}

export const CLAUDE_OUTPUT_MODE_DISPLAY_NAMES: Record<ClaudeOutputMode, string> = {
  terminal: 'Terminal (classic)',
  'json-ui': 'Conversation UI (beta)'
}
