import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import ConfirmModal from './ConfirmModal'
import './AgentView.css'

interface AgentViewProps {
  project: any
}

interface Assignment {
  id: string
  agentId: string
  branch: string
  feature: string
  status: string
  specFile: string
  tool: string
  model?: string
  mode: string
}

interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
}

function AgentView({}: AgentViewProps) {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<AgentSession | null>(null)
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [currentTool, setCurrentTool] = useState('claude')
  const [currentModel, setCurrentModel] = useState('opus')
  const [currentMode, setCurrentMode] = useState('idle')
  const [signalMessage, setSignalMessage] = useState<string>('')
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [cleanupAction, setCleanupAction] = useState<'teardown' | 'unassign'>('unassign')
  const [showForceModal, setShowForceModal] = useState(false)
  const [_teardownError, setTeardownError] = useState<string>('')

  useEffect(() => {
    if (!agentId) return

    loadAgentData()

    // Listen for signals
    const unsubscribeSignal = window.electronAPI.onAgentSignal((id, signal) => {
      if (id === agentId) {
        handleSignal(signal)
      }
    })

    // Listen for agent updates
    const unsubscribeUpdate = window.electronAPI.onAgentListUpdate(() => {
      loadAgentData()
    })

    return () => {
      unsubscribeSignal()
      unsubscribeUpdate()
    }
  }, [agentId])

  const loadAgentData = async () => {
    if (!agentId) return

    // Load agent session
    const agents = await window.electronAPI.listAgents()
    const agentData = agents.find((a: AgentSession) => a.id === agentId)
    setAgent(agentData || null)

    // Load assignment
    const assignments = await window.electronAPI.getAssignments()
    const assignmentData = assignments.assignments.find((a: Assignment) => a.agentId === agentId)
    setAssignment(assignmentData || null)

    if (assignmentData) {
      setCurrentTool(assignmentData.tool)
      setCurrentModel(assignmentData.model || 'opus')
      setCurrentMode(assignmentData.mode)
    }
  }

  const handleSignal = (signal: string) => {
    const messages: Record<string, string> = {
      PLAN_READY: '✓ Plan is ready for review',
      DEV_COMPLETED: '✓ Development completed',
      BLOCKER: '⚠️ Agent is blocked and needs attention',
      QUESTION: '? Agent has a question',
      WORKING: '⟳ Agent is working...'
    }

    setSignalMessage(messages[signal] || signal)

    // Auto-clear after 5 seconds for non-critical signals
    if (!['BLOCKER', 'QUESTION'].includes(signal)) {
      setTimeout(() => setSignalMessage(''), 5000)
    }
  }

  const handleStartAgent = async () => {
    if (!agentId || currentTool === 'cursor') return

    try {
      await window.electronAPI.startAgent(agentId, currentTool, currentMode, currentModel)
      loadAgentData()
    } catch (error: any) {
      alert('Error starting agent: ' + error.message)
    }
  }

  const handleStopAgent = async () => {
    if (!agentId) return

    try {
      await window.electronAPI.stopAgent(agentId)
      loadAgentData()
    } catch (error: any) {
      alert('Error stopping agent: ' + error.message)
    }
  }

  const handleOpenCursor = async () => {
    if (!agentId) return

    try {
      await window.electronAPI.openInCursor(agentId)
    } catch (error: any) {
      alert('Error opening Cursor: ' + error.message)
    }
  }

  const handleToolChange = async (tool: string) => {
    setCurrentTool(tool)
    // Set appropriate default model when switching tools
    const defaultModel = tool === 'cursor-cli' ? 'auto' : 'opus'
    setCurrentModel(defaultModel)
    if (assignment) {
      await window.electronAPI.updateAssignment(assignment.id, { tool, model: defaultModel })
    }
  }

  const handleModelChange = async (model: string) => {
    setCurrentModel(model)
    if (assignment) {
      await window.electronAPI.updateAssignment(assignment.id, { model })
    }
  }

  const handleModeChange = async (mode: string) => {
    setCurrentMode(mode)
    if (assignment) {
      await window.electronAPI.updateAssignment(assignment.id, { mode })
    }
  }

  const handleCleanupClick = (action: 'teardown' | 'unassign') => {
    setCleanupAction(action)
    setShowCleanupModal(true)
  }

  const handleConfirmCleanup = async () => {
    if (!agentId) return

    try {
      if (cleanupAction === 'teardown') {
        await window.electronAPI.teardownAgent(agentId, false)
      } else {
        await window.electronAPI.unassignAgent(agentId)
      }
      setShowCleanupModal(false)
      // Navigate back to home
      navigate('/workspace')
    } catch (error: any) {
      setShowCleanupModal(false)
      
      // Check if error is due to uncommitted changes
      if (cleanupAction === 'teardown' && error.message.includes('uncommitted changes')) {
        setTeardownError(error.message)
        setShowForceModal(true)
      } else {
        alert(`Error during cleanup: ${error.message}`)
      }
    }
  }

  const handleForceTeardown = async () => {
    if (!agentId) return

    try {
      await window.electronAPI.teardownAgent(agentId, true)
      setShowForceModal(false)
      // Navigate back to home
      navigate('/workspace')
    } catch (error: any) {
      alert(`Error during force teardown: ${error.message}`)
      setShowForceModal(false)
    }
  }

  const handleMarkComplete = async () => {
    if (!assignment) return

    try {
      await window.electronAPI.updateAssignment(assignment.id, { status: 'completed' })
      loadAgentData()
    } catch (error: any) {
      alert(`Error marking complete: ${error.message}`)
    }
  }

  if (!agent) {
    return (
      <div className="agent-view">
        <div className="agent-view-error">Agent not found: {agentId}</div>
      </div>
    )
  }

  const isRunning = agent.terminalPid !== null

  return (
    <div className="agent-view">
      <div className="agent-header">
        <div className="agent-title">
          <h2>{agentId}</h2>
          {assignment && <span className="feature-name">{assignment.feature}</span>}
        </div>

        <div className="agent-controls">
          <div className="control-group">
            <label>Tool:</label>
            <select value={currentTool} onChange={(e) => handleToolChange(e.target.value)} disabled={isRunning}>
              <option value="claude">Claude</option>
              <option value="cursor">Cursor</option>
              <option value="cursor-cli">Cursor CLI</option>
            </select>
          </div>

          {currentTool === 'claude' && (
            <div className="control-group">
              <label>Model:</label>
              <select value={currentModel} onChange={(e) => handleModelChange(e.target.value)} disabled={isRunning}>
                <option value="haiku">Haiku</option>
                <option value="sonnet">Sonnet</option>
                <option value="opus">Opus</option>
              </select>
            </div>
          )}

          {currentTool === 'cursor-cli' && (
            <div className="control-group">
              <label>Model:</label>
              <select value={currentModel} onChange={(e) => handleModelChange(e.target.value)} disabled={isRunning}>
                <option value="composer-1">Composer 1</option>
                <option value="auto">Auto</option>
                <option value="sonnet-4.5">Sonnet 4.5</option>
                <option value="sonnet-4.5-thinking">Sonnet 4.5 Thinking</option>
                <option value="opus-4.5">Opus 4.5</option>
                <option value="opus-4.5-thinking">Opus 4.5 Thinking</option>
                <option value="opus-4.1">Opus 4.1</option>
                <option value="gemini-3-pro">Gemini 3 Pro</option>
                <option value="gemini-3-flash">Gemini 3 Flash</option>
                <option value="gpt-5.2">GPT 5.2</option>
                <option value="gpt-5.2-high">GPT 5.2 High</option>
                <option value="gpt-5.1">GPT 5.1</option>
                <option value="gpt-5.1-high">GPT 5.1 High</option>
                <option value="gpt-5.1-codex">GPT 5.1 Codex</option>
                <option value="gpt-5.1-codex-high">GPT 5.1 Codex High</option>
                <option value="gpt-5.1-codex-max">GPT 5.1 Codex Max</option>
                <option value="gpt-5.1-codex-max-high">GPT 5.1 Codex Max High</option>
                <option value="grok">Grok</option>
              </select>
            </div>
          )}

          {currentTool !== 'cursor-cli' && (
            <div className="control-group">
              <label>Mode:</label>
              <select value={currentMode} onChange={(e) => handleModeChange(e.target.value)} disabled={isRunning}>
                <option value="idle">Idle</option>
                <option value="planning">Planning</option>
                <option value="dev">Development</option>
              </select>
            </div>
          )}

          {assignment && <div className="branch-info">Branch: {assignment.branch}</div>}
        </div>

        <div className="agent-actions">
          {currentTool !== 'cursor' && (
            <>
              {!isRunning && (
                <button onClick={handleStartAgent} className="primary">
                  Start
                </button>
              )}
              {isRunning && (
                <button onClick={handleStopAgent} className="danger">
                  Stop
                </button>
              )}
            </>
          )}
          <button onClick={handleOpenCursor}>Open in Cursor</button>

          {assignment && assignment.status !== 'completed' && assignment.status !== 'merging' && (
            <button onClick={handleMarkComplete} className="success">
              Mark Complete
            </button>
          )}

          <div className="cleanup-dropdown">
            <button className="cleanup-button">Cleanup ▾</button>
            <div className="cleanup-menu">
              <button onClick={() => handleCleanupClick('unassign')}>Unassign</button>
              <button onClick={() => handleCleanupClick('teardown')} className="danger-text">
                Teardown
              </button>
            </div>
          </div>
        </div>
      </div>

      {signalMessage && (
        <div className={`signal-message ${signalMessage.includes('⚠️') ? 'warning' : 'info'}`}>
          {signalMessage}
        </div>
      )}

      <div className="agent-content">
        {currentTool === 'cursor' && !isRunning ? (
          <div className="placeholder">
            <div className="placeholder-icon">💬</div>
            <div className="placeholder-text">
              <p>This agent uses Cursor IDE.</p>
              <p>Click "Open in Cursor" to start working.</p>
            </div>
          </div>
        ) : (
          agentId && <Terminal agentId={agentId} />
        )}
      </div>

      <ConfirmModal
        isOpen={showCleanupModal}
        title={cleanupAction === 'teardown' ? 'Teardown Agent?' : 'Unassign Agent?'}
        message={
          cleanupAction === 'teardown'
            ? `This will remove the worktree for ${agentId}. Any uncommitted changes will be lost. This action cannot be undone.`
            : `This will unassign ${agentId} and make it available for new tasks. The worktree will be kept.`
        }
        confirmText={cleanupAction === 'teardown' ? 'Teardown' : 'Unassign'}
        confirmVariant={cleanupAction === 'teardown' ? 'danger' : 'primary'}
        onConfirm={handleConfirmCleanup}
        onCancel={() => setShowCleanupModal(false)}
      />

      <ConfirmModal
        isOpen={showForceModal}
        title="Uncommitted Changes Detected"
        message={`${agentId} has uncommitted changes. Force teardown will permanently delete all uncommitted work. Are you sure you want to proceed?`}
        confirmText="Force Teardown"
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={handleForceTeardown}
        onCancel={() => setShowForceModal(false)}
      />
    </div>
  )
}

export default AgentView

