import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import PlainTerminal from './PlainTerminal'
import TestEnvTerminal from './TestEnvTerminal'
import ConfirmModal from './ConfirmModal'
import LoadingModal from './LoadingModal'
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
  prUrl?: string
  prStatus?: string
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
  const [activeTab, setActiveTab] = useState<string>('agent')
  const [testEnvCommands, setTestEnvCommands] = useState<any[]>([])
  const [testEnvStatuses, setTestEnvStatuses] = useState<any[]>([])
  const [showPRConfirm, setShowPRConfirm] = useState(false)
  const [autoCommit, setAutoCommit] = useState(true)
  const [isCreatingPR, setIsCreatingPR] = useState(false)
  const [isTearingDown, setIsTearingDown] = useState(false)
  const [plainTerminals, setPlainTerminals] = useState<string[]>(['terminal-1'])
  const [terminalCounter, setTerminalCounter] = useState(1)

  const prMessages = [
    'Stuffing code into a rocket...',
    'Learning to speak Human for the PR description...',
    'Bribing the CI/CD pipeline with bananas...',
    'Checking for accidentally committed secret cookie recipes...',
    'Pushing code to the moon...',
    'Summoning the code review council (Kevin, Stuart, and Bob)...',
    'Crossing fingers and toes...'
  ]

  const teardownMessages = [
    'Returning minion to the break room...',
    'Cleaning up banana peels from the workspace...',
    'Shredding incriminating documents...',
    'Wiping fingerprints from the keyboard...',
    'Returning stolen shrink rays...',
    'Escaping before Gru finds out...',
    'Restocking the vending machine...'
  ]

  useEffect(() => {
    if (!agentId) return

    loadAgentData()
    loadTestEnvConfig()
    loadTestEnvStatus()

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

    // Listen for test env lifecycle events
    const unsubscribeStarted = window.electronAPI.onTestEnvStarted((id) => {
      if (id === agentId) loadTestEnvStatus()
    })

    const unsubscribeStopped = window.electronAPI.onTestEnvStopped((id) => {
      if (id === agentId) loadTestEnvStatus()
    })

    const unsubscribeExited = window.electronAPI.onTestEnvExited((id) => {
      if (id === agentId) loadTestEnvStatus()
    })

    return () => {
      unsubscribeSignal()
      unsubscribeUpdate()
      unsubscribeStarted()
      unsubscribeStopped()
      unsubscribeExited()
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

  const loadTestEnvConfig = async () => {
    try {
      const config = await window.electronAPI.getTestEnvConfig()
      setTestEnvCommands(config.defaultCommands || [])
    } catch (error) {
      console.error('Error loading test env config:', error)
    }
  }

  const loadTestEnvStatus = async () => {
    if (!agentId) return
    try {
      const statuses = await window.electronAPI.getTestEnvStatus(agentId)
      setTestEnvStatuses(statuses)
    } catch (error) {
      console.error('Error loading test env status:', error)
    }
  }

  const handleStartTestEnv = async (commandId: string) => {
    if (!agentId) return
    try {
      await window.electronAPI.startTestEnv(agentId, commandId)
      await loadTestEnvStatus()
      setActiveTab(commandId)
    } catch (error: any) {
      alert('Error starting test environment: ' + error.message)
    }
  }

  const handleStopTestEnv = async (commandId: string) => {
    if (!agentId) return
    try {
      await window.electronAPI.stopTestEnv(agentId, commandId)
      await loadTestEnvStatus()
    } catch (error: any) {
      alert('Error stopping test environment: ' + error.message)
    }
  }

  const getTestEnvStatus = (commandId: string): boolean => {
    const status = testEnvStatuses.find(s => s.commandId === commandId)
    return status?.isRunning || false
  }

  const handleSignal = (signal: string) => {
    const messages: Record<string, string> = {
      PLAN_READY: '✓ Plan is ready for review',
      DEV_COMPLETED: '✓ Development completed',
      BLOCKER: '⚠️ Minion is blocked and needs attention',
      QUESTION: '? Minion has a question',
      WORKING: '⟳ Minion is working...'
    }

    setSignalMessage(messages[signal] || signal)

    // Auto-clear after 5 seconds for non-critical signals
    if (!['BLOCKER', 'QUESTION'].includes(signal)) {
      setTimeout(() => setSignalMessage(''), 5000)
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
      setShowCleanupModal(false)
      
      if (cleanupAction === 'teardown') {
        setIsTearingDown(true)
        await window.electronAPI.teardownAgent(agentId, false)
        setIsTearingDown(false)
      } else {
        await window.electronAPI.unassignAgent(agentId)
      }
      
      // Navigate back to home
      navigate('/workspace')
    } catch (error: any) {
      setIsTearingDown(false)
      
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
      setShowForceModal(false)
      setIsTearingDown(true)
      await window.electronAPI.teardownAgent(agentId, true)
      setIsTearingDown(false)
      
      // Navigate back to home
      navigate('/workspace')
    } catch (error: any) {
      setIsTearingDown(false)
      alert(`Error during force teardown: ${error.message}`)
    }
  }

  const handleCreatePRClick = () => {
    setAutoCommit(true)
    setShowPRConfirm(true)
  }

  const handleConfirmCreatePR = async () => {
    if (!assignment) return

    try {
      setIsCreatingPR(true)
      setShowPRConfirm(false)

      console.log('[AgentView] Creating PR for:', assignment.id, 'autoCommit:', autoCommit)
      const result = await window.electronAPI.createPullRequest(assignment.id, autoCommit)
      
      // Show success with link
      alert(`Pull Request created successfully!\n\n${result.url}\n\nOpening in browser...`)
      window.open(result.url, '_blank')
      
      // Reload agent data to reflect new status
      loadAgentData()
    } catch (error: any) {
      alert(`Failed to create PR: ${error.message}`)
    } finally {
      setIsCreatingPR(false)
    }
  }

  const handleAddTerminal = () => {
    const newCounter = terminalCounter + 1
    const newTerminalId = `terminal-${newCounter}`
    setPlainTerminals([...plainTerminals, newTerminalId])
    setTerminalCounter(newCounter)
    setActiveTab(newTerminalId)
  }

  const handleCloseTerminal = (terminalId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    // Don't close if it's the last terminal
    if (plainTerminals.length === 1) return
    
    // Remove from list
    const newTerminals = plainTerminals.filter(id => id !== terminalId)
    setPlainTerminals(newTerminals)
    
    // If we're closing the active tab, switch to another
    if (activeTab === terminalId) {
      const index = plainTerminals.indexOf(terminalId)
      const newActiveIndex = index > 0 ? index - 1 : 0
      setActiveTab(newTerminals[newActiveIndex] || 'agent')
    }
    
    // Stop the backend terminal
    if (agentId) {
      window.electronAPI.stopPlainTerminal(`${agentId}-${terminalId}`)
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
        </div>

        <div className="agent-actions">
          {currentTool !== 'cursor' && isRunning && (
            <button onClick={handleStopAgent} className="danger">
              Stop
            </button>
          )}
          <button onClick={handleOpenCursor}>Open in Cursor</button>

          {assignment && (assignment.status === 'pr_open' || assignment.status === 'merged' || assignment.status === 'closed') && assignment.prUrl && (
            <button 
              onClick={() => window.open(assignment.prUrl, '_blank')}
              className="primary"
            >
              Open PR
            </button>
          )}

          {assignment && assignment.status !== 'pr_open' && assignment.status !== 'merged' && assignment.status !== 'closed' && (
            <button 
              onClick={handleCreatePRClick} 
              className="success"
              disabled={isCreatingPR}
            >
              {isCreatingPR ? 'Creating PR...' : 'Make PR'}
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

      {assignment && (
        <div className="agent-info-bar">
          <div className="info-item">
            <span className="info-label">Feature:</span>
            <span className="info-value">{assignment.feature}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Branch:</span>
            <span className="info-value">{assignment.branch}</span>
          </div>
          <div className="info-item">
            <span className="info-label">Status:</span>
            <span className="info-value">{assignment.status}</span>
          </div>
        </div>
      )}

      {signalMessage && (
        <div className={`signal-message ${signalMessage.includes('⚠️') ? 'warning' : 'info'}`}>
          {signalMessage}
        </div>
      )}

      <div className="agent-content">
        <div className="unified-tabs">
          {/* Agent Terminal Tab (or Cursor placeholder) */}
          <div
            className={`unified-tab ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <span className="tab-icon">🍌</span>
            <span className="tab-name">
              {currentTool === 'cursor' && !isRunning ? 'Cursor IDE' : 'Minion Terminal'}
            </span>
          </div>

          {/* Plain Terminal Tabs */}
          {plainTerminals.map((terminalId, index) => (
            <div
              key={terminalId}
              className={`unified-tab ${activeTab === terminalId ? 'active' : ''}`}
              onClick={() => setActiveTab(terminalId)}
            >
              <span className="tab-icon">⌨️</span>
              <span className="tab-name">Terminal {index + 1}</span>
              {plainTerminals.length > 1 && (
                <button 
                  className="tab-action close"
                  onClick={(e) => handleCloseTerminal(terminalId, e)}
                  title="Close terminal"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {/* Test Environment Tabs */}
          {testEnvCommands.map(cmd => {
            const isRunning = getTestEnvStatus(cmd.id)
            return (
              <div
                key={cmd.id}
                className={`unified-tab ${activeTab === cmd.id ? 'active' : ''}`}
                onClick={() => setActiveTab(cmd.id)}
              >
                <span className={`status-dot ${isRunning ? 'running' : 'stopped'}`} />
                <span className="tab-name">{cmd.name}</span>
                {cmd.port && <span className="tab-port">:{cmd.port}</span>}
                {isRunning ? (
                  <button 
                    className="tab-action stop"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStopTestEnv(cmd.id)
                    }}
                  >
                    ⬛
                  </button>
                ) : (
                  <button 
                    className="tab-action start"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartTestEnv(cmd.id)
                    }}
                  >
                    ▶
                  </button>
                )}
              </div>
            )
          })}

          {/* Add Terminal Button */}
          <div
            className="unified-tab add-tab"
            onClick={handleAddTerminal}
            title="Add new terminal"
          >
            <span className="tab-icon">➕</span>
          </div>
        </div>

        <div className="unified-terminal-container">
          {activeTab === 'agent' && (
            currentTool === 'cursor' && !isRunning ? (
              <div className="placeholder">
                <div className="placeholder-icon">🍌</div>
                <div className="placeholder-text">
                  <p>This minion uses Cursor IDE.</p>
                  <p>Click "Open in Cursor" to start working.</p>
                </div>
              </div>
            ) : (
              agentId && <Terminal agentId={agentId} />
            )
          )}
          {plainTerminals.map(terminalId => (
            activeTab === terminalId && agentId && (
              <PlainTerminal key={terminalId} agentId={agentId} terminalId={terminalId} />
            )
          ))}
          {testEnvCommands.map(cmd => (
            activeTab === cmd.id && agentId && (
              <TestEnvTerminal key={cmd.id} agentId={agentId} commandId={cmd.id} />
            )
          ))}
        </div>
      </div>

      <ConfirmModal
        isOpen={showCleanupModal}
        title={cleanupAction === 'teardown' ? 'Teardown Minion?' : 'Unassign Minion?'}
        message={
          cleanupAction === 'teardown'
            ? `This will remove the worktree for ${agentId}. Any uncommitted changes will be lost. This action cannot be undone.`
            : `This will unassign ${agentId} and make it available for new missions. The worktree will be kept.`
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

      {showPRConfirm && assignment && (
        <div className="modal-overlay" onClick={() => setShowPRConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create Pull Request</h2>
            <p>
              This will push the branch and create a PR on GitHub for:
            </p>
            <div className="merge-info">
              <div><strong>Agent:</strong> {assignment.agentId}</div>
              <div><strong>Branch:</strong> {assignment.branch}</div>
              <div><strong>Feature:</strong> {assignment.feature}</div>
            </div>
            <div className="form-group checkbox-group" style={{ marginTop: '16px' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={autoCommit}
                  onChange={(e) => setAutoCommit(e.target.checked)}
                />
                <span className="checkbox-text">Auto-commit uncommitted changes</span>
              </label>
              <div className="form-hint">
                If checked, any uncommitted changes will be automatically committed before creating the PR.
              </div>
            </div>
            <p className="warning-text">
              The branch will be pushed to origin and a pull request will be created
              using the GitHub CLI. You can then review and merge it on GitHub.
            </p>
            <div className="form-actions">
              <button type="button" onClick={() => setShowPRConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={handleConfirmCreatePR}>
                Create PR
              </button>
            </div>
          </div>
        </div>
      )}

      <LoadingModal
        isOpen={isCreatingPR}
        messages={prMessages}
        title="Creating Pull Request..."
      />

      <LoadingModal
        isOpen={isTearingDown}
        messages={teardownMessages}
        title="Archiving Mission..."
      />
    </div>
  )
}

export default AgentView

