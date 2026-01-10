import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import PlainTerminal from './PlainTerminal'
import TestEnvTerminal from './TestEnvTerminal'
import TaskStatusCard from './TaskStatusCard'
import ConfirmModal from './ConfirmModal'
import SessionInfoPanel from './SessionInfoPanel'
import { usePRCreation } from '../hooks/usePRCreation'
import { useLoadingSnackbar } from '../hooks/useLoadingSnackbar'
import { debounce } from '../utils/debounce'
import { extractBranchName } from '../utils/branchUtils'
import './SuperAgentView.css'
import { SuperAgentInfo } from '../types/agent'

interface SuperAgentViewProps {
  activeProjects: any[]
}

function SuperAgentView({ activeProjects: _activeProjects }: SuperAgentViewProps) {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<SuperAgentInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showTeardownConfirm, setShowTeardownConfirm] = useState(false)
  const [isTearingDown, setIsTearingDown] = useState(false)
  const { showLoading, hideLoading } = useLoadingSnackbar()

  // Tab management
  const [activeTab, setActiveTab] = useState<string>('orchestration')
  const [plainTerminals, setPlainTerminals] = useState<string[]>([])
  const [terminalCounter, setTerminalCounter] = useState(0)

  // Task sidebar collapse state
  const [isTaskSidebarCollapsed, setIsTaskSidebarCollapsed] = useState(false)

  // Load task sidebar collapsed state from localStorage
  useEffect(() => {
    const savedState = localStorage.getItem('taskSidebarCollapsed')
    if (savedState !== null) {
      setIsTaskSidebarCollapsed(savedState === 'true')
    }
  }, [])

  // Toggle task sidebar collapse
  const toggleTaskSidebar = () => {
    const newState = !isTaskSidebarCollapsed
    setIsTaskSidebarCollapsed(newState)
    localStorage.setItem('taskSidebarCollapsed', String(newState))
  }

  // Test environment management
  const [testEnvCommands, setTestEnvCommands] = useState<any[]>([])
  const [testEnvStatuses, setTestEnvStatuses] = useState<any[]>([])

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

  // PR management
  const {
    showPRConfirm,
    setShowPRConfirm,
    autoCommit,
    setAutoCommit,
    isCreatingPR,
    handleCreatePRClick,
    handleConfirmCreatePR: handleConfirmCreatePRHook
  } = usePRCreation()

  const loadAgent = async () => {
    if (!agentId) return
    try {
      setError(null)
      const details = await window.electronAPI.getSuperAgentDetails(agentId)
      setAgent(details)

      // Restore UI state if available
      if (details?.uiState) {
        const { lastActiveTab, plainTerminals: savedTerminals, terminalCounter: savedCounter } = details.uiState

        // Validate terminal counter against saved terminals
        const maxTerminalNum = Math.max(
          ...savedTerminals.map((id: string) => parseInt(id.split('-')[1]) || 0),
          0
        )
        const restoredCounter = Math.max(savedCounter, maxTerminalNum)

        setPlainTerminals(savedTerminals)
        setTerminalCounter(restoredCounter)
        setActiveTab(lastActiveTab)
      }
    } catch (err: any) {
      console.error('Failed to load super agent details:', err)
      setError(err.message || 'Failed to load super agent')
    }
  }

  useEffect(() => {
    loadAgent()
    loadTestEnvConfig()
    loadTestEnvStatus()

    // Listen for updates
    const unsubscribeList = window.electronAPI.onAgentListUpdate(() => {
      loadAgent()
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
      unsubscribeList()
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

  const handleOpenCursor = async () => {
    if (agent) {
      await window.electronAPI.openInCursor(agent.agentId)
    }
  }

  const handleStop = async () => {
    if (agent) {
      await window.electronAPI.stopAgent(agent.agentId)
    }
  }

  const teardownMessages = [
    'Returning minion to the break room...',
    'Cleaning up banana peels from the workspace...',
    'Shredding incriminating documents...',
    'Wiping fingerprints from the keyboard...',
    'Returning stolen shrink rays...',
    'Escaping before Gru finds out...',
    'Restocking the vending machine...'
  ]

  const handleTeardown = async () => {
    if (!agent) return
    setIsTearingDown(true)
    const snackbarId = showLoading({
      title: 'Archiving Super Mission...',
      messages: teardownMessages
    })
    try {
      await window.electronAPI.teardownAgent(agent.agentId, true) // Force teardown
      hideLoading(snackbarId)
      navigate('/workspace')
    } catch (err) {
      hideLoading(snackbarId)
      console.error('Failed to teardown:', err)
      setError('Failed to cleanup agent')
      setShowTeardownConfirm(false)
    } finally {
      setIsTearingDown(false)
    }
  }

  const handleConfirmCreatePR = async () => {
    if (!agent) return
    await handleConfirmCreatePRHook(agent.agentId, loadAgent)
  }

  // Test environment functions
  const loadTestEnvConfig = async () => {
    if (!agentId) return
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

  // Plain terminal functions
  const handleAddTerminal = () => {
    const newCounter = terminalCounter + 1
    const newTerminalId = `terminal-${newCounter}`
    setPlainTerminals([...plainTerminals, newTerminalId])
    setTerminalCounter(newCounter)
    setActiveTab(newTerminalId)
  }

  const handleCloseTerminal = (terminalId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    // Filter out the closed terminal
    const updatedTerminals = plainTerminals.filter(id => id !== terminalId)
    setPlainTerminals(updatedTerminals)

    // Switch to orchestration tab if we closed the active tab
    if (activeTab === terminalId) {
      setActiveTab('orchestration')
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

  if (error) {
    return (
      <div className="super-agent-view">
        <div className="agent-view-error">
          <h3>Error Loading Super Minion</h3>
          <p>{error}</p>
          <button onClick={() => navigate('/workspace')}>Back to Dashboard</button>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="super-agent-view">
        <div className="agent-view-loading">Loading Super Minion {agentId}...</div>
      </div>
    )
  }

  const hasTasks = agent.taskInvocations && agent.taskInvocations.length > 0

  return (
    <div className="super-agent-view">
      <div className="agent-header">
        <div className="agent-header-left">
          <div className="agent-title">
            <h2>
              👑 {extractBranchName(agent.branch) || agent.agentId}
              <span className="budget-badge">Tasks: {agent.taskInvocations?.length || 0}</span>
            </h2>
          </div>

          <div className="info-badge mission-badge" title={`${agent.feature} (click to copy)`}>
            <span className="info-badge-label">Mission:</span>
            <span
              className="info-badge-value copyable"
              onClick={(e) => handleCopyToClipboard(agent.feature, e as any)}
              role="button"
              tabIndex={0}
            >
              {agent.feature}
            </span>
          </div>
        </div>

        <div className="agent-actions">
          <button onClick={handleCreatePRClick} className="success compact-button" disabled={isCreatingPR}>
            {isCreatingPR ? 'Creating...' : 'Make PR'}
          </button>
          <button onClick={handleOpenCursor} className="compact-button">
            Cursor
          </button>
          <button className="danger compact-button" onClick={handleStop}>
            Stop
          </button>
          <button className="danger compact-button icon-only" onClick={() => setShowTeardownConfirm(true)}>
            🗑️
          </button>
        </div>
      </div>

      {/* Session Info Panel - shows live Claude session data */}
      {agent.tool === 'claude' && (
        <SessionInfoPanel agentId={agentId || ''} isRunning={agent.terminalPid !== null} />
      )}

      <div className="agent-content">
        {/* Full-width tab bar */}
        <div className="unified-tabs">
          {/* Orchestration Terminal Tab */}
          <div
            className={`unified-tab ${activeTab === 'orchestration' ? 'active' : ''}`}
            onClick={() => setActiveTab('orchestration')}
          >
            <span className="tab-icon">👑</span>
            <span className="tab-name">Orchestration</span>
          </div>

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

          {/* Plain Terminal Tabs */}
          {plainTerminals.map((terminalId, index) => (
            <div
              key={terminalId}
              className={`unified-tab ${activeTab === terminalId ? 'active' : ''}`}
              onClick={() => setActiveTab(terminalId)}
            >
              <span className="tab-icon">⌨️</span>
              <span className="tab-name">Terminal {index + 1}</span>
              <button
                className="tab-action close"
                onClick={(e) => handleCloseTerminal(terminalId, e)}
                title="Close terminal"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add Terminal Button */}
          <div
            className="unified-tab add-tab"
            onClick={handleAddTerminal}
            title="Add new terminal"
          >
            <span className="tab-icon">➕</span>
          </div>
        </div>

        {/* Terminal area with optional sidebar */}
        <div className={`terminal-area ${hasTasks ? (isTaskSidebarCollapsed ? 'with-sidebar-collapsed' : 'with-sidebar') : ''}`}>
          <div className="unified-terminal-container">
            {activeTab === 'orchestration' && (
              <Terminal
                agentId={agent.agentId}
                autoFocus={!hasAutoFocused.current}
                onMount={() => { hasAutoFocused.current = true }}
              />
            )}
            {plainTerminals.map(terminalId => (
              activeTab === terminalId && (
                <PlainTerminal
                  key={terminalId}
                  agentId={agent.agentId}
                  terminalId={terminalId}
                  autoFocus={!hasAutoFocused.current}
                  onMount={() => { hasAutoFocused.current = true }}
                />
              )
            ))}
            {testEnvCommands.map(cmd => (
              activeTab === cmd.id && (
                <TestEnvTerminal
                  key={cmd.id}
                  agentId={agent.agentId}
                  commandId={cmd.id}
                  autoFocus={!hasAutoFocused.current}
                  onMount={() => { hasAutoFocused.current = true }}
                />
              )
            ))}
          </div>

          {/* Task sidebar - only shown when tasks exist */}
          {hasTasks && (
            <div className={`task-sidebar ${isTaskSidebarCollapsed ? 'collapsed' : ''}`}>
              <button
                className="collapse-task-sidebar-btn"
                onClick={toggleTaskSidebar}
                title={isTaskSidebarCollapsed ? 'Expand task sidebar' : 'Collapse task sidebar'}
              >
                {isTaskSidebarCollapsed ? '◀' : '▶'}
              </button>
              <div className="task-sidebar-header">
                <h3>Tasks ({agent.taskInvocations?.length || 0})</h3>
              </div>
              <div className="task-list">
                {agent.taskInvocations?.map(task => (
                  <TaskStatusCard
                    key={task.toolUseId}
                    task={task}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={showTeardownConfirm}
        title="Cleanup Super Minion?"
        message="This will delete the agent worktree and all data. Are you sure?"
        confirmText="Cleanup"
        confirmVariant="danger"
        onConfirm={handleTeardown}
        onCancel={() => setShowTeardownConfirm(false)}
        isLoading={isTearingDown}
      />

      {showPRConfirm && agent && (
        <div className="modal-overlay" onClick={() => setShowPRConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create Pull Request</h2>
            <p>
              This will push the branch and create a PR on GitHub for:
            </p>
            <div className="merge-info">
              <div><strong>Super Minion:</strong> {agent.agentId}</div>
              <div><strong>Feature:</strong> {agent.feature}</div>
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

export default SuperAgentView
