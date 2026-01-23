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

export interface NotificationSettings {
  enabled: boolean
  cooldownSeconds: number
}

export interface DefaultToolSettings {
  tool: AgentTool
  claudeModel: ClaudeModel
  cursorCLIModel: CursorCLIModel
}

export interface DefaultAgentSettings {
  workflowMode: WorkflowMode
  yoloMode: boolean
  chromeIntegration: boolean
}

export interface TerminalSettings {
  terminalMode: TerminalMode
}

export interface ClaudeConfigSettings {
  enabled: boolean
  enabledPlugins: string[]
  disabledAgentIds: string[]
  autoRefresh: boolean
}

export interface SkillsLibrarySettings {
  commandsEnabled: boolean      // Enable ~/.claude/commands/
  agentsEnabled: boolean        // Enable ~/.claude/agents/
  projectSkillsEnabled: boolean // Enable project-local commands/agents
  disabledSkillIds: string[]    // Specific IDs to disable
}

export interface AppSettings {
  notifications: NotificationSettings
  defaultTool: DefaultToolSettings
  defaultAgent: DefaultAgentSettings
  terminal: TerminalSettings
  claudeConfig: ClaudeConfigSettings
  skillsLibrary: SkillsLibrarySettings
  version: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  notifications: { enabled: true, cooldownSeconds: 30 },
  defaultTool: { tool: 'claude', claudeModel: 'opusplan', cursorCLIModel: 'auto' },
  defaultAgent: { workflowMode: 'planning', yoloMode: true, chromeIntegration: true },
  terminal: { terminalMode: 'tmux' },
  claudeConfig: { enabled: true, enabledPlugins: [], disabledAgentIds: [], autoRefresh: true },
  skillsLibrary: { commandsEnabled: true, agentsEnabled: true, projectSkillsEnabled: true, disabledSkillIds: [] },
  version: 5
}

export const TOOL_DISPLAY_NAMES: Record<AgentTool, string> = {
  claude: 'Claude', cursor: 'Cursor', 'cursor-cli': 'Cursor CLI', codex: 'OpenAI Codex'
}

export const CLAUDE_MODEL_DISPLAY_NAMES: Record<ClaudeModel, string> = {
  haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', opusplan: 'Opus Plan'
}

export const CURSOR_CLI_MODEL_DISPLAY_NAMES: Record<CursorCLIModel, string> = {
  'composer-1': 'Composer 1', auto: 'Auto',
  'sonnet-4.5': 'Sonnet 4.5', 'sonnet-4.5-thinking': 'Sonnet 4.5 Thinking',
  'opus-4.5': 'Opus 4.5', 'opus-4.5-thinking': 'Opus 4.5 Thinking', 'opus-4.1': 'Opus 4.1',
  'gemini-3-pro': 'Gemini 3 Pro', 'gemini-3-flash': 'Gemini 3 Flash',
  'gpt-5.2': 'GPT 5.2', 'gpt-5.2-high': 'GPT 5.2 High',
  'gpt-5.1': 'GPT 5.1', 'gpt-5.1-high': 'GPT 5.1 High',
  'gpt-5.1-codex': 'GPT 5.1 Codex', 'gpt-5.1-codex-high': 'GPT 5.1 Codex High',
  'gpt-5.1-codex-max': 'GPT 5.1 Codex Max', 'gpt-5.1-codex-max-high': 'GPT 5.1 Codex Max High',
  grok: 'Grok'
}

export const TERMINAL_MODE_DISPLAY_NAMES: Record<TerminalMode, string> = {
  tmux: 'Tmux (recommended)', tabs: 'Tabs (legacy)'
}
