import { useEffect, useState, useRef, useCallback } from 'react'
import type { ConversationItem, ClaudeAgentState, StreamingChunk } from '../../../shared/types/claudeJson'
import './ConversationView.css'

interface ConversationViewProps {
  agentId: string
  autoScroll?: boolean
  collapseToolResults?: boolean
}

export function ConversationView({
  agentId,
  autoScroll = true,
  collapseToolResults = true
}: ConversationViewProps): JSX.Element {
  const [items, setItems] = useState<ConversationItem[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [agentState, setAgentState] = useState<ClaudeAgentState>('initializing')
  const containerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(autoScroll)

  // Track if user has scrolled up (to disable auto-scroll)
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    // If user is within 100px of bottom, enable auto-scroll
    shouldAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 100
  }, [])

  // Load existing conversation and subscribe to updates
  useEffect(() => {
    // Load existing conversation
    window.electronAPI.getJsonConversation(agentId).then((existingItems) => {
      setItems(existingItems || [])
    })

    // Load current state
    window.electronAPI.getJsonAgentState(agentId).then((state) => {
      if (state) setAgentState(state)
    })

    // Subscribe to new conversation items
    const unsubItem = window.electronAPI.onClaudeConversationItem(
      (id: string, item: ConversationItem) => {
        if (id === agentId) {
          setItems((prev) => [...prev, item])
          setStreamingText('') // Clear streaming when finalized
        }
      }
    )

    // Subscribe to streaming chunks
    const unsubChunk = window.electronAPI.onClaudeStreamChunk(
      (id: string, chunk: StreamingChunk) => {
        if (id === agentId) {
          setStreamingText(chunk.fullText)
        }
      }
    )

    // Subscribe to state changes
    const unsubState = window.electronAPI.onClaudeJsonStateChanged(
      (id: string, state: ClaudeAgentState) => {
        if (id === agentId) {
          setAgentState(state)
        }
      }
    )

    return () => {
      unsubItem()
      unsubChunk()
      unsubState()
    }
  }, [agentId])

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (shouldAutoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [items, streamingText])

  return (
    <div className="conversation-view" ref={containerRef} onScroll={handleScroll}>
      {items.length === 0 && !streamingText && (
        <div className="conversation-empty">
          {agentState === 'initializing' ? (
            <span>Starting Claude session...</span>
          ) : (
            <span>No conversation yet</span>
          )}
        </div>
      )}

      {items.map((item) => (
        <ConversationItemView
          key={item.id}
          item={item}
          defaultCollapsed={collapseToolResults && item.type === 'tool_result'}
        />
      ))}

      {streamingText && (
        <div className="conversation-item assistant-text streaming">
          <div className="item-icon">AI</div>
          <div className="item-body">
            <div className="item-content">{streamingText}</div>
            <span className="streaming-indicator" />
          </div>
        </div>
      )}

      {agentState === 'working' && !streamingText && items.length > 0 && (
        <div className="conversation-working">
          <span className="working-indicator" />
          <span>Claude is working...</span>
        </div>
      )}
    </div>
  )
}

interface ConversationItemViewProps {
  item: ConversationItem
  defaultCollapsed?: boolean
}

function ConversationItemView({
  item,
  defaultCollapsed = false
}: ConversationItemViewProps): JSX.Element {
  const [expanded, setExpanded] = useState(!defaultCollapsed)

  const getIcon = (): string => {
    switch (item.type) {
      case 'user_prompt':
        return 'You'
      case 'assistant_text':
        return 'AI'
      case 'tool_use':
        return getToolIcon(item.toolName || '')
      case 'tool_result':
        return item.isError ? '!' : '>'
      case 'thinking':
        return '...'
      case 'error':
        return '!'
      default:
        return '?'
    }
  }

  const getToolIcon = (toolName: string): string => {
    if (toolName.includes('Read') || toolName.includes('Glob') || toolName.includes('Grep')) {
      return 'R'
    }
    if (toolName.includes('Write') || toolName.includes('Edit')) {
      return 'W'
    }
    if (toolName.includes('Bash')) {
      return '$'
    }
    if (toolName.includes('Task')) {
      return 'T'
    }
    return 'F'
  }

  const getItemClass = (): string => {
    const classes = ['conversation-item', item.type]
    if (item.isError) classes.push('error')
    if (item.isTruncated) classes.push('truncated')
    return classes.join(' ')
  }

  const isCollapsible = item.type === 'tool_use' || item.type === 'tool_result' || item.type === 'thinking'

  return (
    <div className={getItemClass()}>
      <div className={`item-icon ${item.type}`}>{getIcon()}</div>
      <div className="item-body">
        {/* Header for collapsible items */}
        {isCollapsible && (
          <div
            className="item-header"
            onClick={() => setExpanded(!expanded)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
          >
            {item.type === 'tool_use' && (
              <>
                <span className="tool-name">{item.toolName}</span>
                {item.toolInput && 'file_path' in item.toolInput && (
                  <span className="tool-path">{String(item.toolInput.file_path)}</span>
                )}
              </>
            )}
            {item.type === 'tool_result' && (
              <span className="result-label">{item.isError ? 'Error' : 'Result'}</span>
            )}
            {item.type === 'thinking' && <span className="thinking-label">Thinking...</span>}
            <span className={`expand-icon ${expanded ? 'expanded' : ''}`}>
              {expanded ? '\u25BC' : '\u25B6'}
            </span>
          </div>
        )}

        {/* Content */}
        {(expanded || !isCollapsible) && (
          <div className="item-content">
            {item.type === 'assistant_text' || item.type === 'user_prompt' ? (
              <MarkdownContent content={item.content} />
            ) : (
              <pre>{item.content}</pre>
            )}
            {item.isTruncated && (
              <div className="truncated-notice">Output truncated for memory efficiency</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface MarkdownContentProps {
  content: string
}

function MarkdownContent({ content }: MarkdownContentProps): JSX.Element {
  // Simple markdown rendering - just handle code blocks and basic formatting
  // For a full implementation, consider using react-markdown
  const parts = content.split(/(```[\s\S]*?```)/g)

  return (
    <div className="markdown-content">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          // Code block
          const lines = part.slice(3, -3).split('\n')
          const language = lines[0] || ''
          const code = lines.slice(1).join('\n')
          return (
            <pre key={index} className={`code-block language-${language}`}>
              <code>{code || lines[0]}</code>
            </pre>
          )
        }
        // Regular text - preserve newlines
        return (
          <span key={index}>
            {part.split('\n').map((line, lineIndex, arr) => (
              <span key={lineIndex}>
                {line}
                {lineIndex < arr.length - 1 && <br />}
              </span>
            ))}
          </span>
        )
      })}
    </div>
  )
}

export default ConversationView
