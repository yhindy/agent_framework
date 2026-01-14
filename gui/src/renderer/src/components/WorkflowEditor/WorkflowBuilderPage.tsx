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
  WorkflowItem,
  WorkflowStep,
  SubagentType
} from '../../../../main/services/types/WorkflowTypes'
import './WorkflowBuilderPage.css'

export interface WorkflowBuilderPageProps {
  workflow: WorkflowConfig
  subagentTypes: SubagentType[]
  onSave: (workflow: WorkflowConfig) => void
  onCancel: () => void
  title?: string // "Configure Workflow" or "Edit Template"
}

// Count enabled steps including those in parallel groups
// Steps are enabled by default if `enabled` is not explicitly set to false
function countSteps(items: WorkflowItem[]): number {
  return items.reduce((count, item) => {
    if (item.type === 'parallel') {
      return count + item.steps.filter(s => s.enabled !== false).length
    }
    if (item.type === 'step') {
      return count + (item.enabled !== false ? 1 : 0)
    }
    return count
  }, 0)
}

export function WorkflowBuilderPage({
  workflow,
  subagentTypes,
  onSave,
  onCancel,
  title = 'Configure Workflow'
}: WorkflowBuilderPageProps): JSX.Element {
  // Local state for editing
  const [items, setItems] = useState<WorkflowItem[]>(workflow.items)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Track if changes have been made
  const isDirty = useMemo(() => {
    return JSON.stringify(items) !== JSON.stringify(workflow.items)
  }, [items, workflow.items])

  // Step count for display
  const stepCount = useMemo(() => countSteps(items), [items])

  // Handle adding a new step
  const handleAddStep = useCallback(
    (subagentTypeId: string) => {
      const subagentType = subagentTypes.find((t) => t.id === subagentTypeId)
      if (!subagentType) return

      const newStep: WorkflowStep = {
        id: `step-${Date.now()}`,
        type: 'step',
        name: subagentType.name,
        subagentTypeId: subagentType.id,
        enabled: true
      }

      setItems((prev) => [...prev, newStep])
    },
    [subagentTypes]
  )

  // Handle items change from pipeline
  const handleItemsChange = useCallback((newItems: WorkflowItem[]) => {
    setItems(newItems)
  }, [])

  // Handle selection change from pipeline
  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids)
  }, [])

  // Handle save
  const handleSave = useCallback(() => {
    const updatedWorkflow: WorkflowConfig = {
      ...workflow,
      items,
      updatedAt: new Date().toISOString(),
      version: workflow.version + 1
    }
    onSave(updatedWorkflow)
  }, [workflow, items, onSave])

  // Handle discard/cancel
  const handleDiscard = useCallback(() => {
    if (isDirty) {
      // Show confirmation dialog
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
          {items.length === 0 ? (
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
                {stepCount} {stepCount === 1 ? 'step' : 'steps'}
              </div>
              <WorkflowPipeline
                items={items}
                subagentTypes={subagentTypes}
                onItemsChange={handleItemsChange}
                selectedIds={selectedIds}
                onSelectionChange={handleSelectionChange}
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
