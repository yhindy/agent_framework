import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import PlainTerminal from './PlainTerminal'
import TestEnvTerminal from './TestEnvTerminal'
import AgentHeader, { HeaderBadge } from './AgentHeader'
import AgentCleanupDropdown from './AgentCleanupDropdown'
import { BotIcon, WarningIcon, TerminalIcon, StopIcon, PlayIcon, PlusIcon } from './icons'
import { usePRCreation } from '../hooks/usePRCreation'
import { usePRPolling } from '../hooks/usePRPolling'
import { useLoadingSnackbar } from '../hooks/useLoadingSnackbar'
import { debounce } from '../utils/debounce'
import { extractBranchName } from '../utils/branchUtils'
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

interface HandoffSource {
  agentId: string
  branchMode: 'inherit' | 'fresh'
  originalBranch: string
  handoffTimestamp: string
}

interface AgentSession {
  id: string
  assignmentId: string | null
  worktreePath: string
  terminalPid: number | null
  hasUnread: boolean
  lastActivity: string
  handoffSource?: HandoffSource
  uiState?: {
    lastActiveTab: string
    plainTerminals: string[]
    terminalCounter: number
    lastFocusTime: string
  }
}

function AgentView({ activeProjects }: AgentViewProps) {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<AgentSession | null>(null)
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [activeTab, setActiveTab] = useState<string>('agent')
  const [testEnvCommands, setTestEnvCommands] = useState<any[]>([])
  const [testEnvStatuses, setTestEnvStatuses] = useState<any[]>([])
  const [plainTerminals, setPlainTerminals] = useState<string[]>(['terminal-1'])
  const [terminalCounter, setTerminalCounter] = useState(1)
  const [teleportFailure, setTeleportFailure] = useState<{ reason: string; canRetry: boolean } | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { showLoading: _showLoading, hideLoading: _hideLoading } = useLoadingSnackbar()

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
    handleCreatePRClick,
    handleConfirmCreatePR: handleConfirmCreatePRHook
  } = usePRCreation()

  // Auto-poll PR status if this agent has an open PR
  usePRPolling({
    assignmentIds: assignment?.status === 'pr_open' && assignment?.id ? [assignment.id] : [],
    enabled: assignment?.status === 'pr_open' || false
  })

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

    // Listen for teleport validation failures
    const unsubscribeTeleportFailed = window.electronAPI.onTeleportValidationFailed((data) => {
      if (data.agentId === agentId) {
        setTeleportFailure({ reason: data.reason, canRetry: data.canRetry })
      }
    })

    const unsubscribeResumeFailed = window.electronAPI.onTeleportResumeFailed((data) => {
      if (data.agentId === agentId) {
        setTeleportFailure({ reason: data.reason, canRetry: false })
      }
    })

    return () => {
      unsubscribeUpdate()
      unsubscribeStarted()
      unsubscribeStopped()
      unsubscribeExited()
      unsubscribeTeleportFailed()
      unsubscribeResumeFailed()
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

  // Ensure the agent's terminal is running when the view loads
  // This is particularly important for base branch agents that don't auto-start
  useEffect(() => {
    const ensureRunning = async () => {
      if (agent && !agent.terminalPid && agentId) {
        const result = await window.electronAPI.ensureAgentRunning(agentId)
        if (result.started) {
          console.log(`Started agent ${agentId}`)
        } else if (result.error) {
          console.warn(`Could not start agent ${agentId}: ${result.error}`)
        }
      }
    }
    ensureRunning()
  }, [agent?.terminalPid, agentId])

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

    // Auto-detect PR if assignment exists but no prUrl
    if (assignmentData && !assignmentData.prUrl && !assignmentData.isBaseBranchAgent) {
      try {
        const result = await window.electronAPI.detectPullRequest(assignmentData.id)
        if (result?.found && result.prUrl) {
          // Find the project that contains this agent
          for (const project of activeProjects) {
            try {
              const refreshedAssignments = await window.electronAPI.getAssignmentsForProject(project.path)
              const refreshed = refreshedAssignments.assignments.find((a: Assignment) => a.agentId === agentId)
              if (refreshed) {
                setAssignment(refreshed)
                break
              }
            } catch {
              // Continue to next project
            }
          }
        }
      } catch (err) {
        console.error('[AgentView] Failed to auto-detect PR:', err)
        // Silent failure - don't block UI load
      }
    }

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

  const handleOpenCursor = async () => {
    if (!agentId) return

    try {
      await window.electronAPI.openInCursor(agentId)
    } catch (error: any) {
      alert('Error opening Cursor: ' + error.message)
    }
  }

  const handleConfirmCreatePR = async () => {
    if (!assignment) return
    await handleConfirmCreatePRHook(assignment.id, loadAgentData)
  }

  const handleRetryTeleport = async () => {
    if (!agentId) return

    setIsRetrying(true)
    try {
      const result = await window.electronAPI.validateTeleport(agentId)
      if (result.success && result.validation?.canResume) {
        // Clear failure state on successful validation
        setTeleportFailure(null)
        // Reload agent data
        await loadAgentData()
      } else {
        // Update failure reason if validation still fails
        if (result.validation?.reason) {
          setTeleportFailure({
            reason: result.validation.reason,
            canRetry: result.validation.canResume || false
          })
        }
      }
    } catch (error: any) {
      console.error('Failed to retry teleport validation:', error)
      setTeleportFailure({
        reason: error.message || 'Failed to validate session',
        canRetry: true
      })
    } finally {
      setIsRetrying(false)
    }
  }

  const handleRemoveFailedAgent = () => {
    // TODO: Implement cleanup modal for failed teleport sessions
    // For now, just log a message
    console.log('Remove failed agent - not yet implemented')
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

  // Build badges array for the header - consistent across Minion and Super Minion
  const headerBadges: HeaderBadge[] = []
  if (assignment) {
    headerBadges.push({
      label: 'Feature',
      value: assignment.feature,
      variant: 'feature',
      copyable: true
    })
    // ID badge is shown in SessionInfoPanel expanded view, but we still pass it for consistency
    headerBadges.push({
      label: 'ID',
      value: agentId || '',
      variant: 'id',
      copyable: true
    })
  }

  // Build header actions - consistent order: PR Status/Make PR, Cursor, Cleanup
  const headerActions = (
    <>
      {/* PR Status Badge or Make PR Button */}
      {assignment?.prStatus && assignment.prUrl ? (
        <button
          className={`pr-status-badge pr-status-${assignment.prStatus.toLowerCase()}`}
          onClick={() => window.open(assignment.prUrl, '_blank')}
          title="Open PR on GitHub"
        >
          PR: {assignment.prStatus}
          <span className="pr-open-icon">↗</span>
          {assignment.status === 'pr_open' && (
            <button
              className="pr-refresh-btn"
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  await window.electronAPI.checkPullRequestStatus(assignment.id)
                } catch (err: any) {
                  console.error('Failed to refresh PR status:', err)
                }
              }}
              title="Refresh PR status"
            >
              ↻
            </button>
          )}
        </button>
      ) : assignment && !assignment.isBaseBranchAgent && assignment.status !== 'pr_open' && assignment.status !== 'merged' && assignment.status !== 'closed' ? (
        <button
          onClick={handleCreatePRClick}
          className="compact-button success"
          disabled={isCreatingPR}
        >
          {isCreatingPR ? 'Creating...' : 'Make PR'}
        </button>
      ) : null}

      {/* Cursor Button */}
      <button onClick={handleOpenCursor} className="compact-button">
        Cursor
      </button>

      {/* Cleanup Dropdown */}
      {assignment && !assignment.isBaseBranchAgent && (
        <AgentCleanupDropdown
          agentId={agentId || ''}
          onCleanupComplete={() => navigate('/workspace')}
        />
      )}
    </>
  )

  return (
    <div className="agent-view" data-testid="agent-view">
      <AgentHeader
        icon={<BotIcon size="md" />}
        title={extractBranchName(assignment?.branch) || agentId || 'Unknown'}
        typeLabel="Minion"
        agentId={agentId || ''}
        badges={headerBadges}
        tool={assignment?.tool}
        isRunning={isRunning}
        status={assignment?.status}
        model={assignment?.model}
        actions={headerActions}
      />

      {/* Teleport Failure Recovery UI */}
      {teleportFailure && (
        <div className="teleport-failure-banner">
          <div className="teleport-failure-content">
            <div className="teleport-failure-icon"><WarningIcon size="md" /></div>
            <div className="teleport-failure-message">
              <div className="teleport-failure-title">Failed to Resume Teleported Session</div>
              <div className="teleport-failure-reason">{teleportFailure.reason}</div>
            </div>
          </div>
          <div className="teleport-failure-actions">
            {teleportFailure.canRetry && (
              <button
                onClick={handleRetryTeleport}
                className="compact-button"
                disabled={isRetrying}
              >
                {isRetrying ? 'Retrying...' : 'Retry Resume'}
              </button>
            )}
            <button
              onClick={handleRemoveFailedAgent}
              className="compact-button danger"
            >
              Remove Agent
            </button>
          </div>
        </div>
      )}

      <div className="agent-content">
        <div className="unified-tabs">
          {/* Agent Terminal Tab (or Cursor placeholder) */}
          <div
            className={`unified-tab ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <span className="tab-icon"><BotIcon size="sm" /></span>
            <span className="tab-name">
              {assignment?.tool === 'cursor' && !isRunning ? 'Cursor IDE' : 'Minion Terminal'}
            </span>
          </div>

          {/* Plain Terminal Tabs (shown in both modes - users can still create separate terminals) */}
          {plainTerminals.map((terminalId, index) => (
            <div
              key={terminalId}
              className={`unified-tab ${activeTab === terminalId ? 'active' : ''}`}
              onClick={() => setActiveTab(terminalId)}
            >
              <span className="tab-icon"><TerminalIcon size="sm" /></span>
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
                    <StopIcon size="sm" />
                  </button>
                ) : (
                  <button
                    className="tab-action start"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartTestEnv(cmd.id)
                    }}
                  >
                    <PlayIcon size="sm" />
                  </button>
                )}
              </div>
            )
          })}

          {/* Add Terminal Button (shown in both modes) */}
          <div
            className="unified-tab add-tab"
            onClick={handleAddTerminal}
            title="Add new terminal"
          >
            <span className="tab-icon"><PlusIcon size="sm" /></span>
          </div>
        </div>

        <div className="unified-terminal-container" data-testid="terminal-container">
          {activeTab === 'agent' && (
            assignment?.tool === 'cursor' && !isRunning ? (
              <div className="placeholder">
                <div className="placeholder-icon"><BotIcon size="lg" /></div>
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
