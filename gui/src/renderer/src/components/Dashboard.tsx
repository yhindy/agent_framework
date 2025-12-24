import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import LoadingModal from './LoadingModal'
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
  const [isCreating, setIsCreating] = useState(false)
  const [isCreatingPR, setIsCreatingPR] = useState(false)
  const [isTearingDown, setIsTearingDown] = useState(false)

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
    model: 'haiku',
    mode: 'dev',
    status: 'pending',
    yolo: false
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

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('create') === 'true') {
      const projectPath = params.get('projectPath')
      if (projectPath) {
        setFormData(prev => ({ ...prev, projectPath }))
      }
      setShowCreateForm(true)
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
    try {
      setIsCreating(true)

      // Create assignment with prompt as the feature
      const feature = formData.tool === 'cursor' ? `Cursor Session: ${formData.shortName}` : formData.prompt

      // Determine project path (if single project, use that, otherwise use selected)
      const projectPath = activeProjects.length === 1 
        ? activeProjects[0].path 
        : formData.projectPath

      // Backend will auto-generate agentId and construct full branch name
      const result = await window.electronAPI.createAssignmentForProject(projectPath, {
        branch: formData.shortName,  // Just pass short name, backend will construct full branch
        feature,
        tool: formData.tool,
        model: formData.model,
        prompt: formData.prompt,
        mode: formData.mode,
        status: 'in_progress',
        yolo: formData.yolo
      })

      const agentId = result.agentId  // Use the auto-generated agentId from backend
      setShowCreateForm(false)
      setIsCreating(false)

      // Navigate to the new agent view
      navigate(`/workspace/agent/${agentId}`)

      setFormData({
        projectPath: '',
        agentId: '',
        shortName: '',
        prompt: '',
        tool: 'claude',
        model: 'opus',
        mode: 'planning',
        status: 'pending',
        yolo: false
      })

      // Wait a moment for worktree creation then refresh
      setTimeout(() => {
        loadAssignments()
        onRefresh()  // Refresh parent state too
      }, 1500)
    } catch (error: any) {
      setIsCreating(false)
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

    try {
      setCreatingPRFor(prev => new Set(prev).add(selectedAssignmentForPR.id))
      setShowPRConfirm(false)
      setIsCreatingPR(true)

      console.log('[Dashboard] Creating PR for:', selectedAssignmentForPR.id, 'autoCommit:', autoCommit)
      const result = await window.electronAPI.createPullRequest(selectedAssignmentForPR.id, autoCommit)
      
      setIsCreatingPR(false)
      
      // Show success with link
      alert(`Pull Request created successfully!\n\n${result.url}\n\nOpening in browser...`)
      window.open(result.url, '_blank')
    } catch (error: any) {
      setIsCreatingPR(false)
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
      
      console.log('[Dashboard] Checking PR status for:', assignment.id)
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

    try {
      setIsTearingDown(true)
      await window.electronAPI.teardownAgent(assignment.agentId, false)
      setIsTearingDown(false)
      alert('Mission archived and worktree removed.')
    } catch (error: any) {
      setIsTearingDown(false)
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

  const handleNewAssignment = () => {
    // Auto-select last selected project, or first project if only one exists
    const lastProject = localStorage.getItem('lastSelectedProjectPath')
    const defaultProject = (lastProject && activeProjects.some(p => p.path === lastProject))
      ? lastProject
      : (activeProjects.length === 1 ? activeProjects[0].path : '')
    
    setFormData({ ...formData, projectPath: defaultProject })
    setShowCreateForm(true)
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Minion Missions 🍌</h1>
        <button onClick={handleNewAssignment}>+ New Mission</button>
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
                        >
                          {checkingPRFor.has(assignment.id)
                            ? 'Checking...'
                            : 'Check PR Status'}
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
        <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Mission</h2>
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
                      // Filter available agents for this project
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
                  <label>{formData.mode === 'planning' ? 'Planning Prompt' : 'Task Description'}</label>
                  <textarea
                    value={formData.prompt}
                    onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                    placeholder={formData.mode === 'planning'
                      ? "Create a user authentication system with login, signup, and password reset. Use JWT tokens for session management."
                      : "Implement a login form with email and password fields. Style it with Tailwind CSS."}
                    rows={6}
                    required={formData.tool !== 'cursor'}
                    style={{
                      width: '100%',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                  />
                  <div className="form-hint">
                    {formData.mode === 'planning'
                      ? 'Minion will create a plan for you to review before implementing.'
                      : 'Minion will implement directly without a planning phase.'}
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
                      // Set appropriate default model when switching tools
                      const defaultModel = newTool === 'cursor-cli' ? 'auto' : 'opus'
                      setFormData({ ...formData, tool: newTool, model: defaultModel })
                    }}
                  >
                    <option value="claude">Claude</option>
                    <option value="cursor">Cursor</option>
                    <option value="cursor-cli">Cursor CLI</option>
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

                {formData.tool !== 'cursor-cli' && (
                  <div className="form-group">
                    <label>Mode</label>
                    <select
                      value={formData.mode}
                      onChange={(e) => setFormData({ ...formData, mode: e.target.value as 'planning' | 'dev' })}
                    >
                      <option value="planning">Planning</option>
                      <option value="dev">Dev</option>
                    </select>
                  </div>
                )}
              </div>

              {formData.tool === 'claude' && (
                <div className="form-group checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.yolo}
                      onChange={(e) => setFormData({ ...formData, yolo: e.target.checked })}
                    />
                    <span className="checkbox-text">Yolo mode 🔥</span>
                  </label>
                  <div className="form-hint">
                    Automatically approve edits and run commands without confirmation. Don't say I didn't warn you!
                  </div>
                </div>
              )}

              <div className="form-actions">
                <button type="button" onClick={() => setShowCreateForm(false)} disabled={isCreating}>
                  Cancel
                </button>
                <button type="submit" disabled={isCreating}>
                  {isCreating ? 'Creating...' : 'Create Mission'}
                </button>
              </div>
            </form>
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

      <LoadingModal
        isOpen={isCreating}
        messages={loadingMessages}
        title="Deploying Minion..."
      />

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

export default Dashboard

