import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useLoadingSnackbar } from '../hooks/useLoadingSnackbar'
import { usePRPolling } from '../hooks/usePRPolling'
import { useKeyboardShortcutsContext } from '../contexts/KeyboardShortcutsContext'
import MissionDropdown from './MissionDropdown'
import ProjectPicker from './ProjectPicker'
import AgentCleanupDropdown from './AgentCleanupDropdown'
import AgentStateIndicator from './AgentStateIndicator'
import { BotIcon, CrownIcon } from './icons'
import { WorkflowBuilderPage } from './WorkflowEditor'
import type { DefaultToolSettings } from '../../../shared/types/settings'
import type {
  WorkflowConfig,
  SubagentType
} from '../../../main/services/types/WorkflowTypes'
import './Dashboard.css'

interface DashboardProps {
  activeProjects: any[]
  onRefresh: () => void
}

interface Assignment {
  id: string
  agentId: string
  branch: string
  feature: string
  status: string
  tool: string
  model?: string
  mode: string
  prUrl?: string
  prStatus?: string
  projectPath?: string
  claudeState?: 'working' | 'waiting' | 'unknown'
  isWaitingForInput?: boolean
}

const LOADING_MESSAGES = [
  'Making sure Gru has visibility...',
  'Distributing bananas...',
  'Teaching minion language basics...',
  'Installing safety goggles...',
  'Calibrating evil-o-meter...',
  'Cloning the Git worktree...',
  'Requesting backup from Kevin, Stuart, and Bob...',
  'Polishing the shrinking ray...',
  'Preparing the fart gun...',
  'Organizing a mandatory dance party...'
]

const PR_MESSAGES = [
  'Stuffing code into a rocket...',
  'Learning to speak Human for the PR description...',
  'Bribing the CI/CD pipeline with bananas...',
  'Checking for accidentally committed secret cookie recipes...',
  'Pushing code to the moon...',
  'Summoning the code review council (Kevin, Stuart, and Bob)...',
  'Crossing fingers and toes...'
]

const TELEPORT_MESSAGES = [
  'Beaming session from the cloud...',
  'Establishing quantum link...',
  'Downloading minion consciousness...',
  'Materializing in worktree...',
  'Syncing bananas from cloud storage...',
  'Calibrating teleporter coordinates...',
  'Reassembling molecular structure...'
]

// Column configuration for the 3-column Kanban board
const COLUMN_CONFIG = {
  in_progress: {
    title: 'In Progress',
    emptyText: 'No active agents'
  },
  review: {
    title: 'Review',
    emptyText: 'No agents waiting'
  },
  done: {
    title: 'Done',
    emptyText: 'No completed work'
  }
} as const

type ColumnKey = keyof typeof COLUMN_CONFIG

/**
 * Get the default model for the given tool based on user settings
 */
function getDefaultModelForTool(tool: string, toolSettings: DefaultToolSettings): string {
  switch (tool) {
    case 'claude':
      return toolSettings.claudeModel
    case 'cursor-cli':
      return toolSettings.cursorCLIModel
    case 'codex':
      return 'gpt-5.2-codex' // Hardcoded per CLAUDE.md
    default:
      return 'opusplan'
  }
}

function Dashboard({ activeProjects, onRefresh }: DashboardProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showTypeSelection, setShowTypeSelection] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [showTeleportForm, setShowTeleportForm] = useState(false)
  const [teleportInput, setTeleportInput] = useState('')
  const [teleportProjectPath, setTeleportProjectPath] = useState('')
  const [isTeleporting, setIsTeleporting] = useState(false)
  const [showAddProjectModal, setShowAddProjectModal] = useState(false)
  const { showLoading, hideLoading } = useLoadingSnackbar()
  const [creatingPRFor, setCreatingPRFor] = useState<Set<string>>(new Set())
  const [checkingPRFor, setCheckingPRFor] = useState<Set<string>>(new Set())
  const [agentStates, setAgentStates] = useState<Map<string, 'working' | 'waiting' | 'unknown'>>(new Map())
  const [showPRConfirm, setShowPRConfirm] = useState(false)
  const [selectedAssignmentForPR, setSelectedAssignmentForPR] = useState<Assignment | null>(null)
  const [autoCommit, setAutoCommit] = useState(true)
  const [ghAvailable, setGhAvailable] = useState(true)
  const [ghError, setGhError] = useState<string>('')
  const [formData, setFormData] = useState<{
    projectPath: string
    agentId: string
    shortName: string
    prompt: string
    tool: string
    model: string
    mode: string
    status: string
    yolo: boolean
    chrome: boolean
    isSuper: boolean
    workflow: WorkflowConfig | null
  }>({
    projectPath: '',
    agentId: '',
    shortName: '',
    prompt: '',
    tool: 'claude',
    model: 'opusplan',
    mode: 'planning',
    status: 'pending',
    yolo: true,
    chrome: true,
    isSuper: false,
    workflow: null
  })

  // Workflow editor state
  const [subagentTypes, setSubagentTypes] = useState<SubagentType[]>([])
  const [availableWorkflows, setAvailableWorkflows] = useState<WorkflowConfig[]>([])
  const [workflowEditMode, setWorkflowEditMode] = useState(false)

  // Keyboard shortcuts context
  const { registerModalControls, unregisterModalControls } = useKeyboardShortcutsContext()

  // Register modal controls for keyboard shortcuts
  useEffect(() => {
    // Helper to get default project path
    const getDefaultProject = () => {
      const lastProject = localStorage.getItem('lastSelectedProjectPath')
      const defaultProject = (lastProject && activeProjects.some(p => p.path === lastProject))
        ? lastProject
        : (activeProjects.length === 1 ? activeProjects[0].path : '')
      return defaultProject
    }

    registerModalControls({
      openNewMinionModal: () => {
        // Reset form and open with type selection
        setFormData(prev => ({ ...prev, projectPath: getDefaultProject(), isSuper: false }))
        setShowTypeSelection(true)
        setShowCreateForm(true)
      },
      openSuperMinionModal: () => {
        // Set isSuper and open directly to form
        setFormData(prev => ({ ...prev, projectPath: getDefaultProject(), isSuper: true }))
        setShowTypeSelection(false)
        setShowCreateForm(true)
      },
      openTeleportModal: () => {
        setTeleportProjectPath(getDefaultProject())
        setTeleportInput('')
        setShowTeleportForm(true)
      },
      openProjectPicker: () => setShowAddProjectModal(true),
      closeCurrentModal: () => {
        setShowCreateForm(false)
        setShowTeleportForm(false)
        setShowAddProjectModal(false)
        setShowPRConfirm(false)
      },
      isModalOpen: showCreateForm || showTeleportForm || showAddProjectModal || showPRConfirm
    })

    return () => unregisterModalControls()
  }, [
    showCreateForm,
    showTeleportForm,
    showAddProjectModal,
    showPRConfirm,
    registerModalControls,
    unregisterModalControls,
    activeProjects
  ])

  useEffect(() => {
    loadAssignments()
    checkDependencies()

    // Listen for assignment updates
    const unsubscribe = window.electronAPI.onAssignmentsUpdate(() => {
      loadAssignments()
    })

    // Listen for agent state changes
    const unsubscribeState = window.electronAPI.onAgentStateChanged((agentId, state) => {
      setAgentStates(prev => {
        const next = new Map(prev)
        next.set(agentId, state)
        return next
      })
    })

    return () => {
      unsubscribe()
      unsubscribeState()
    }
  }, [activeProjects])

  // Load default settings on mount and apply to formData
  useEffect(() => {
    const loadDefaults = async () => {
      try {
        const settings = await window.electronAPI.getSettings()
        setFormData(prev => ({
          ...prev,
          tool: settings.defaultTool.tool,
          model: getDefaultModelForTool(settings.defaultTool.tool, settings.defaultTool),
          mode: settings.defaultAgent.workflowMode,
          yolo: settings.defaultAgent.yoloMode,
          chrome: settings.defaultAgent.chromeIntegration
        }))
      } catch (error) {
        console.error('Failed to load default settings:', error)
      }
    }
    loadDefaults()
  }, [])

  // Load workflow data on component mount
  useEffect(() => {
    const loadWorkflowData = async () => {
      try {
        const [types, workflows] = await Promise.all([
          window.electronAPI.getSubagentTypes(),
          window.electronAPI.getAllWorkflows()
        ])
        setSubagentTypes(types)
        setAvailableWorkflows(workflows)
      } catch (error) {
        console.error('Failed to load workflow data:', error)
      }
    }
    loadWorkflowData()
  }, [])

  // Auto-poll PR status for all pr_open assignments
  const prOpenAssignments = assignments.filter(a => a.status === 'pr_open')
  usePRPolling({
    assignmentIds: prOpenAssignments.map(a => a.id),
    enabled: prOpenAssignments.length > 0
  })

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('create') === 'true') {
      const projectPath = params.get('projectPath')
      const isSuper = params.get('isSuper') === 'true'
      if (projectPath) {
        setFormData(prev => ({ ...prev, projectPath, isSuper }))
      }
      setShowCreateForm(true)
      // Clear params so it doesn't reopen on refresh
      navigate('/workspace', { replace: true })
    } else if (params.get('teleport') === 'true') {
      const projectPath = params.get('projectPath')
      if (projectPath) {
        setTeleportProjectPath(projectPath)
      }
      setTeleportInput('')
      setShowTeleportForm(true)
      // Clear params so it doesn't reopen on refresh
      navigate('/workspace', { replace: true })
    }
  }, [location.search])

  const checkDependencies = async () => {
    try {
      const result = await window.electronAPI.checkDependencies()
      setGhAvailable(result.ghInstalled && result.ghAuthenticated)
      setGhError(result.error || '')
    } catch (error) {
      setGhAvailable(false)
      setGhError('Failed to check dependencies')
    }
  }

  const loadAssignments = async () => {
    // Load assignments from all active projects
    const allAssignments: Assignment[] = []
    
    for (const project of activeProjects) {
      try {
        const data = await window.electronAPI.getAssignmentsForProject(project.path)
        // Add projectPath to each assignment for tracking
        const projectAssignments = data.assignments.map((a: Assignment) => ({
          ...a,
          projectPath: project.path
        }))
        allAssignments.push(...projectAssignments)
      } catch (err) {
        console.error(`Failed to load assignments for ${project.path}:`, err)
      }
    }
    
    setAssignments(allAssignments)
  }

  const handleCreateAssignment = async () => {
    const snackbarId = showLoading({
      title: 'Deploying Minion...',
      messages: LOADING_MESSAGES
    })
    try {
      setIsCreating(true)

      // Create assignment with prompt as the feature
      const feature = formData.tool === 'cursor' ? `Cursor Session: ${formData.shortName}` : formData.prompt

      // Determine project path (if single project, use that, otherwise use selected)
      const projectPath = activeProjects.length === 1
        ? activeProjects[0].path
        : formData.projectPath

      // Backend will auto-generate agentId and construct full branch name
      let result;
      if (formData.isSuper) {
        result = await window.electronAPI.createSuperAssignment(projectPath, {
          branch: formData.shortName,
          feature,
          tool: formData.tool,
          model: formData.model,
          prompt: formData.prompt,
          status: 'in_progress',
          yolo: formData.yolo,
          chrome: formData.chrome,
          workflow: formData.workflow
        })
      } else {
        result = await window.electronAPI.createAssignmentForProject(projectPath, {
          branch: formData.shortName,  // Just pass short name, backend will construct full branch
          feature,
          tool: formData.tool,
          model: formData.model,
          prompt: formData.prompt,
          mode: formData.mode,
          status: 'in_progress',
          yolo: formData.yolo,
          chrome: formData.chrome
        })
      }

      const agentId = result.agentId  // Use the auto-generated agentId from backend
      setShowCreateForm(false)
      setIsCreating(false)
      hideLoading(snackbarId)

      // Navigate to the new agent view
      if (formData.isSuper) {
        navigate(`/workspace/super/${agentId}`)
      } else {
        navigate(`/workspace/agent/${agentId}`)
      }

      // Reset form but preserve settings-based defaults by re-fetching
      try {
        const settings = await window.electronAPI.getSettings()
        setFormData({
          projectPath: '',
          agentId: '',
          shortName: '',
          prompt: '',
          tool: settings.defaultTool.tool,
          model: getDefaultModelForTool(settings.defaultTool.tool, settings.defaultTool),
          mode: settings.defaultAgent.workflowMode,
          status: 'pending',
          yolo: settings.defaultAgent.yoloMode,
          chrome: settings.defaultAgent.chromeIntegration,
          isSuper: false,
          workflow: null
        })
      } catch {
        // Fallback to hardcoded defaults if settings fail
        setFormData({
          projectPath: '',
          agentId: '',
          shortName: '',
          prompt: '',
          tool: 'claude',
          model: 'opusplan',
          mode: 'planning',
          status: 'pending',
          yolo: true,
          chrome: true,
          isSuper: false,
          workflow: null
        })
      }
      setShowTypeSelection(true)

      // Wait a moment for worktree creation then refresh
      setTimeout(() => {
        loadAssignments()
        onRefresh()  // Refresh parent state too
      }, 1500)
    } catch (error: any) {
      setIsCreating(false)
      hideLoading(snackbarId)
      alert('Error creating assignment: ' + error.message)
    }
  }

  const handleCreatePRClick = (assignment: Assignment) => {
    setSelectedAssignmentForPR(assignment)
    setAutoCommit(true) // Reset to default checked
    setShowPRConfirm(true)
  }

  const handleConfirmCreatePR = async () => {
    if (!selectedAssignmentForPR) return

    const snackbarId = showLoading({
      title: 'Creating Pull Request...',
      messages: PR_MESSAGES
    })
    try {
      setCreatingPRFor(prev => new Set(prev).add(selectedAssignmentForPR.id))
      setShowPRConfirm(false)

      console.log('[Dashboard] Creating PR for:', selectedAssignmentForPR.id, 'autoCommit:', autoCommit)
      const result = await window.electronAPI.createPullRequest(selectedAssignmentForPR.id, autoCommit)

      hideLoading(snackbarId)

      // Show success with link
      alert(`Pull Request created successfully!\n\n${result.url}\n\nOpening in browser...`)
      window.open(result.url, '_blank')
    } catch (error: any) {
      hideLoading(snackbarId)
      alert(`Failed to create PR: ${error.message}`)
    } finally {
      setCreatingPRFor(prev => {
        const updated = new Set(prev)
        updated.delete(selectedAssignmentForPR.id)
        return updated
      })
      setSelectedAssignmentForPR(null)
    }
  }

  const handleCheckPRStatus = async (assignment: Assignment) => {
    try {
      setCheckingPRFor(prev => new Set(prev).add(assignment.id))

      console.log('[Dashboard] Manually refreshing PR status for:', assignment.id)

      // Trigger manual refresh (bypasses rate limiting and cache)
      await window.electronAPI.refreshPRNow(assignment.id)

      // Give a moment for the refresh to complete and update to propagate
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Now check the updated status
      const result = await window.electronAPI.checkPullRequestStatus(assignment.id)

      if (result.status === 'MERGED') {
        alert(`PR has been merged! 🎉\n\nYou can now archive this assignment.`)
      } else if (result.status === 'CLOSED') {
        alert('PR was closed without merging.')
      } else {
        alert('PR is still open.')
      }
    } catch (error: any) {
      alert(`Failed to check PR status: ${error.message}`)
    } finally {
      setCheckingPRFor(prev => {
        const updated = new Set(prev)
        updated.delete(assignment.id)
        return updated
      })
    }
  }

  // Group assignments into 3 columns based on status AND claudeState
  // Helper to get effective claude state (IPC state takes precedence over stored state)
  const getEffectiveClaudeState = (a: Assignment): 'working' | 'waiting' | 'unknown' => {
    // First check live IPC state (most up-to-date)
    const liveState = agentStates.get(a.agentId)
    if (liveState) return liveState

    // Fall back to stored state from assignment data
    if (a.claudeState) return a.claudeState
    if (a.isWaitingForInput) return 'waiting'

    return 'unknown'
  }

  // Group assignments into 3 columns:
  // - In Progress: status is in_progress AND NOT waiting for input
  // - Review: status is in_progress AND waiting for input (needs human attention)
  // - Done: completed, pr_open, or merged
  const groupedAssignments: Record<ColumnKey, Assignment[]> = {
    in_progress: assignments.filter((a) => {
      if (a.status !== 'in_progress') return false
      const effectiveState = getEffectiveClaudeState(a)
      return effectiveState !== 'waiting'
    }),
    review: assignments.filter((a) => {
      // Agents that are in_progress but waiting for input go to Review
      if (a.status === 'in_progress') {
        const effectiveState = getEffectiveClaudeState(a)
        return effectiveState === 'waiting'
      }
      // Legacy support: if status is explicitly 'review'
      return a.status === 'review'
    }),
    done: assignments.filter((a) =>
      a.status === 'completed' || a.status === 'pr_open' || a.status === 'merged'
    )
  }

  const handleNewAssignment = async (isSuper?: boolean) => {
    // Auto-select last selected project, or first project if only one exists
    const lastProject = localStorage.getItem('lastSelectedProjectPath')
    const defaultProject = (lastProject && activeProjects.some(p => p.path === lastProject))
      ? lastProject
      : (activeProjects.length === 1 ? activeProjects[0].path : '')

    // If isSuper is explicitly set, skip type selection and go to form
    // Otherwise show type selection (user clicked "New Minion")
    if (isSuper !== undefined) {
      if (isSuper) {
        // Load default workflow for super minion
        try {
          const systemConfig = await window.electronAPI.getWorkflowConfig()
          const defaultWorkflow = systemConfig.workflows.find((w: WorkflowConfig) => w.isDefault)
          setFormData(prev => ({
            ...prev,
            projectPath: defaultProject,
            isSuper,
            workflow: defaultWorkflow || null
          }))
        } catch (error) {
          console.error('Failed to load default workflow:', error)
          setFormData(prev => ({ ...prev, projectPath: defaultProject, isSuper, workflow: null }))
        }
      } else {
        setFormData(prev => ({ ...prev, projectPath: defaultProject, isSuper, workflow: null }))
      }
      setShowTypeSelection(false)
    } else {
      setFormData(prev => ({ ...prev, projectPath: defaultProject, isSuper: false, workflow: null }))
      setShowTypeSelection(true)
    }
    setShowCreateForm(true)
  }

  const selectAgentType = async (isSuper: boolean) => {
    if (isSuper) {
      // Load default workflow for super minion
      try {
        const systemConfig = await window.electronAPI.getWorkflowConfig()
        const defaultWorkflow = systemConfig.workflows.find((w: WorkflowConfig) => w.isDefault)
        setFormData(prev => ({
          ...prev,
          isSuper,
          workflow: defaultWorkflow || null
        }))
      } catch (error) {
        console.error('Failed to load default workflow:', error)
        setFormData(prev => ({ ...prev, isSuper, workflow: null }))
      }
    } else {
      setFormData(prev => ({ ...prev, isSuper, workflow: null }))
    }
    setShowTypeSelection(false)
  }

  // Prepare workflow for saving - creates a new ID for modified system workflows
  const prepareWorkflowForSave = (workflow: WorkflowConfig): WorkflowConfig => {
    // If this is the default workflow, give it a new ID for the custom version
    if (workflow.isDefault) {
      return {
        ...workflow,
        id: `custom-${Date.now()}`,
        name: workflow.name,
        isDefault: false
      }
    }

    return workflow
  }

  const handleTeleportClick = () => {
    // Auto-select last selected project, or first project if only one exists
    const lastProject = localStorage.getItem('lastSelectedProjectPath')
    const defaultProject = (lastProject && activeProjects.some(p => p.path === lastProject))
      ? lastProject
      : (activeProjects.length === 1 ? activeProjects[0].path : '')

    setTeleportProjectPath(defaultProject)
    setTeleportInput('')
    setShowTeleportForm(true)
  }

  const handleAddProjectClick = () => {
    setShowAddProjectModal(true)
  }

  const handleProjectSelect = async (_project: any) => {
    // Project has been added to the store, notify parent to refresh
    console.log('[Dashboard] Project selected, notifying parent to refresh')
    setShowAddProjectModal(false)
    // Trigger parent refresh callback
    onRefresh()
  }

  /**
   * Parse session ID from various input formats:
   * - URL format: https://claude.ai/code/session_xxx -> session_xxx
   * - Command format: claude --teleport session_xxx -> session_xxx
   * - Raw session ID: session_xxx -> session_xxx
   */
  const parseSessionId = (input: string): string | null => {
    const trimmed = input.trim()

    // URL format: https://claude.ai/code/session_xxx
    const urlMatch = trimmed.match(/claude\.ai\/code\/(session_[a-zA-Z0-9_-]+)/)
    if (urlMatch) {
      return urlMatch[1]
    }

    // Command format: claude --teleport session_xxx
    const commandMatch = trimmed.match(/--teleport\s+(session_[a-zA-Z0-9_-]+)/)
    if (commandMatch) {
      return commandMatch[1]
    }

    // Raw session ID: session_xxx
    const rawMatch = trimmed.match(/^(session_[a-zA-Z0-9_-]+)$/)
    if (rawMatch) {
      return rawMatch[1]
    }

    return null
  }

  const handleTeleportImport = async () => {
    const sessionId = parseSessionId(teleportInput)
    if (!sessionId) {
      alert('Invalid input. Please enter a valid teleport URL, command, or session ID.\n\nExamples:\n- https://claude.ai/code/session_xxx\n- claude --teleport session_xxx\n- session_xxx')
      return
    }

    // Project is optional - if not selected, backend will try to auto-detect
    const projectPath = activeProjects.length === 1
      ? activeProjects[0].path
      : teleportProjectPath

    const snackbarId = showLoading({
      title: 'Teleporting Session...',
      messages: TELEPORT_MESSAGES
    })

    try {
      setIsTeleporting(true)
      // Pass projectPath (can be empty string, backend will handle fallback)
      const result = await window.electronAPI.teleportFromCloud(projectPath || '', sessionId)

      setShowTeleportForm(false)
      setIsTeleporting(false)
      hideLoading(snackbarId)

      // Navigate to the new agent view
      navigate(`/workspace/agent/${result.agentId}`)

      // Reset form
      setTeleportInput('')
      setTeleportProjectPath('')

      // Refresh assignments
      setTimeout(() => {
        loadAssignments()
        onRefresh()
      }, 1500)
    } catch (error: any) {
      setIsTeleporting(false)
      hideLoading(snackbarId)
      alert('Error teleporting session: ' + error.message)
    }
  }

  return (
    <div className="dashboard" data-testid="dashboard">
      <div className="dashboard-header" data-testid="dashboard-header">
        <h1>Minion Missions <BotIcon /></h1>
        <div className="header-actions">
          <MissionDropdown
            variant="button"
            showAddProject={true}
            onAddProject={handleAddProjectClick}
            onNewMission={handleNewAssignment}
            onTeleport={handleTeleportClick}
          />
        </div>
      </div>

      <div className="dashboard-content">
        <div className="columns columns-3">
          {(Object.keys(COLUMN_CONFIG) as ColumnKey[]).map((columnKey) => {
            const config = COLUMN_CONFIG[columnKey]
            const items = groupedAssignments[columnKey]

            return (
              <div key={columnKey} className={`column column-${columnKey}`} data-status={columnKey}>
                <div className="column-header">
                  <span className="column-title">{config.title}</span>
                  <span className="column-count">{items.length}</span>
                </div>
                <div className="assignment-cards">
                  {items.map((assignment) => (
                    <div
                      key={assignment.id}
                      className="assignment-card clickable"
                      data-testid="agent-card"
                      data-status={assignment.status}
                      onClick={() => {
                        navigate(`/workspace/agent/${assignment.agentId}`)
                      }}
                    >
                        <div className="card-header">
                          <span className="agent-badge">{assignment.agentId}</span>
                          <div className="card-header-right">
                            {/* Show state indicator for active agents */}
                            {(columnKey === 'in_progress' || columnKey === 'review') && (
                              <AgentStateIndicator
                                claudeState={getEffectiveClaudeState(assignment)}
                                isRunning={assignment.status === 'in_progress'}
                                size="small"
                              />
                            )}
                            {/* X button for cleanup - appears on hover */}
                            <div onClick={(e) => e.stopPropagation()}>
                              <AgentCleanupDropdown
                                agentId={assignment.agentId}
                                onCleanupComplete={loadAssignments}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="card-meta">
                          <div className="meta-item">
                            <span className="meta-label">Branch:</span>
                            <span className="meta-value">{assignment.branch}</span>
                          </div>
                          <div className="meta-item">
                            <span className="meta-label">Tool:</span>
                            <span className="meta-value">{assignment.tool}</span>
                          </div>
                          {assignment.model && (
                            <div className="meta-item">
                              <span className="meta-label">Model:</span>
                              <span className="meta-value">{assignment.model}</span>
                            </div>
                          )}
                        </div>

                        {/* Action buttons for Done column cards */}
                        {columnKey === 'done' && (
                          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                            {assignment.status === 'completed' && (
                              <>
                                {!ghAvailable && (
                                  <div className="gh-error-text">
                                    {ghError}
                                  </div>
                                )}
                                <button
                                  className="action-button action-button--primary"
                                  onClick={() => handleCreatePRClick(assignment)}
                                  disabled={creatingPRFor.has(assignment.id) || !ghAvailable}
                                >
                                  {creatingPRFor.has(assignment.id)
                                    ? 'Creating...'
                                    : 'Create PR'}
                                </button>
                              </>
                            )}
                            {assignment.status === 'pr_open' && (
                              <div className="action-button-group">
                                {assignment.prUrl && (
                                  <a
                                    href={assignment.prUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="action-button action-button--secondary"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    View PR
                                  </a>
                                )}
                                <button
                                  className="action-button action-button--ghost"
                                  onClick={() => handleCheckPRStatus(assignment)}
                                  disabled={checkingPRFor.has(assignment.id)}
                                  title="Refresh PR status"
                                >
                                  {checkingPRFor.has(assignment.id) ? '...' : 'Refresh'}
                                </button>
                              </div>
                            )}
                            {assignment.status === 'merged' && assignment.prUrl && (
                              <a
                                href={assignment.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="action-button action-button--success"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View Merged PR
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showCreateForm && (
        <div className="modal-overlay" onClick={() => { setShowCreateForm(false); setShowTypeSelection(true); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {showTypeSelection ? (
              <>
                <h2>New Mission</h2>
                <p className="type-selection-subtitle">Choose how you want to work</p>
                <div className="type-selection">
                  <div className="type-card" onClick={() => selectAgentType(false)}>
                    <div className="type-icon"><BotIcon /></div>
                    <div className="type-title">Single Agent</div>
                    <div className="type-description">One agent works on a focused task</div>
                  </div>
                  <div className="type-card super" onClick={() => selectAgentType(true)}>
                    <div className="type-icon"><CrownIcon /></div>
                    <div className="type-title">Orchestrator</div>
                    <div className="type-description">Breaks down work and coordinates a team</div>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" onClick={() => { setShowCreateForm(false); setShowTypeSelection(true); }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>{formData.isSuper ? 'Create Orchestrator' : 'Create Single Agent'}</h2>
                {formData.isSuper && (
                  <div className="orchestrator-info">
                    The orchestrator will analyze your goal and create a plan. You'll approve the plan before any agents start working.
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleCreateAssignment()
                  }}
                >
                  {activeProjects.length > 1 && (
                    <div className="form-group">
                      <label>Project</label>
                      <select
                        value={formData.projectPath}
                        onChange={(e) => {
                          const newProjectPath = e.target.value
                          setFormData({ ...formData, projectPath: newProjectPath, agentId: '' })
                        }}
                        required
                      >
                        <option value="">Select project...</option>
                        {activeProjects.map((proj) => (
                          <option key={proj.path} value={proj.path}>
                            {proj.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Branch Short Name</label>
                    <div className="branch-input-wrapper">
                      <span className="branch-prefix">feature/</span>
                      <input
                        type="text"
                        value={formData.shortName}
                        onChange={(e) => setFormData({ ...formData, shortName: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                        placeholder="user-auth"
                        required
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>

                  {formData.tool !== 'cursor' && (
                    <div className="form-group">
                      <label>{formData.isSuper ? 'Goal' : 'Task'}</label>
                      <textarea
                        value={formData.prompt}
                        onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                        placeholder={formData.isSuper
                          ? "Describe the overall goal you want to accomplish. The orchestrator will break it down into subtasks."
                          : (formData.mode === 'planning'
                            ? "Create a user authentication system with login, signup, and password reset. Use JWT tokens for session management."
                            : "Implement a login form with email and password fields. Style it with Tailwind CSS.")}
                        rows={6}
                        required={formData.tool !== 'cursor'}
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          fontFamily: 'inherit'
                        }}
                      />
                    </div>
                  )}

                  {/* Workflow selector for Single Agents only */}
                  {!formData.isSuper && formData.tool !== 'cursor-cli' && (
                    <div className="form-group">
                      <label>Workflow</label>
                      <div className="workflow-selector">
                        <label className={`workflow-option ${formData.mode === 'planning' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="workflow"
                            value="planning"
                            checked={formData.mode === 'planning'}
                            onChange={() => setFormData({ ...formData, mode: 'planning', model: 'opusplan' })}
                          />
                          <div className="workflow-content">
                            <div className="workflow-title">Plan First</div>
                            <div className="workflow-description">Agent proposes a plan for your review before making changes</div>
                          </div>
                        </label>
                        <label className={`workflow-option ${formData.mode === 'dev' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="workflow"
                            value="dev"
                            checked={formData.mode === 'dev'}
                            onChange={() => setFormData({ ...formData, mode: 'dev', model: 'haiku' })}
                          />
                          <div className="workflow-content">
                            <div className="workflow-title">Start Immediately</div>
                            <div className="workflow-description">Agent begins implementing right away</div>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="form-row">
                    <div className="form-group">
                      <label>Tool</label>
                      <select
                        value={formData.tool}
                        onChange={(e) => {
                          const newTool = e.target.value
                          let defaultModel = 'opus'
                          if (newTool === 'cursor-cli') {
                            defaultModel = 'auto'
                          } else if (newTool === 'codex') {
                            defaultModel = 'gpt-5.2-codex'
                          }
                          setFormData({ ...formData, tool: newTool, model: defaultModel })
                        }}
                      >
                        <option value="claude">Claude</option>
                        <option value="cursor">Cursor</option>
                        <option value="cursor-cli">Cursor CLI</option>
                        <option value="codex">OpenAI Codex</option>
                      </select>
                    </div>

                    {formData.tool === 'claude' && (
                      <div className="form-group">
                        <label>Model</label>
                        <select
                          value={formData.model}
                          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                        >
                          <option value="haiku">Haiku</option>
                          <option value="sonnet">Sonnet</option>
                          <option value="opus">Opus</option>
                          <option value="opusplan">Opus Plan</option>
                        </select>
                      </div>
                    )}

                    {formData.tool === 'cursor-cli' && (
                      <div className="form-group">
                        <label>Model</label>
                        <select
                          value={formData.model}
                          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                        >
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
                  </div>

                  {formData.tool === 'claude' && (
                    <div className="form-group">
                      <div style={{ display: 'flex', gap: '30px', marginBottom: '8px' }}>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.yolo}
                            onChange={(e) => setFormData({ ...formData, yolo: e.target.checked })}
                          />
                          <span className="checkbox-text">Yolo mode</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.chrome}
                            onChange={(e) => setFormData({ ...formData, chrome: e.target.checked })}
                          />
                          <span className="checkbox-text">Chrome integration</span>
                        </label>
                      </div>
                      <div className="form-hint">
                        Yolo: Auto-approve edits and commands. Chrome: Enable browser automation.
                      </div>
                    </div>
                  )}

                  {/* Workflow selector for Super Minions */}
                  {formData.isSuper && (
                    <div className="form-group">
                      <label>Workflow</label>
                      <div className="workflow-selector-row">
                        <select
                          className="workflow-select"
                          value={formData.workflow?.id || ''}
                          onChange={(e) => {
                            const selected = availableWorkflows.find(w => w.id === e.target.value)
                            if (selected) {
                              // Create a copy so edits don't affect the original
                              setFormData(prev => ({
                                ...prev,
                                workflow: JSON.parse(JSON.stringify(selected))
                              }))
                            }
                          }}
                        >
                          {availableWorkflows.map(w => (
                            <option key={w.id} value={w.id}>
                              {w.name} ({w.steps.length} steps)
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="edit-workflow-btn"
                          onClick={() => setWorkflowEditMode(true)}
                          disabled={!formData.workflow}
                        >
                          Customize
                        </button>
                      </div>
                      {formData.workflow?.description && (
                        <div className="form-hint">{formData.workflow.description}</div>
                      )}
                    </div>
                  )}

                  <div className="form-actions">
                    <button type="button" onClick={() => setShowTypeSelection(true)} disabled={isCreating}>
                      Back
                    </button>
                    <button type="submit" disabled={isCreating}>
                      {isCreating ? 'Creating...' : (formData.isSuper ? 'Create Plan' : 'Start Agent')}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {showPRConfirm && selectedAssignmentForPR && (
        <div className="modal-overlay" onClick={() => setShowPRConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create Pull Request</h2>
            <p>
              This will push the branch and create a PR on GitHub for:
            </p>
            <div className="merge-info">
              <div><strong>Minion:</strong> {selectedAssignmentForPR.agentId}</div>
              <div><strong>Branch:</strong> {selectedAssignmentForPR.branch}</div>
              <div><strong>Feature:</strong> {selectedAssignmentForPR.feature}</div>
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

      {showTeleportForm && (
        <div className="modal-overlay" onClick={() => setShowTeleportForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Teleport from Cloud</h2>
            <p>
              Import an existing Claude Code session from the cloud into this workspace.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleTeleportImport()
              }}
            >
              {activeProjects.length > 1 && (
                <div className="form-group">
                  <label>Project (Optional)</label>
                  <select
                    value={teleportProjectPath}
                    onChange={(e) => setTeleportProjectPath(e.target.value)}
                  >
                    <option value="">Auto-detect from session...</option>
                    {activeProjects.map((proj) => (
                      <option key={proj.path} value={proj.path}>
                        {proj.name}
                      </option>
                    ))}
                  </select>
                  <div className="form-hint">
                    Project will be auto-detected from session, or select one manually.
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Session</label>
                <input
                  type="text"
                  value={teleportInput}
                  onChange={(e) => setTeleportInput(e.target.value)}
                  placeholder="Paste teleport URL, command, or session ID"
                  required
                  style={{ width: '100%' }}
                />
                <div className="form-hint">
                  e.g., https://claude.ai/code/session_xxx or claude --teleport session_xxx
                </div>
              </div>

              <div className="form-actions">
                <button type="button" onClick={() => setShowTeleportForm(false)} disabled={isTeleporting}>
                  Cancel
                </button>
                <button type="submit" disabled={isTeleporting}>
                  {isTeleporting ? 'Importing...' : 'Import Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddProjectModal && (
        <div className="modal-overlay" onClick={() => setShowAddProjectModal(false)}>
          <div className="modal-content project-picker-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Open Project</h2>
              <button className="close-btn" onClick={() => setShowAddProjectModal(false)}>x</button>
            </div>
            <div className="modal-body">
              <ProjectPicker onProjectSelect={handleProjectSelect} />
            </div>
          </div>
        </div>
      )}

      {workflowEditMode && formData.workflow && (
        <WorkflowBuilderPage
          workflow={formData.workflow}
          subagentTypes={subagentTypes}
          onSave={(updatedWorkflow) => {
            const workflowToSave = prepareWorkflowForSave(updatedWorkflow)
            setFormData(prev => ({ ...prev, workflow: workflowToSave }))
            setWorkflowEditMode(false)
          }}
          onCancel={() => setWorkflowEditMode(false)}
          title="Configure Workflow"
        />
      )}

    </div>
  )
}

export default Dashboard

