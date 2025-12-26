import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import PlainTerminal from './PlainTerminal'
import TestEnvTerminal from './TestEnvTerminal'
import ChildStatusCard from './ChildStatusCard'
import PlanApproval from './PlanApproval'
import ConfirmModal from './ConfirmModal'
import LoadingModal from './LoadingModal'
import { usePRCreation } from '../hooks/usePRCreation'
import { debounce } from '../utils/debounce'
import './SuperAgentView.css'
import { SuperAgentInfo, AgentInfo } from '../../main/services/types/ProjectConfig'

interface SuperAgentViewProps {
  activeProjects: any[]
}

function SuperAgentView({ activeProjects }: SuperAgentViewProps) {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<SuperAgentInfo | null>(null)
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTeardownConfirm, setShowTeardownConfirm] = useState(false)
  const [isTearingDown, setIsTearingDown] = useState(false)

  // Tab management
  const [activeTab, setActiveTab] = useState<string>('orchestration')
  const [plainTerminals, setPlainTerminals] = useState<string[]>([])
  const [terminalCounter, setTerminalCounter] = useState(0)

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
    prMessages,
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

    // Listen for signals (e.g. PLANS_READY)
    const unsubscribeSignals = window.electronAPI.onAgentSignal((signalingAgentId, signal) => {
      if (signalingAgentId === agentId) {
        console.log(`Received signal ${signal} from ${signalingAgentId}, reloading...`)
        loadAgent()
      }
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
      unsubscribeSignals()
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

  const handleTeardown = async () => {
    if (!agent) return
    setIsTearingDown(true)
    try {
      await window.electronAPI.teardownAgent(agent.agentId, true) // Force teardown
      navigate('/workspace')
    } catch (err) {
      console.error('Failed to teardown:', err)
      setError('Failed to cleanup agent')
      setShowTeardownConfirm(false)
    } finally {
      setIsTearingDown(false)
    }
  }

  const handleApprovePlan = async (planId: string) => {
    if (!agent) return
    try {
      await window.electronAPI.approvePlan(agent.agentId, planId)
      // Reload agent data to show updated state
      await loadAgent()
    } catch (err: any) {
      console.error('Failed to approve plan:', err)
      setError('Failed to approve plan: ' + (err.message || 'Unknown error'))
    }
  }

  const handleRejectPlan = async (planId: string) => {
    // TODO: Implement plan rejection
    console.log('Rejected plan:', planId)
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

  return (
    <div className="super-agent-view">
      <div className="agent-header">
        <div className="agent-title">
          <h2>👑 {agent.agentId} <span className="budget-badge">Budget: {agent.children.length}/{agent.minionBudget}</span></h2>
        </div>
        <div className="agent-actions">
          <button onClick={handleCreatePRClick} className="success" disabled={isCreatingPR}>
            {isCreatingPR ? 'Creating PR...' : 'Make PR'}
          </button>
          <button onClick={handleOpenCursor}>Open in Cursor</button>
          <button className="danger" onClick={handleStop}>Stop</button>
          <button className="danger" onClick={() => setShowTeardownConfirm(true)}>Cleanup</button>
        </div>
      </div>

      <div className="agent-info-bar">
        <div className="info-item">
          <span className="info-label">Main Mission:</span>
          <span className="info-value">{agent.feature}</span>
        </div>
      </div>

      <div className="super-content">
        <div className={`collapsible-section ${isTerminalCollapsed ? 'collapsed' : ''} ${agent.mode === 'planning' ? 'full-screen' : ''}`}>
          <div className="section-header" onClick={() => setIsTerminalCollapsed(!isTerminalCollapsed)}>
            <h3>{isTerminalCollapsed ? '▶' : '▼'} Terminals & Test Environments</h3>
            <span className="section-hint">{isTerminalCollapsed ? 'Click to expand' : 'Orchestration, test environments, and shells'}</span>
          </div>
          {!isTerminalCollapsed && (
            <div className="tab-section">
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
            </div>
          )}
        </div>

        {agent.mode !== 'planning' && (
          <div className="super-grid">
            <div className="children-section">
              <h3>Active Children ({agent.children.length})</h3>
              <div className="child-cards">
                {agent.children.map(child => (
                  <ChildStatusCard
                    key={child.id}
                    child={child}
                    onClick={() => navigate(`/workspace/agent/${child.agentId}`)}
                  />
                ))}
                {agent.children.length === 0 && <p className="empty-hint">No active children yet.</p>}
              </div>
            </div>

            <div className="plans-section">
              <PlanApproval
                plans={agent.pendingPlans.filter(p => p.status === 'pending')}
                onApprove={handleApprovePlan}
                onReject={handleRejectPlan}
              />
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={showTeardownConfirm}
        title="Cleanup Super Minion?"
        message="This will delete the agent worktree and all data. Child minions will NOT be automatically deleted yet. Are you sure?"
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

      <LoadingModal
        isOpen={isCreatingPR}
        messages={prMessages}
      />
    </div>
  )
}

export default SuperAgentView

