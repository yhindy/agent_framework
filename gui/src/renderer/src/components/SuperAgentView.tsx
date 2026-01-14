import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Terminal from './Terminal'
import PlainTerminal from './PlainTerminal'
import TestEnvTerminal from './TestEnvTerminal'
import TaskStatusCard from './TaskStatusCard'
import AgentHeader, { HeaderBadge } from './AgentHeader'
import AgentCleanupDropdown from './AgentCleanupDropdown'
import { CrownIcon, TerminalIcon, StopIcon, PlayIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, WorkflowIcon } from './icons'
import { WorkflowPanel } from './WorkflowEditor/WorkflowPanel'
import { usePRCreation } from '../hooks/usePRCreation'
import { usePRPolling } from '../hooks/usePRPolling'
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

  // Tab management
  const [activeTab, setActiveTab] = useState<string>('orchestration')
  const [plainTerminals, setPlainTerminals] = useState<string[]>([])
  const [terminalCounter, setTerminalCounter] = useState(0)

  // Task sidebar collapse state
  const [isTaskSidebarCollapsed, setIsTaskSidebarCollapsed] = useState(false)

  // Workflow editor panel state
  const [isWorkflowEditorOpen, setIsWorkflowEditorOpen] = useState(false)

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

  // Track if we've checked PR status for this agent session
  const hasCheckedPRRef = useRef(false)

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

  // Auto-poll PR status if this agent has an open PR
  usePRPolling({
    assignmentIds: agent?.status === 'pr_open' && agent?.id ? [agent.id] : [],
    enabled: agent?.status === 'pr_open' || false
  })

  const loadAgent = async () => {
    if (!agentId) return
    try {
      setError(null)
      const details = await window.electronAPI.getSuperAgentDetails(agentId)
      setAgent(details)

      // Auto-detect PR if no prUrl
      if (details && !details.prUrl) {
        try {
          const result = await window.electronAPI.detectPullRequest(details.id)
          if (result?.found && result.prUrl) {
            // Reload agent to get updated data
            const refreshed = await window.electronAPI.getSuperAgentDetails(agentId!)
            if (refreshed) {
              setAgent(refreshed)
            }
          }
        } catch (err) {
          console.error('[SuperAgentView] Failed to auto-detect PR:', err)
        }
      }

      // Check PR status if prUrl exists - refresh status when landing on page (only once per session)
      if (details && details.prUrl && !hasCheckedPRRef.current) {
        hasCheckedPRRef.current = true
        try {
          await window.electronAPI.checkPullRequestStatus(details.id)
          // Reload agent to get updated PR status
          const refreshed = await window.electronAPI.getSuperAgentDetails(agentId!)
          if (refreshed) {
            setAgent(refreshed)
          }
        } catch (err) {
          console.error('[SuperAgentView] Failed to check PR status:', err)
        }
      }

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

  // Reset PR check ref when agentId changes
  useEffect(() => {
    hasCheckedPRRef.current = false
  }, [agentId])

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

  const hasTasks = agent.taskInvocations && agent.taskInvocations.length > 0
  const taskCount = agent.taskInvocations?.length || 0
  const isRunning = agent.terminalPid !== null

  // Build badges array for the header - consistent with Minion view
  const headerBadges: HeaderBadge[] = [
    {
      label: 'Feature',
      value: agent.feature,
      variant: 'feature',
      copyable: true
    },
    // ID badge is shown in SessionInfoPanel expanded view, but we still pass it for consistency
    {
      label: 'ID',
      value: agent.agentId,
      variant: 'id',
      copyable: true
    }
  ]

  // Derive status for super agent (use status field if available, otherwise derive from state)
  const agentStatus = agent.status || (isRunning ? 'working' : 'idle')

  // Build header actions - consistent order: Workflow, PR Status/Make PR, Cursor, Cleanup
  // This logic is IDENTICAL to AgentView for consistency
  const headerActions = (
    <>
      {/* Workflow Button - only for Super Minions */}
      <button
        onClick={() => setIsWorkflowEditorOpen(true)}
        className="workflow-config-btn"
        title="Configure workflow"
      >
        <WorkflowIcon size="sm" />
        Workflow
      </button>

      {/* PR Status Badge or Make PR Button - logic matches AgentView exactly */}
      {agent?.prStatus && agent.prUrl ? (
        <button
          className={`pr-status-badge pr-status-${agent.prStatus.toLowerCase()}`}
          onClick={() => window.open(agent.prUrl, '_blank')}
          title="Open PR on GitHub"
        >
          PR: {agent.prStatus}
          <span className="pr-open-icon">↗</span>
          {agentStatus === 'pr_open' && (
            <button
              className="pr-refresh-btn"
              onClick={async (e) => {
                e.stopPropagation()
                try {
                  await window.electronAPI.checkPullRequestStatus(agent.agentId)
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
      ) : agentStatus !== 'pr_open' && agentStatus !== 'merged' && agentStatus !== 'closed' ? (
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

      {/* Cleanup Dropdown - consistent with AgentView */}
      <AgentCleanupDropdown
        agentId={agent.agentId}
        onCleanupComplete={() => navigate('/workspace')}
      />
    </>
  )

  return (
    <div className="super-agent-view">
      <AgentHeader
        icon={<CrownIcon size="md" />}
        title={extractBranchName(agent.branch) || agent.agentId}
        typeLabel="Super Minion"
        agentId={agent.agentId}
        badges={headerBadges}
        tool={agent.tool}
        isRunning={isRunning}
        status={agentStatus}
        actions={headerActions}
        taskCount={taskCount}
      />

      <div className="agent-content">
        {/* Full-width tab bar */}
        <div className="unified-tabs">
          {/* Orchestration Terminal Tab */}
          <div
            className={`unified-tab ${activeTab === 'orchestration' ? 'active' : ''}`}
            onClick={() => setActiveTab('orchestration')}
          >
            <span className="tab-icon"><CrownIcon size="sm" /></span>
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

          {/* Plain Terminal Tabs */}
          {plainTerminals.map((terminalId, index) => (
            <div
              key={terminalId}
              className={`unified-tab ${activeTab === terminalId ? 'active' : ''}`}
              onClick={() => setActiveTab(terminalId)}
            >
              <span className="tab-icon"><TerminalIcon size="sm" /></span>
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
            <span className="tab-icon"><PlusIcon size="sm" /></span>
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
                {isTaskSidebarCollapsed ? <ChevronRightIcon size="sm" /> : <ChevronLeftIcon size="sm" />}
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

      {agent.project && (
        <WorkflowPanel
          isOpen={isWorkflowEditorOpen}
          onClose={() => setIsWorkflowEditorOpen(false)}
          projectPath={agent.project}
          workflowId={agent.workflowId}
          readOnly
        />
      )}

    </div>
  )
}

export default SuperAgentView
