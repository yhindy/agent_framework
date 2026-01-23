// Types for Claude Code CLI stream-json output format
// Reference: https://code.claude.com/docs/en/cli-reference

// ============================================================================
// Message Types from Claude CLI stdout (NDJSON format)
// ============================================================================

export type ClaudeMessageType = 'system' | 'assistant' | 'user' | 'result' | 'stream_event'

/**
 * System message - emitted once at session start
 */
export interface ClaudeSystemMessage {
  type: 'system'
  session_id: string
  timestamp?: string
  tools?: string[]
  model?: string
  permissionMode?: string
  apiKeySource?: string
}

/**
 * Content block types within messages
 */
export interface ClaudeTextBlock {
  type: 'text'
  text: string
}

export interface ClaudeThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ClaudeToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ClaudeToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<{ type: string; text?: string }>
  is_error?: boolean
}

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeThinkingBlock
  | ClaudeToolUseBlock
  | ClaudeToolResultBlock

/**
 * Token usage statistics
 */
export interface ClaudeUsageStats {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * Assistant message - Claude's response (text and/or tool invocations)
 */
export interface ClaudeAssistantMessage {
  type: 'assistant'
  uuid: string
  session_id: string
  parent_tool_use_id?: string
  message: {
    role: 'assistant'
    content: ClaudeContentBlock[]
    model?: string
    stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null
    usage?: ClaudeUsageStats
  }
}

/**
 * User message - tool results returned to Claude
 */
export interface ClaudeUserMessage {
  type: 'user'
  message: {
    role: 'user'
    content: ClaudeContentBlock[]
  }
}

/**
 * Result message - signals query completion
 */
export interface ClaudeResultMessage {
  type: 'result'
  is_error: boolean
  num_turns?: number
  total_cost_usd?: number
  duration_ms?: number
  permission_denials?: string[]
  session_id?: string
}

/**
 * Stream event - token-level streaming updates (with --include-partial-messages)
 */
export interface ClaudeStreamEvent {
  type: 'stream_event'
  event: {
    type:
      | 'content_block_delta'
      | 'content_block_start'
      | 'content_block_stop'
      | 'message_start'
      | 'message_stop'
    index?: number
    delta?: {
      type: 'text_delta' | 'thinking_delta'
      text?: string
    }
    content_block?: {
      type: 'text' | 'tool_use' | 'thinking'
      text?: string
      id?: string
      name?: string
    }
  }
}

/**
 * Union of all message types from Claude CLI stdout
 */
export type ClaudeJsonMessage =
  | ClaudeSystemMessage
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResultMessage
  | ClaudeStreamEvent

// ============================================================================
// Derived State Types
// ============================================================================

/**
 * High-level agent state derived from parsing messages
 */
export type ClaudeAgentState = 'initializing' | 'working' | 'waiting' | 'completed' | 'error'

/**
 * Reason why Claude is waiting for user input
 */
export interface ClaudeWaitingReason {
  type: 'end_turn' | 'permission_required' | 'question' | 'plan_approval'
  toolName?: string
  toolInput?: Record<string, unknown>
  toolUseId?: string
  question?: string
}

// ============================================================================
// Conversation UI Types
// ============================================================================

/**
 * Conversation item for rendering in the UI
 */
export interface ConversationItem {
  id: string
  timestamp: string
  type: 'user_prompt' | 'assistant_text' | 'tool_use' | 'tool_result' | 'thinking' | 'error'
  content: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolUseId?: string
  isError?: boolean
  isStreaming?: boolean
  isTruncated?: boolean
}

/**
 * Streaming chunk for real-time text updates
 */
export interface StreamingChunk {
  text: string
  fullText: string
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  numTurns: number
  durationMs?: number
}

// ============================================================================
// Input Message Types (for stdin)
// ============================================================================

/**
 * User input message to send to Claude via stdin
 */
export interface ClaudeUserInputMessage {
  type: 'user'
  message: {
    role: 'user'
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }
    >
  }
}

// ============================================================================
// Tools that require user interaction
// ============================================================================

/**
 * Tool names that indicate Claude is waiting for user input
 */
export const WAITING_TOOLS = [
  'AskUserQuestion',
  'ExitPlanMode',
  'AskHumanForApproval'
] as const

export type WaitingToolName = (typeof WAITING_TOOLS)[number]

export function isWaitingTool(toolName: string): toolName is WaitingToolName {
  return WAITING_TOOLS.includes(toolName as WaitingToolName)
}

// ============================================================================
// Service Options Types
// ============================================================================

/**
 * Options for starting a JSON-mode Claude agent
 */
export interface JsonClaudeStartOptions {
  agentId: string
  worktreePath: string
  projectPath: string
  prompt: string
  model?: string
  mode?: string // 'planning' | 'dev'
  yolo?: boolean
  chrome?: boolean
  sessionId?: string // For resume
  displayName: string
}
