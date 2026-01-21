// =============================================================================
// WORKFLOW BUILDER PAGE
// Full-screen workflow editor with floating action button
// Supports both visual editor and text (JSON) editor modes
// =============================================================================

import { useState, useCallback, useMemo } from 'react'
import { ChevronLeftIcon, WorkflowIcon, ChevronRightIcon } from '../icons'
import { FloatingAddButton } from './FloatingAddButton'
import { WorkflowPipeline } from './WorkflowPipeline'
import type {
  WorkflowConfig,
  WorkflowStep,
  SubagentType
} from '../../../../main/services/types/WorkflowTypes'
import './WorkflowBuilderPage.css'

type EditorMode = 'visual' | 'text'

// JSON structure example for the reference panel
const JSON_EXAMPLE = `{
  "name": "My Workflow",
  "description": "...",
  "steps": [
    {
      "id": "step-1",
      "name": "Explore",
      "agents": [
        { "id": "agent-1", "typeId": "explore" }
      ]
    },
    {
      "id": "step-2",
      "name": "Implement",
      "agents": [
        { "id": "agent-2", "typeId": "implement" }
      ]
    }
  ]
}`

export interface WorkflowBuilderPageProps {
  workflow: WorkflowConfig
  subagentTypes: SubagentType[]
  onSave: (workflow: WorkflowConfig) => void
  onCancel: () => void
  title?: string
}

export function WorkflowBuilderPage({
  workflow,
  subagentTypes,
  onSave,
  onCancel,
  title = 'Configure Workflow'
}: WorkflowBuilderPageProps): JSX.Element {
  // Local state for editing
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow.steps)

  // Editor mode state
  const [editorMode, setEditorMode] = useState<EditorMode>('visual')
  const [textContent, setTextContent] = useState<string>('')
  const [textError, setTextError] = useState<string | null>(null)

  // Reference panel state (for text mode)
  const [isReferencePanelOpen, setIsReferencePanelOpen] = useState<boolean>(true)
  const [copiedAgentId, setCopiedAgentId] = useState<string | null>(null)

  // Copy agent ID to clipboard
  const handleCopyAgentId = useCallback((agentId: string) => {
    navigator.clipboard.writeText(agentId).then(() => {
      setCopiedAgentId(agentId)
      setTimeout(() => setCopiedAgentId(null), 1500)
    })
  }, [])

  // Track if changes have been made
  const isDirty = useMemo(() => {
    const originalStepsJson = JSON.stringify(workflow.steps)

    if (editorMode === 'visual') {
      return JSON.stringify(steps) !== originalStepsJson
    }

    // In text mode, compare parsed content with original workflow
    try {
      const parsed = JSON.parse(textContent)
      return JSON.stringify(parsed.steps) !== originalStepsJson
    } catch {
      // If JSON is invalid, consider it dirty
      return textContent.trim() !== ''
    }
  }, [steps, workflow.steps, editorMode, textContent])

  // Validate that parsed workflow steps have required fields
  function validateWorkflowSteps(parsed: unknown): WorkflowStep[] {
    const data = parsed as { steps?: unknown }
    if (!data.steps || !Array.isArray(data.steps)) {
      throw new Error('Invalid workflow: missing or invalid "steps" array')
    }
    for (const step of data.steps) {
      if (!step.id || !step.name || !Array.isArray(step.agents)) {
        throw new Error('Invalid step: each step must have id, name, and agents array')
      }
    }
    return data.steps as WorkflowStep[]
  }

  // Handle mode toggle between visual and text editors
  const handleModeToggle = useCallback((mode: EditorMode) => {
    if (mode === editorMode) return

    if (mode === 'text') {
      // Switching to text mode - serialize current steps to JSON
      const workflowData = {
        name: workflow.name,
        description: workflow.description || '',
        steps: steps
      }
      setTextContent(JSON.stringify(workflowData, null, 2))
      setTextError(null)
      setEditorMode(mode)
      return
    }

    // Switching to visual mode - parse and validate JSON
    try {
      const parsed = JSON.parse(textContent)
      const validatedSteps = validateWorkflowSteps(parsed)
      setSteps(validatedSteps)
      setTextError(null)
      setEditorMode(mode)
    } catch (err) {
      setTextError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }, [editorMode, steps, textContent, workflow.name, workflow.description])

  // Handle text content change
  const handleTextChange = useCallback((newText: string) => {
    setTextContent(newText)
    setTextError(null) // Clear error when user types
  }, [])

  // Handle adding a new step
  const handleAddStep = useCallback(
    (subagentTypeId: string) => {
      const subagentType = subagentTypes.find((t) => t.id === subagentTypeId)
      if (!subagentType) return

      const newStep: WorkflowStep = {
        id: `step-${Date.now()}`,
        name: subagentType.name,
        agents: [{
          id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          typeId: subagentType.id
        }]
      }

      setSteps((prev) => [...prev, newStep])
    },
    [subagentTypes]
  )

  // Handle steps change from pipeline
  const handleStepsChange = useCallback((newSteps: WorkflowStep[]) => {
    setSteps(newSteps)
  }, [])

  // Handle save
  const handleSave = useCallback(() => {
    let stepsToSave = steps

    // If in text mode, parse and validate the JSON first
    if (editorMode === 'text') {
      try {
        const parsed = JSON.parse(textContent)
        stepsToSave = validateWorkflowSteps(parsed)
      } catch (err) {
        setTextError(err instanceof Error ? err.message : 'Invalid JSON')
        return
      }
    }

    onSave({ ...workflow, steps: stepsToSave })
  }, [workflow, steps, editorMode, textContent, onSave])

  // Handle discard/cancel (also used for back button)
  const handleDiscard = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to discard them?'
      )
      if (!confirmed) return
    }
    onCancel()
  }, [isDirty, onCancel])

  return (
    <div className="workflow-builder-page">
      {/* Header */}
      <header className="workflow-builder-header">
        <div className="workflow-builder-header-left">
          <button
            className="workflow-builder-back-btn"
            onClick={handleDiscard}
            aria-label="Go back"
          >
            <ChevronLeftIcon size="sm" />
            <span>Back</span>
          </button>
        </div>

        <div className="workflow-builder-header-center">
          <h1 className="workflow-builder-title">{title}</h1>
          {workflow.name && (
            <span className="workflow-builder-subtitle">{workflow.name}</span>
          )}
        </div>

        <div className="workflow-builder-header-right">
          {/* Editor mode toggle */}
          <div className="workflow-builder-mode-toggle">
            <button
              className={`mode-toggle-btn ${editorMode === 'visual' ? 'active' : ''}`}
              onClick={() => handleModeToggle('visual')}
              title="Visual Editor"
            >
              Visual
            </button>
            <button
              className={`mode-toggle-btn ${editorMode === 'text' ? 'active' : ''}`}
              onClick={() => handleModeToggle('text')}
              title="Text Editor (JSON)"
            >
              Text
            </button>
          </div>
          <div className="workflow-builder-header-divider" />
          {isDirty && (
            <span className="workflow-builder-unsaved">Unsaved changes</span>
          )}
          <button
            className="workflow-builder-discard-btn"
            onClick={handleDiscard}
          >
            Discard
          </button>
          <button
            className="workflow-builder-save-btn"
            onClick={handleSave}
            disabled={!isDirty}
          >
            Save
          </button>
        </div>
      </header>

      {/* Canvas area */}
      <main className="workflow-builder-canvas">
        <div className="workflow-builder-canvas-inner">
          {editorMode === 'text' ? (
            // Text editor mode with reference panel
            <div className={`workflow-text-editor-layout ${isReferencePanelOpen ? 'panel-open' : 'panel-closed'}`}>
              {/* Main editor area */}
              <div className="workflow-text-editor">
                <div className="workflow-text-editor-header">
                  <span className="workflow-text-editor-label">Edit workflow as JSON</span>
                  {textError && (
                    <span className="workflow-text-editor-error">{textError}</span>
                  )}
                </div>
                <textarea
                  className={`workflow-text-editor-textarea ${textError ? 'has-error' : ''}`}
                  value={textContent}
                  onChange={(e) => handleTextChange(e.target.value)}
                  spellCheck={false}
                  placeholder="Workflow JSON..."
                />
                <div className="workflow-text-editor-hint">
                  Switch to Visual mode to apply changes. Invalid JSON will prevent switching.
                </div>
              </div>

              {/* Reference panel toggle button */}
              <button
                className={`reference-panel-toggle ${isReferencePanelOpen ? 'open' : 'closed'}`}
                onClick={() => setIsReferencePanelOpen(!isReferencePanelOpen)}
                title={isReferencePanelOpen ? 'Hide reference' : 'Show reference'}
                aria-label={isReferencePanelOpen ? 'Hide reference panel' : 'Show reference panel'}
              >
                <ChevronRightIcon size="sm" />
              </button>

              {/* Reference panel */}
              <aside className={`workflow-reference-panel ${isReferencePanelOpen ? 'open' : 'closed'}`}>
                <div className="reference-panel-content">
                  {/* Agent types section */}
                  <section className="reference-section">
                    <h3 className="reference-section-title">Available Agents</h3>
                    <p className="reference-section-desc">Use these IDs in the typeId field</p>
                    <div className="reference-agent-list">
                      {subagentTypes.map((agent) => (
                        <button
                          key={agent.id}
                          className={`reference-agent-item ${copiedAgentId === agent.id ? 'copied' : ''}`}
                          onClick={() => handleCopyAgentId(agent.id)}
                          title="Click to copy"
                        >
                          <code className="reference-agent-id">{agent.id}</code>
                          <span className="reference-agent-name">
                            {copiedAgentId === agent.id ? 'Copied!' : agent.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* JSON structure section */}
                  <section className="reference-section">
                    <h3 className="reference-section-title">JSON Structure</h3>
                    <p className="reference-section-desc">Example workflow format</p>
                    <pre className="reference-code-block">{JSON_EXAMPLE}</pre>
                  </section>

                  {/* Tips section */}
                  <section className="reference-section reference-section-tips">
                    <h3 className="reference-section-title">Tips</h3>
                    <ul className="reference-tips-list">
                      <li>Each step must have a unique <code>id</code></li>
                      <li>The <code>agents</code> array defines parallel execution</li>
                      <li>Steps execute sequentially from top to bottom</li>
                    </ul>
                  </section>
                </div>
              </aside>
            </div>
          ) : steps.length === 0 ? (
            // Empty state
            <div className="workflow-builder-empty">
              <div className="workflow-builder-empty-icon">
                <WorkflowIcon size="lg" />
              </div>
              <h2 className="workflow-builder-empty-title">
                Build Your Workflow
              </h2>
              <p className="workflow-builder-empty-desc">
                Click the + button below to add your first step
              </p>
            </div>
          ) : (
            // Pipeline visualization
            <>
              <div className="workflow-builder-step-count">
                {steps.length} {steps.length === 1 ? 'step' : 'steps'}
              </div>
              <WorkflowPipeline
                steps={steps}
                subagentTypes={subagentTypes}
                onStepsChange={handleStepsChange}
              />
            </>
          )}
        </div>
      </main>

      {/* Floating add button - only show in visual mode */}
      {editorMode === 'visual' && (
        <FloatingAddButton
          subagentTypes={subagentTypes}
          onAddStep={handleAddStep}
        />
      )}
    </div>
  )
}

export default WorkflowBuilderPage
