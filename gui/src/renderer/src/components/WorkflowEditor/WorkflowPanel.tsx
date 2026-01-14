import { useState, useEffect, useCallback } from 'react'
import { XIcon, HourglassIcon } from '../icons'
import { WorkflowPipeline } from './WorkflowPipeline'
import type {
  WorkflowConfig,
  WorkflowStep,
  SubagentType
} from '../../../../main/services/types/WorkflowTypes'
import './WorkflowPanel.css'

export interface WorkflowPanelProps {
  isOpen: boolean
  onClose: () => void
  projectPath: string
  readOnly?: boolean
}

interface PanelState {
  workflow: WorkflowConfig | null
  subagentTypes: SubagentType[]
  isLoading: boolean
  error: string | null
  isDirty: boolean
}

export function WorkflowPanel({ isOpen, onClose, projectPath, readOnly = false }: WorkflowPanelProps) {
  const [state, setState] = useState<PanelState>({
    workflow: null,
    subagentTypes: [],
    isLoading: false,
    error: null,
    isDirty: false
  })

  const [isSaving, setIsSaving] = useState(false)

  // Load workflow data when panel opens
  useEffect(() => {
    if (!isOpen || !projectPath) return

    const loadData = async () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }))

      try {
        const [subagentTypes, workflow] = await Promise.all([
          window.electronAPI.getSubagentTypes(),
          window.electronAPI.getActiveWorkflow(projectPath)
        ])

        setState({
          workflow,
          subagentTypes,
          isLoading: false,
          error: null,
          isDirty: false
        })
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
  }, [isOpen, projectPath])

  // Handle steps change from pipeline
  const handleStepsChange = useCallback((steps: WorkflowStep[]) => {
    setState(prev => {
      if (!prev.workflow) return prev
      return {
        ...prev,
        workflow: { ...prev.workflow, steps },
        isDirty: true
      }
    })
  }, [])

  // Save workflow
  const handleSave = async () => {
    if (!state.workflow) return

    setIsSaving(true)
    try {
      await window.electronAPI.updateWorkflow(
        state.workflow.id,
        { steps: state.workflow.steps }
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

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

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
            onClick={onClose}
            aria-label="Close workflow editor"
          >
            <XIcon size="sm" />
          </button>
          <h2 id="workflow-panel-title" className="workflow-title">
            Workflow
          </h2>
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
          ) : state.workflow ? (
            <WorkflowPipeline
              steps={state.workflow.steps}
              subagentTypes={state.subagentTypes}
              onStepsChange={handleStepsChange}
              readOnly={readOnly}
            />
          ) : (
            <div className="workflow-empty">
              <p>No workflow configured</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {state.workflow && !state.workflow.isDefault && !readOnly && (
          <div className="workflow-panel-footer">
            {state.isDirty && (
              <div className="workflow-unsaved-indicator">
                Unsaved changes
              </div>
            )}
            <div className="workflow-footer-actions">
              <button
                className="workflow-cancel-btn"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="workflow-save-btn"
                onClick={handleSave}
                disabled={!state.isDirty || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
