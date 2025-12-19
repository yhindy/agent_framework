import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import './Dashboard.css'

interface DashboardProps {
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

function Dashboard({ project }: DashboardProps) {
  const navigate = useNavigate()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [availableAgents, setAvailableAgents] = useState<string[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [mergingAssignments, setMergingAssignments] = useState<Set<string>>(new Set())
  const [showMergeConfirm, setShowMergeConfirm] = useState(false)
  const [selectedAssignmentForMerge, setSelectedAssignmentForMerge] = useState<Assignment | null>(null)
  const [mergeTool, setMergeTool] = useState<'claude' | 'cursor' | 'cursor-cli'>('claude')
  const [formData, setFormData] = useState({
    agentId: '',
    shortName: '',
    prompt: '',
    tool: 'claude',
    model: 'opus',
    mode: 'planning' as 'planning' | 'dev',
    status: 'pending',
    yolo: false
  })

  useEffect(() => {
    loadAssignments()

    // Listen for assignment updates
    const unsubscribe = window.electronAPI.onAssignmentsUpdate(() => {
      loadAssignments()
    })

    return () => unsubscribe()
  }, [project])

  const loadAssignments = async () => {
    const data = await window.electronAPI.getAssignments()
    setAssignments(data.assignments)
    setAvailableAgents(data.availableAgentIds)
  }

  const generateBranchName = (agentId: string, shortName: string): string => {
    return `feature/${agentId}/${shortName}`
  }

  const handleCreateAssignment = async () => {
    try {
      setIsCreating(true)

      // Generate branch name
      const branch = generateBranchName(formData.agentId, formData.shortName)

      // Create assignment with prompt as the feature
      await window.electronAPI.createAssignment({
        agentId: formData.agentId,
        branch,
        feature: formData.prompt,
        tool: formData.tool,
        model: formData.model,
        prompt: formData.prompt,
        mode: formData.mode,
        status: 'in_progress',
        yolo: formData.yolo
      })

      setShowCreateForm(false)
      setIsCreating(false)
      setFormData({
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
      }, 1500)
    } catch (error: any) {
      setIsCreating(false)
      alert('Error creating assignment: ' + error.message)
    }
  }

  const handleMergeClick = (assignment: Assignment) => {
    setSelectedAssignmentForMerge(assignment)
    setShowMergeConfirm(true)
  }

  const handleConfirmMerge = async () => {
    if (!selectedAssignmentForMerge) return

    try {
      setMergingAssignments(prev => new Set(prev).add(selectedAssignmentForMerge.id))
      setShowMergeConfirm(false)

      console.log('[Dashboard] Initiating merge with tool:', mergeTool)
      await window.electronAPI.initiateMerge(selectedAssignmentForMerge.id, mergeTool)
    } catch (error: any) {
      alert(`Merge failed: ${error.message}`)
      setMergingAssignments(prev => {
        const updated = new Set(prev)
        updated.delete(selectedAssignmentForMerge.id)
        return updated
      })
    } finally {
      setSelectedAssignmentForMerge(null)
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
      case 'merging':
        return '#c586c0'
      case 'blocked':
        return '#f48771'
      default:
        return '#858585'
    }
  }

  const getUnassignedAgents = () => {
    const assignedAgentIds = new Set(assignments.map((a) => a.agentId))
    return availableAgents
      .filter((agentId) => !assignedAgentIds.has(agentId))
      .map((agentId) => ({
        id: `unassigned-${agentId}`,
        agentId,
        branch: '',
        feature: 'Unassigned',
        status: 'unassigned',
        specFile: '',
        tool: '',
        mode: 'idle'
      }))
  }

  const groupedAssignments = {
    unassigned: getUnassignedAgents(),
    in_progress: assignments.filter((a) => a.status === 'in_progress'),
    review: assignments.filter((a) => a.status === 'review'),
    completed: assignments.filter((a) => a.status === 'completed'),
    merging: assignments.filter((a) => a.status === 'merging')
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Assignments Dashboard</h1>
        <button onClick={() => setShowCreateForm(true)}>+ New Assignment</button>
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
                    <div className="card-title">{assignment.feature}</div>
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
                    </div>
                    {assignment.status === 'completed' && (
                      <div className="card-actions">
                        <button
                          className="merge-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleMergeClick(assignment)
                          }}
                          disabled={mergingAssignments.has(assignment.id)}
                        >
                          {mergingAssignments.has(assignment.id)
                            ? 'Merging...'
                            : 'Mark as Done & Merge'}
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
            <h2>Create New Assignment</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleCreateAssignment()
              }}
            >
              <div className="form-group">
                <label>Agent ID</label>
                <select
                  value={formData.agentId}
                  onChange={(e) => setFormData({ ...formData, agentId: e.target.value })}
                  required
                >
                  <option value="">Select agent...</option>
                  {availableAgents.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Branch Short Name</label>
                <div className="branch-input-wrapper">
                  <span className="branch-prefix">feature/{formData.agentId || 'agent-X'}/</span>
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

              <div className="form-group">
                <label>{formData.mode === 'planning' ? 'Planning Prompt' : 'Task Description'}</label>
                <textarea
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  placeholder={formData.mode === 'planning'
                    ? "Create a user authentication system with login, signup, and password reset. Use JWT tokens for session management."
                    : "Implement a login form with email and password fields. Style it with Tailwind CSS."}
                  rows={6}
                  required
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    fontFamily: 'inherit'
                  }}
                />
                <div className="form-hint">
                  {formData.mode === 'planning'
                    ? 'Agent will create a plan for you to review before implementing.'
                    : 'Agent will implement directly without a planning phase.'}
                </div>
              </div>

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
                      <option value="haiku">Haiku (fastest)</option>
                      <option value="sonnet">Sonnet (balanced)</option>
                      <option value="opus">Opus (most capable)</option>
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
                      <option value="planning">Planning (review plan first)</option>
                      <option value="dev">Quick Dev (skip planning)</option>
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
                  {isCreating ? 'Creating...' : 'Create Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMergeConfirm && selectedAssignmentForMerge && (
        <div className="modal-overlay" onClick={() => setShowMergeConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Confirm Merge</h2>
            <p>
              This will spawn a merge agent to intelligently merge the changes from:
            </p>
            <div className="merge-info">
              <div><strong>Agent:</strong> {selectedAssignmentForMerge.agentId}</div>
              <div><strong>Branch:</strong> {selectedAssignmentForMerge.branch}</div>
              <div><strong>Feature:</strong> {selectedAssignmentForMerge.feature}</div>
            </div>
            <div className="form-group">
              <label>Tool for Merge Agent:</label>
              <select
                value={mergeTool}
                onChange={(e) => setMergeTool(e.target.value as 'claude' | 'cursor' | 'cursor-cli')}
              >
                <option value="claude">Claude CLI</option>
                <option value="cursor">Cursor IDE</option>
                <option value="cursor-cli">Cursor CLI</option>
              </select>
            </div>
            <p className="warning-text">
              The merge agent will review changes, handle conflicts, run tests,
              and merge to master. You'll be able to monitor progress in the dashboard.
            </p>
            <div className="form-actions">
              <button type="button" onClick={() => setShowMergeConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={handleConfirmMerge}>
                Start Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard

