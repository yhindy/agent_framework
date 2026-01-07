import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import PlainTerminal from './PlainTerminal'
import TestEnvTerminal from './TestEnvTerminal'
import ConfirmModal from './ConfirmModal'
import { usePRCreation } from '../hooks/usePRCreation'
import { useLoadingSnackbar } from '../hooks/useLoadingSnackbar'
import { debounce } from '../utils/debounce'
import './AgentView.css'

interface AgentViewProps {
  activeProjects: any[]
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
  isBaseBranchAgent?: boolean
}

interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
}

function AgentView({ activeProjects }: AgentViewProps) {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<AgentSession | null>(null)
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [cleanupAction, setCleanupAction] = useState<'teardown' | 'unassign'>('unassign')
  const [showForceModal, setShowForceModal] = useState(false)
  const [_teardownError, setTeardownError] = useState<string>('')
  const [activeTab, setActiveTab] = useState<string>('agent')
  const [testEnvCommands, setTestEnvCommands] = useState<any[]>([])
  const [testEnvStatuses, setTestEnvStatuses] = useState<any[]>([])
  const [plainTerminals, setPlainTerminals] = useState<string[]>(['terminal-1'])
  const [terminalCounter, setTerminalCounter] = useState(1)
  const { showLoading, hideLoading } = useLoadingSnackbar()

  // Track if we've auto-focused on initial load
  const hasAutoFocused = useRef(false)

  // Debounced save for UI state
  const saveUIStateDebounced = useRef(
    debounce(async (agentId: string, uiState: any) => {
      try {
        await window.electronAPI.saveUIState(agentId, uiState)
      } catch (err) {
        console.error('Failed to save UI state:', err)
      }
    }, 1000)
  ).current

  const {
    showPRConfirm,
    setShowPRConfirm,
    autoCommit,
    setAutoCommit,
    isCreatingPR,
    prMessages,
    handleCreatePRClick,
    handleConfirmCreatePR: handleConfirmCreatePRHook
  } = usePRCreation()

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
      unsubscribeUpdate()
      unsubscribeStarted()
      unsubscribeStopped()
      unsubscribeExited()
    }
  }, [agentId])

  // Save UI state when it changes
  useEffect(() => {
    if (!agentId) return

    const uiState = {
      lastActiveTab: activeTab,
      plainTerminals,
      terminalCounter,
      lastFocusTime: new Date().toISOString()
    }

    saveUIStateDebounced(agentId, uiState)
  }, [activeTab, plainTerminals, terminalCounter, agentId, saveUIStateDebounced])

  // Cleanup debounced save on unmount
  useEffect(() => {
    return () => {
      saveUIStateDebounced.cancel()
    }
  }, [saveUIStateDebounced])

  const loadAgentData = async () => {
    if (!agentId) return

    // Load agent session - search across all active projects
    let agentData: AgentSession | null = null
    let assignmentData: Assignment | null = null

    for (const project of activeProjects) {
      try {
        const agents = await window.electronAPI.listAgentsForProject(project.path)
        const found = agents.find((a: AgentSession) => a.id === agentId)
        if (found) {
          agentData = found
          
          // Also load assignment from this project
          const assignments = await window.electronAPI.getAssignmentsForProject(project.path)
          assignmentData = assignments.assignments.find((a: Assignment) => a.agentId === agentId) || null
          break
        }
      } catch (err) {
        console.error(`Failed to search project ${project.path}:`, err)
      }
    }

    setAgent(agentData)
    setAssignment(assignmentData)

    // Restore UI state if available
    if (agentData?.uiState) {
      const { lastActiveTab, plainTerminals: savedTerminals, terminalCounter: savedCounter } = agentData.uiState

      // Validate terminal counter against saved terminals
      const maxTerminalNum = Math.max(
        ...savedTerminals.map(id => parseInt(id.split('-')[1]) || 0),
        0
      )
      const restoredCounter = Math.max(savedCounter, maxTerminalNum)

      // Validate active tab exists (wait for test env commands to be loaded)
      // For now just restore, validation will happen when rendering
      setPlainTerminals(savedTerminals)
      setTerminalCounter(restoredCounter)
      setActiveTab(lastActiveTab)
    }
  }

  const loadTestEnvConfig = async () => {
    try {
      const config = await window.electronAPI.getTestEnvConfig(agentId)
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

  const getStatusClass = (status: string): string => {
    switch(status) {
      case 'working': return 'working'
      case 'pr_open': return 'pr_open'
      case 'merged': return 'merged'
      case 'idle': return 'idle'
      default: return 'idle'
    }
  }

  const handleCopyToClipboard = (text: string, e?: React.MouseEvent) => {
    navigator.clipboard.writeText(text)
    // Provide quick visual feedback on the element itself
    if (e?.currentTarget) {
      const element = e.currentTarget
      element.classList.add('copy-flash')
      setTimeout(() => element.classList.remove('copy-flash'), 300)
    }
  }

  const handleCleanupClick = (action: 'teardown' | 'unassign') => {
    setCleanupAction(action)
    setShowCleanupModal(true)
  }

  const handleConfirmCleanup = async () => {
    if (!agentId) return

    let snackbarId: string | undefined
    try {
      setShowCleanupModal(false)

      if (cleanupAction === 'teardown') {
        snackbarId = showLoading({
          title: 'Archiving Mission...',
          messages: teardownMessages
        })
        await window.electronAPI.teardownAgent(agentId, false)
        hideLoading(snackbarId)
      } else {
        await window.electronAPI.unassignAgent(agentId)
      }

      // Navigate back to home
      navigate('/workspace')
    } catch (error: any) {
      if (snackbarId) hideLoading(snackbarId)

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

    const snackbarId = showLoading({
      title: 'Force Archiving Mission...',
      messages: teardownMessages
    })
    try {
      setShowForceModal(false)
      await window.electronAPI.teardownAgent(agentId, true)
      hideLoading(snackbarId)

      // Navigate back to home
      navigate('/workspace')
    } catch (error: any) {
      hideLoading(snackbarId)
      alert(`Error during force teardown: ${error.message}`)
    }
  }

  const handleConfirmCreatePR = async () => {
    if (!assignment) return
    await handleConfirmCreatePRHook(assignment.id, loadAgentData)
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
        <div className="agent-header-left">
          <div className="agent-title">
            <h2>🍌 {agentId}</h2>
          </div>

          {assignment && (
            <>
              <div className="info-badge feature-badge">
                <span className="info-badge-label">Feature:</span>
                <span
                  className="info-badge-value copyable"
                  data-tooltip={assignment.feature}
                  onClick={(e) => handleCopyToClipboard(assignment.feature, e as any)}
                  role="button"
                  tabIndex={0}
                >
                  {assignment.feature}
                </span>
              </div>

              <div className="info-badge branch-badge">
                <span
                  className="info-badge-value copyable"
                  data-tooltip={assignment.branch}
                  onClick={(e) => handleCopyToClipboard(assignment.branch, e as any)}
                  role="button"
                  tabIndex={0}
                >
                  {assignment.branch}
                </span>
              </div>

              <div className="status-badge">
                <span className={`status-dot ${getStatusClass(assignment.status)}`} />
                <span
                  className="copyable"
                  data-tooltip={assignment.status}
                  onClick={(e) => handleCopyToClipboard(assignment.status, e as any)}
                  role="button"
                  tabIndex={0}
                >
                  {assignment.status}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="agent-actions">
          {assignment?.tool !== 'cursor' && isRunning && (
            <button onClick={handleStopAgent} className="danger icon-button" title="Stop Agent">
              ⏹️
            </button>
          )}
          <button onClick={handleOpenCursor} className="icon-button" title="Open in Cursor">
            📝
          </button>

          {assignment && (assignment.status === 'pr_open' || assignment.status === 'merged' || assignment.status === 'closed') && assignment.prUrl && (
            <button
              onClick={() => window.open(assignment.prUrl, '_blank')}
              className="primary icon-button"
              title="Open PR"
            >
              🔗
            </button>
          )}

          {assignment && !assignment.isBaseBranchAgent && assignment.status !== 'pr_open' && assignment.status !== 'merged' && assignment.status !== 'closed' && (
            <button
              onClick={handleCreatePRClick}
              className="success icon-button"
              disabled={isCreatingPR}
              title={isCreatingPR ? 'Creating PR...' : 'Make PR'}
            >
              {isCreatingPR ? '⏳' : '➕'}
            </button>
          )}

          {assignment && !assignment.isBaseBranchAgent && (
            <div className="cleanup-dropdown">
              <button className="cleanup-button icon-button" title="Cleanup Options">🗑️</button>
              <div className="cleanup-menu">
                <button onClick={() => handleCleanupClick('unassign')}>Unassign</button>
                <button onClick={() => handleCleanupClick('teardown')} className="danger-text">
                  Teardown
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="agent-content">
        <div className="unified-tabs">
          {/* Agent Terminal Tab (or Cursor placeholder) */}
          <div
            className={`unified-tab ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <span className="tab-icon">🍌</span>
            <span className="tab-name">
              {assignment?.tool === 'cursor' && !isRunning ? 'Cursor IDE' : 'Minion Terminal'}
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
            assignment?.tool === 'cursor' && !isRunning ? (
              <div className="placeholder">
                <div className="placeholder-icon">🍌</div>
                <div className="placeholder-text">
                  <p>This minion uses Cursor IDE.</p>
                  <p>Click "Open in Cursor" to start working.</p>
                </div>
              </div>
            ) : (
              agentId && <Terminal
                agentId={agentId}
                autoFocus={!hasAutoFocused.current}
                onMount={() => { hasAutoFocused.current = true }}
              />
            )
          )}
          {plainTerminals.map(terminalId => (
            activeTab === terminalId && agentId && (
              <PlainTerminal
                key={terminalId}
                agentId={agentId}
                terminalId={terminalId}
                autoFocus={!hasAutoFocused.current}
                onMount={() => { hasAutoFocused.current = true }}
              />
            )
          ))}
          {testEnvCommands.map(cmd => (
            activeTab === cmd.id && agentId && (
              <TestEnvTerminal
                key={cmd.id}
                agentId={agentId}
                commandId={cmd.id}
                autoFocus={!hasAutoFocused.current}
                onMount={() => { hasAutoFocused.current = true }}
              />
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

    </div>
  )
}

export default AgentView

