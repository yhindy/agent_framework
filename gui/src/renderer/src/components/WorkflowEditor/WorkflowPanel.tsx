import { useState, useEffect, useCallback } from 'react'
import { XIcon, HourglassIcon } from '../icons'
import { WorkflowPipeline } from './WorkflowPipeline'
import StepPalette from './StepPalette'
import type {
  WorkflowConfig,
  WorkflowItem,
  WorkflowStep,
  SubagentType
} from '../../../../main/services/types/WorkflowTypes'
import './WorkflowPanel.css'

export interface WorkflowPanelProps {
  isOpen: boolean
  onClose: () => void
  projectPath: string
  agentId?: string  // For locking awareness
}

interface PanelState {
  workflow: WorkflowConfig | null
  subagentTypes: SubagentType[]
  isLoading: boolean
  error: string | null
  isDirty: boolean
  isLocked: boolean
  lockedBy?: string
}

export function WorkflowPanel({ isOpen, onClose, projectPath, agentId }: WorkflowPanelProps) {
  const [state, setState] = useState<PanelState>({
    workflow: null,
    subagentTypes: [],
    isLoading: false,
    error: null,
    isDirty: false,
    isLocked: false
  })

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isPaletteExpanded, setIsPaletteExpanded] = useState(false)

  // Load workflow data when panel opens
  useEffect(() => {
    if (!isOpen || !projectPath) return

    const loadData = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }))

      try {
        // Load subagent types and active workflow in parallel
        const [subagentTypes, workflow, lockStatus] = await Promise.all([
          window.electronAPI.getSubagentTypes(),
          window.electronAPI.getActiveWorkflow(projectPath),
          window.electronAPI.isWorkflowLocked(projectPath)
        ])

        // Check if locked by another agent
        const isLockedByOther = lockStatus.locked && lockStatus.lockedBy !== agentId

        setState({
          workflow,
          subagentTypes,
          isLoading: false,
          error: null,
          isDirty: false,
          isLocked: isLockedByOther,
          lockedBy: lockStatus.lockedBy
        })

        // Acquire lock if not locked
        if (agentId && !lockStatus.locked) {
          await window.electronAPI.lockWorkflow(projectPath, agentId)
        }
      } catch (err: any) {
        console.error('[WorkflowPanel] Failed to load workflow:', err)
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: err.message || 'Failed to load workflow configuration'
        }))
      }
    }

    loadData()

    // Release lock on unmount
    return () => {
      if (agentId && projectPath) {
        window.electronAPI.unlockWorkflow(projectPath, agentId).catch(() => {
          // Ignore unlock errors on cleanup
        })
      }
    }
  }, [isOpen, projectPath, agentId])

  // Handle items change from pipeline
  const handleItemsChange = useCallback((items: WorkflowItem[]) => {
    setState(prev => {
      if (!prev.workflow) return prev
      return {
        ...prev,
        workflow: { ...prev.workflow, items },
        isDirty: true
      }
    })
  }, [])

  // Handle selection change
  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids)
  }, [])

  // Handle adding a new step from the palette
  const handleAddStep = useCallback((typeId: string) => {
    if (!state.workflow) return

    const subagentType = state.subagentTypes.find(t => t.id === typeId)
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      type: 'step',
      name: `New ${subagentType?.name || 'Step'}`,
      subagentTypeId: typeId,
      enabled: true
    }

    const updatedItems = [...state.workflow.items, newStep]
    setState(prev => {
      if (!prev.workflow) return prev
      return {
        ...prev,
        workflow: { ...prev.workflow, items: updatedItems },
        isDirty: true
      }
    })
    setIsPaletteExpanded(false)
  }, [state.workflow, state.subagentTypes])

  // Save workflow
  const handleSave = async () => {
    if (!state.workflow || !projectPath) return

    setIsSaving(true)
    try {
      await window.electronAPI.updateWorkflow(
        projectPath,
        state.workflow.id,
        {
          items: state.workflow.items,
          updatedAt: new Date().toISOString()
        }
      )
      setState(prev => ({ ...prev, isDirty: false }))
    } catch (err: any) {
      console.error('[WorkflowPanel] Failed to save workflow:', err)
      setState(prev => ({
        ...prev,
        error: err.message || 'Failed to save workflow'
      }))
    } finally {
      setIsSaving(false)
    }
  }

  // Handle close with unsaved changes check
  const handleClose = () => {
    if (state.isDirty) {
      // Could show confirmation dialog here
      // For now, just close
    }
    onClose()
  }

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, state.isDirty])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`workflow-backdrop ${isOpen ? 'visible' : ''}`}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={`workflow-panel ${isOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-panel-title"
      >
        {/* Header */}
        <div className="workflow-panel-header">
          <button
            className="workflow-close-btn"
            onClick={handleClose}
            aria-label="Close workflow editor"
          >
            <XIcon size="sm" />
          </button>
          <div className="workflow-header-content">
            <h2 id="workflow-panel-title" className="workflow-title">
              WORKFLOW EDITOR
            </h2>
            <p className="workflow-subtitle">
              Configure execution order for your Super Minion
            </p>
          </div>
          <button className="workflow-help-btn" title="Help">
            ?
          </button>
        </div>

        {/* Content */}
        <div className="workflow-panel-content">
          {state.isLoading ? (
            <div className="workflow-loading">
              <HourglassIcon size="lg" />
              <span>Loading workflow...</span>
            </div>
          ) : state.error ? (
            <div className="workflow-error">
              <p>{state.error}</p>
              <button onClick={() => setState(prev => ({ ...prev, error: null }))}>
                Dismiss
              </button>
            </div>
          ) : state.isLocked ? (
            <div className="workflow-locked">
              <p>This workflow is being edited by another agent.</p>
              {state.lockedBy && <p className="locked-by">Locked by: {state.lockedBy}</p>}
            </div>
          ) : state.workflow ? (
            <>
              <StepPalette
                subagentTypes={state.subagentTypes}
                onAddStep={handleAddStep}
                isExpanded={isPaletteExpanded}
                onToggleExpanded={() => setIsPaletteExpanded(!isPaletteExpanded)}
              />
              <WorkflowPipeline
                items={state.workflow.items}
                subagentTypes={state.subagentTypes}
                onItemsChange={handleItemsChange}
                selectedIds={selectedIds}
                onSelectionChange={handleSelectionChange}
              />
            </>
          ) : (
            <div className="workflow-empty-state">
              <div className="workflow-empty-icon">
                <span role="img" aria-label="workflow">+</span>
              </div>
              <h3 className="workflow-empty-title">No Workflow Configured</h3>
              <p className="workflow-empty-desc">
                Create a workflow to define how your Super Minion orchestrates tasks.
              </p>
              <button className="workflow-start-btn">
                Create Workflow
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="workflow-panel-footer">
          {state.isDirty && (
            <div className="workflow-unsaved-indicator">
              Unsaved changes
            </div>
          )}
          <div className="workflow-footer-actions">
            <button
              className="workflow-cancel-btn"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              className="workflow-save-btn"
              onClick={handleSave}
              disabled={!state.isDirty || isSaving || state.isLocked}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
