import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useLoadingSnackbar } from '../hooks/useLoadingSnackbar'
import { usePRPolling } from '../hooks/usePRPolling'
import MissionDropdown from './MissionDropdown'
import ProjectPicker from './ProjectPicker'
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
  projectPath?: string  // Added to track which project the assignment belongs to
}

function Dashboard({ activeProjects, onRefresh }: DashboardProps) {
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

  const loadingMessages = [
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

  const teleportMessages = [
    'Beaming session from the cloud...',
    'Establishing quantum link...',
    'Downloading minion consciousness...',
    'Materializing in worktree...',
    'Syncing bananas from cloud storage...',
    'Calibrating teleporter coordinates...',
    'Reassembling molecular structure...'
  ]
  const [creatingPRFor, setCreatingPRFor] = useState<Set<string>>(new Set())
  const [checkingPRFor, setCheckingPRFor] = useState<Set<string>>(new Set())
  const [showPRConfirm, setShowPRConfirm] = useState(false)
  const [selectedAssignmentForPR, setSelectedAssignmentForPR] = useState<Assignment | null>(null)
  const [autoCommit, setAutoCommit] = useState(true)
  const [ghAvailable, setGhAvailable] = useState(true)
  const [ghError, setGhError] = useState<string>('')
  const [formData, setFormData] = useState({
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
    isSuper: false
  })

  useEffect(() => {
    loadAssignments()
    checkDependencies()

    // Listen for assignment updates
    const unsubscribe = window.electronAPI.onAssignmentsUpdate(() => {
      loadAssignments()
    })

    return () => unsubscribe()
  }, [activeProjects])

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
      messages: loadingMessages
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
          chrome: formData.chrome
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

      setFormData({
        projectPath: '',
        agentId: '',
        shortName: '',
        prompt: '',
        tool: 'claude',
        model: 'opusplan',
        mode: 'planning',
        status: 'pending',
        yolo: false,
        chrome: true,
        isSuper: false
      })
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
      messages: prMessages
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

  const handleArchive = async (assignment: Assignment) => {
    if (!confirm(`Archive ${assignment.agentId} and remove worktree?\n\nThis will permanently delete the worktree.`)) {
      return
    }

    const snackbarId = showLoading({
      title: 'Archiving Mission...',
      messages: teardownMessages
    })
    try {
      await window.electronAPI.teardownAgent(assignment.agentId, false)
      hideLoading(snackbarId)
      alert('Mission archived and worktree removed.')
    } catch (error: any) {
      hideLoading(snackbarId)
      alert(`Failed to archive: ${error.message}`)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#858585'
      case 'in_progress':
        return '#4ec9b0'
      case 'review':
        return '#dcdcaa'
      case 'completed':
        return '#4ec9b0'
      case 'pr_open':
        return '#c586c0'
      case 'merged':
        return '#569cd6'
      case 'closed':
        return '#858585'
      case 'blocked':
        return '#f48771'
      default:
        return '#858585'
    }
  }

  const groupedAssignments = {
    in_progress: assignments.filter((a) => a.status === 'in_progress'),
    review: assignments.filter((a) => a.status === 'review'),
    completed: assignments.filter((a) => a.status === 'completed'),
    pr_open: assignments.filter((a) => a.status === 'pr_open'),
    merged: assignments.filter((a) => a.status === 'merged')
  }

  const handleNewAssignment = (isSuper?: boolean) => {
    // Auto-select last selected project, or first project if only one exists
    const lastProject = localStorage.getItem('lastSelectedProjectPath')
    const defaultProject = (lastProject && activeProjects.some(p => p.path === lastProject))
      ? lastProject
      : (activeProjects.length === 1 ? activeProjects[0].path : '')

    // If isSuper is explicitly set, skip type selection and go to form
    // Otherwise show type selection (user clicked "New Minion")
    if (isSuper !== undefined) {
      setFormData({ ...formData, projectPath: defaultProject, isSuper })
      setShowTypeSelection(false)
    } else {
      setFormData({ ...formData, projectPath: defaultProject, isSuper: false })
      setShowTypeSelection(true)
    }
    setShowCreateForm(true)
  }

  const selectAgentType = (isSuper: boolean) => {
    setFormData({ ...formData, isSuper })
    setShowTypeSelection(false)
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
      messages: teleportMessages
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
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Minion Missions 🍌</h1>
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
        <div className="columns">
          {Object.entries(groupedAssignments).map(([status, items]) => (
            <div key={status} className="column">
              <div className="column-header">
                <span className="column-title">{status.replace('_', ' ')}</span>
                <span className="column-count">{items.length}</span>
              </div>
              <div className="assignment-cards">
                {items.map((assignment) => (
                  <div
                    key={assignment.id}
                    className={`assignment-card ${assignment.status === 'in_progress' ? 'clickable' : ''}`}
                    onClick={() => {
                      if (assignment.status === 'in_progress') {
                        navigate(`/workspace/agent/${assignment.agentId}`)
                      }
                    }}
                  >
                    <div className="card-header">
                      <span className="agent-badge">{assignment.agentId}</span>
                      <span
                        className="status-dot"
                        style={{ background: getStatusColor(assignment.status) }}
                      />
                    </div>
                    {assignment.status !== 'unassigned' && (
                      <>
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
                          <div className="meta-item">
                            <span className="meta-label">Mode:</span>
                            <span className="meta-value">{assignment.mode}</span>
                          </div>
                          {assignment.prUrl && (
                            <div className="meta-item">
                              <span className="meta-label">PR:</span>
                              <a
                                href={assignment.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: '#4ec9b0', textDecoration: 'underline' }}
                              >
                                View on GitHub
                              </a>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {assignment.status === 'completed' && (
                      <div className="card-actions">
                        {!ghAvailable && (
                          <div style={{ fontSize: '12px', color: '#f48771', marginBottom: '8px' }}>
                            ⚠️ {ghError}
                          </div>
                        )}
                        <button
                          className="merge-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCreatePRClick(assignment)
                          }}
                          disabled={creatingPRFor.has(assignment.id) || !ghAvailable}
                        >
                          {creatingPRFor.has(assignment.id)
                            ? 'Creating PR...'
                            : 'Create Pull Request'}
                        </button>
                      </div>
                    )}
                    {assignment.status === 'pr_open' && (
                      <div className="card-actions">
                        {assignment.prUrl && (
                          <button
                            className="merge-button"
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(assignment.prUrl, '_blank')
                            }}
                            style={{ marginBottom: '4px', background: '#569cd6' }}
                          >
                            Open PR on GitHub
                          </button>
                        )}
                        <button
                          className="merge-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCheckPRStatus(assignment)
                          }}
                          disabled={checkingPRFor.has(assignment.id)}
                          title="Manually refresh PR status (auto-polling runs in background)"
                        >
                          {checkingPRFor.has(assignment.id)
                            ? 'Refreshing...'
                            : '↻ Refresh PR'}
                        </button>
                      </div>
                    )}
                    {assignment.status === 'merged' && (
                      <div className="card-actions">
                        {assignment.prUrl && (
                          <button
                            className="merge-button"
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(assignment.prUrl, '_blank')
                            }}
                            style={{ marginBottom: '4px', background: '#4ec9b0' }}
                          >
                            View Merged PR
                          </button>
                        )}
                        <button
                          className="merge-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleArchive(assignment)
                          }}
                          style={{ background: '#569cd6' }}
                        >
                          Archive & Cleanup
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
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
                    <div className="type-icon">🤖</div>
                    <div className="type-title">Single Agent</div>
                    <div className="type-description">One agent works on a focused task</div>
                  </div>
                  <div className="type-card super" onClick={() => selectAgentType(true)}>
                    <div className="type-icon">👑</div>
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
                          <span className="checkbox-text">Yolo mode 🔥</span>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={formData.chrome}
                            onChange={(e) => setFormData({ ...formData, chrome: e.target.checked })}
                          />
                          <span className="checkbox-text">Chrome integration 🌐</span>
                        </label>
                      </div>
                      <div className="form-hint">
                        Yolo: Auto-approve edits and commands. Chrome: Enable browser automation.
                      </div>
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

    </div>
  )
}

export default Dashboard

