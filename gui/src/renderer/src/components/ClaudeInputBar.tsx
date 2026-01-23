import { useState, useRef, useEffect, useCallback } from 'react'
import type { ClaudeWaitingReason, ClaudeAgentState } from '../../../shared/types/claudeJson'
import './ClaudeInputBar.css'

interface ClaudeInputBarProps {
  agentId: string
  state: ClaudeAgentState
  waitingReason?: ClaudeWaitingReason
  onSend: (input: string) => void
}

export function ClaudeInputBar({
  agentId: _agentId,
  state,
  waitingReason,
  onSend
}: ClaudeInputBarProps): JSX.Element {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isWaiting = state === 'waiting'
  const isCompleted = state === 'completed' || state === 'error'

  // Auto-focus when waiting
  useEffect(() => {
    if (isWaiting && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isWaiting])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || !isWaiting) return
    onSend(input.trim())
    setInput('')
  }, [input, isWaiting, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleApprove = useCallback(() => {
    onSend('yes')
  }, [onSend])

  const handleReject = useCallback(() => {
    onSend('no')
  }, [onSend])

  // Show approval UI for permission requests
  if (waitingReason?.type === 'permission_required' || waitingReason?.type === 'plan_approval') {
    return (
      <div className="claude-input-bar approval-mode">
        <div className="approval-header">
          <span className="approval-icon">?</span>
          <span className="approval-title">
            {waitingReason.type === 'plan_approval'
              ? 'Plan Approval Required'
              : `Approve: ${waitingReason.toolName}`}
          </span>
        </div>

        {waitingReason.toolInput && (
          <div className="approval-details">
            <pre>{JSON.stringify(waitingReason.toolInput, null, 2)}</pre>
          </div>
        )}

        <div className="approval-actions">
          <button className="approve-btn" onClick={handleApprove}>
            Approve
          </button>
          <button className="reject-btn" onClick={handleReject}>
            Reject
          </button>
        </div>
      </div>
    )
  }

  // Show question UI
  if (waitingReason?.type === 'question') {
    return (
      <div className="claude-input-bar question-mode">
        <div className="question-header">
          <span className="question-icon">?</span>
          <span className="question-text">
            {waitingReason.question || 'Claude has a question'}
          </span>
        </div>

        <div className="input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
            rows={2}
            className="input-textarea"
          />
          <button
            className="send-btn"
            onClick={handleSubmit}
            disabled={!input.trim()}
            title="Send answer (Enter)"
          >
            Send
          </button>
        </div>
      </div>
    )
  }

  // Completed state
  if (isCompleted) {
    return (
      <div className="claude-input-bar completed-mode">
        <div className="completed-message">
          {state === 'error' ? (
            <>
              <span className="error-icon">!</span>
              <span>Session ended with an error</span>
            </>
          ) : (
            <>
              <span className="success-icon">OK</span>
              <span>Session completed</span>
            </>
          )}
        </div>
      </div>
    )
  }

  // Regular input for follow-up messages
  return (
    <div className={`claude-input-bar ${isWaiting ? 'waiting-mode' : 'working-mode'}`}>
      <div className="input-row">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isWaiting ? 'Send a follow-up message...' : 'Claude is working...'
          }
          disabled={!isWaiting}
          rows={2}
          className="input-textarea"
        />
        <button
          className="send-btn"
          onClick={handleSubmit}
          disabled={!isWaiting || !input.trim()}
          title="Send message (Enter)"
        >
          Send
        </button>
      </div>

      {!isWaiting && (
        <div className="status-indicator">
          <span className="working-dot" />
          <span>Claude is {state === 'initializing' ? 'starting' : 'working'}...</span>
        </div>
      )}
    </div>
  )
}

export default ClaudeInputBar
