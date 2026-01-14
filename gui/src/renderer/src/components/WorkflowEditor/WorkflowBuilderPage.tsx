// =============================================================================
// WORKFLOW BUILDER PAGE
// Full-screen workflow editor with floating action button
// =============================================================================

import { useState, useCallback, useMemo } from 'react'
import { ChevronLeftIcon, WorkflowIcon } from '../icons'
import { FloatingAddButton } from './FloatingAddButton'
import { WorkflowPipeline } from './WorkflowPipeline'
import type {
  WorkflowConfig,
  WorkflowStep,
  SubagentType
} from '../../../../main/services/types/WorkflowTypes'
import './WorkflowBuilderPage.css'

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

  // Track if changes have been made
  const isDirty = useMemo(() => {
    return JSON.stringify(steps) !== JSON.stringify(workflow.steps)
  }, [steps, workflow.steps])

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
    const updatedWorkflow: WorkflowConfig = {
      ...workflow,
      steps
    }
    onSave(updatedWorkflow)
  }, [workflow, steps, onSave])

  // Handle discard/cancel
  const handleDiscard = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to discard them?'
      )
      if (!confirmed) return
    }
    onCancel()
  }, [isDirty, onCancel])

  // Handle back button
  const handleBack = useCallback(() => {
    handleDiscard()
  }, [handleDiscard])

  return (
    <div className="workflow-builder-page">
      {/* Header */}
      <header className="workflow-builder-header">
        <div className="workflow-builder-header-left">
          <button
            className="workflow-builder-back-btn"
            onClick={handleBack}
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
          {steps.length === 0 ? (
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

      {/* Floating add button */}
      <FloatingAddButton
        subagentTypes={subagentTypes}
        onAddStep={handleAddStep}
      />
    </div>
  )
}

export default WorkflowBuilderPage
