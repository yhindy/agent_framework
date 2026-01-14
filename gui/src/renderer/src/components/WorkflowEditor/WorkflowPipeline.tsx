import { useCallback, useMemo, useState } from 'react'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  SearchIcon,
  HammerIcon,
  ClipboardIcon,
  BugIcon,
  XIcon,
  EditIcon
} from '../icons'
import type {
  WorkflowItem,
  WorkflowStep,
  ParallelGroup,
  SubagentType
} from '../../../../main/services/types/WorkflowTypes'
import './WorkflowPanel.css'

export interface WorkflowPipelineProps {
  items: WorkflowItem[]
  subagentTypes: SubagentType[]
  onItemsChange: (items: WorkflowItem[]) => void
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
}

// Type guards
function isWorkflowStep(item: WorkflowItem): item is WorkflowStep {
  return item.type === 'step'
}

function isParallelGroup(item: WorkflowItem): item is ParallelGroup {
  return item.type === 'parallel'
}

// Get icon for subagent type
function getSubagentIcon(subagentTypeId: string) {
  switch (subagentTypeId) {
    case 'explore':
      return <SearchIcon size="sm" />
    case 'implement':
    case 'general-purpose':
      return <HammerIcon size="sm" />
    case 'plan':
      return <ClipboardIcon size="sm" />
    case 'debug':
    case 'debugger':
      return <BugIcon size="sm" />
    default:
      return <HammerIcon size="sm" />
  }
}

// Get color class for subagent type
function getSubagentColorClass(subagentTypeId: string): string {
  switch (subagentTypeId) {
    case 'explore':
      return 'type-explore'
    case 'implement':
    case 'general-purpose':
      return 'type-implement'
    case 'plan':
      return 'type-plan'
    case 'debug':
    case 'debugger':
      return 'type-debug'
    default:
      return 'type-implement'
  }
}

interface StepCardProps {
  step: WorkflowStep
  index: number
  totalCount: number
  subagentType?: SubagentType
  subagentTypes: SubagentType[]
  isSelected: boolean
  isExpanded: boolean
  onSelect: (id: string, multiSelect: boolean) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleEnabled: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<WorkflowStep>) => void
  onToggleExpand: () => void
}

function StepCard({
  step,
  index,
  totalCount,
  subagentType,
  subagentTypes,
  isSelected,
  isExpanded,
  onSelect,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onDelete,
  onUpdate,
  onToggleExpand
}: StepCardProps) {
  const [editName, setEditName] = useState(step.name)
  const [editPromptOverride, setEditPromptOverride] = useState(step.promptOverride || '')

  const handleClick = (e: React.MouseEvent) => {
    // Don't handle if clicking on buttons or inputs
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) {
      return
    }
    onSelect(step.id, e.shiftKey || e.metaKey || e.ctrlKey)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Don't handle if clicking on buttons or inputs
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) {
      return
    }
    e.stopPropagation()
    onToggleExpand()
  }

  const handleSaveEdit = () => {
    onUpdate({
      name: editName,
      promptOverride: editPromptOverride || undefined
    })
    onToggleExpand()
  }

  const handleCancelEdit = () => {
    setEditName(step.name)
    setEditPromptOverride(step.promptOverride || '')
    onToggleExpand()
  }

  const handleTypeChange = (newTypeId: string) => {
    onUpdate({ subagentTypeId: newTypeId })
  }

  const colorClass = getSubagentColorClass(step.subagentTypeId)

  return (
    <div
      className={`workflow-step-card ${colorClass} ${isSelected ? 'selected' : ''} ${!step.enabled ? 'disabled' : ''} ${isExpanded ? 'expanded' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      data-type={step.subagentTypeId}
      role="listitem"
      aria-selected={isSelected}
      aria-expanded={isExpanded}
    >
      <div className="step-card-header">
        <div className="step-drag-handle" title="Drag to reorder">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div className="step-icon">
          {getSubagentIcon(step.subagentTypeId)}
        </div>
        <span className="step-name">{step.name}</span>
        <div className="step-reorder-buttons">
          <button
            className="step-reorder-btn"
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={index === 0}
            title="Move up"
            aria-label="Move step up"
          >
            <ChevronUpIcon size="sm" />
          </button>
          <button
            className="step-reorder-btn"
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={index === totalCount - 1}
            title="Move down"
            aria-label="Move step down"
          >
            <ChevronDownIcon size="sm" />
          </button>
        </div>
        <button
          className="step-edit-btn"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          title="Edit step"
          aria-label="Edit step"
        >
          <EditIcon size="sm" />
        </button>
        <button
          className="step-delete-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete step"
          aria-label="Delete step"
        >
          <XIcon size="sm" />
        </button>
      </div>

      {!isExpanded && subagentType?.description && (
        <p className="step-description">{subagentType.description}</p>
      )}

      {/* Expanded edit form */}
      {isExpanded && (
        <div className="step-edit-form">
          <div className="step-edit-field">
            <label className="step-edit-label">Step Name</label>
            <input
              type="text"
              className="step-edit-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Enter step name"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="step-edit-field">
            <label className="step-edit-label">Agent Type</label>
            <select
              className="step-edit-select"
              value={step.subagentTypeId}
              onChange={(e) => handleTypeChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {subagentTypes.map(type => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </div>
          <div className="step-edit-field">
            <label className="step-edit-label">Custom Instructions (optional)</label>
            <textarea
              className="step-edit-textarea"
              value={editPromptOverride}
              onChange={(e) => setEditPromptOverride(e.target.value)}
              placeholder="Add custom instructions for this step..."
              rows={3}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="step-edit-actions">
            <button
              className="step-edit-cancel-btn"
              onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
            >
              Cancel
            </button>
            <button
              className="step-edit-save-btn"
              onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {!isExpanded && (
        <div className="step-metadata">
          <span className="step-type-badge">{step.subagentTypeId}</span>
          <div className="step-toggle">
            <span className="step-toggle-label">Enabled</span>
            <button
              className={`step-toggle-switch ${step.enabled ? 'enabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleEnabled(); }}
              role="switch"
              aria-checked={step.enabled}
              aria-label={`${step.enabled ? 'Disable' : 'Enable'} step`}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface ParallelGroupCardProps {
  group: ParallelGroup
  index: number
  totalCount: number
  subagentTypes: SubagentType[]
  selectedIds: string[]
  onSelect: (id: string, multiSelect: boolean) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onStepChange: (stepId: string, updates: Partial<WorkflowStep>) => void
  onDeleteStep: (stepId: string) => void
  onUngroup: () => void
  onDelete: () => void
}

function ParallelGroupCard({
  group,
  index,
  totalCount,
  subagentTypes,
  selectedIds,
  onSelect,
  onMoveUp,
  onMoveDown,
  onStepChange,
  onDeleteStep,
  onUngroup,
  onDelete
}: ParallelGroupCardProps) {
  const getSubagentType = (id: string) => subagentTypes.find(t => t.id === id)

  return (
    <div className="parallel-group" role="group" aria-label="Parallel execution group">
      <div className="parallel-group-header">
        <span className="parallel-group-label">PARALLEL</span>
        <div className="parallel-group-reorder">
          <button
            className="step-reorder-btn"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move group up"
            aria-label="Move parallel group up"
          >
            <ChevronUpIcon size="sm" />
          </button>
          <button
            className="step-reorder-btn"
            onClick={onMoveDown}
            disabled={index === totalCount - 1}
            title="Move group down"
            aria-label="Move parallel group down"
          >
            <ChevronDownIcon size="sm" />
          </button>
        </div>
        <button
          className="parallel-ungroup-btn"
          onClick={onUngroup}
          title="Ungroup to sequential steps"
          aria-label="Ungroup parallel steps"
        >
          Ungroup
        </button>
        <button
          className="step-delete-btn"
          onClick={onDelete}
          title="Delete parallel group"
          aria-label="Delete parallel group"
        >
          <XIcon size="sm" />
        </button>
      </div>
      <div className="parallel-group-steps">
        {group.steps.map((step) => {
          // Look up subagent type for potential future use (e.g., tooltips)
          const _subagentType = getSubagentType(step.subagentTypeId)
          void _subagentType // Suppress unused variable warning
          return (
            <div
              key={step.id}
              className={`parallel-step-card ${getSubagentColorClass(step.subagentTypeId)} ${selectedIds.includes(step.id) ? 'selected' : ''} ${!step.enabled ? 'disabled' : ''}`}
              onClick={(e) => onSelect(step.id, e.shiftKey || e.metaKey || e.ctrlKey)}
              data-type={step.subagentTypeId}
            >
              <div className="step-icon">
                {getSubagentIcon(step.subagentTypeId)}
              </div>
              <span className="step-name">{step.name}</span>
              <button
                className={`step-toggle-switch small ${step.enabled ? 'enabled' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onStepChange(step.id, { enabled: !step.enabled })
                }}
                role="switch"
                aria-checked={step.enabled}
                aria-label={`${step.enabled ? 'Disable' : 'Enable'} ${step.name}`}
              />
              <button
                className="parallel-step-delete-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteStep(step.id)
                }}
                title="Remove from group"
                aria-label={`Remove ${step.name} from parallel group`}
              >
                <XIcon size="sm" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WorkflowPipeline({
  items,
  subagentTypes,
  onItemsChange,
  selectedIds,
  onSelectionChange
}: WorkflowPipelineProps) {
  // Track which step is expanded for editing
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Get subagent type by ID
  const getSubagentType = useCallback(
    (id: string) => subagentTypes.find(t => t.id === id),
    [subagentTypes]
  )

  // Handle selection
  const handleSelect = useCallback((id: string, multiSelect: boolean) => {
    if (multiSelect) {
      if (selectedIds.includes(id)) {
        onSelectionChange(selectedIds.filter(sid => sid !== id))
      } else {
        onSelectionChange([...selectedIds, id])
      }
    } else {
      onSelectionChange(selectedIds.includes(id) ? [] : [id])
    }
  }, [selectedIds, onSelectionChange])

  // Move item up
  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return
    const newItems = [...items]
    const temp = newItems[index]
    newItems[index] = newItems[index - 1]
    newItems[index - 1] = temp
    onItemsChange(newItems)
  }, [items, onItemsChange])

  // Move item down
  const handleMoveDown = useCallback((index: number) => {
    if (index >= items.length - 1) return
    const newItems = [...items]
    const temp = newItems[index]
    newItems[index] = newItems[index + 1]
    newItems[index + 1] = temp
    onItemsChange(newItems)
  }, [items, onItemsChange])

  // Toggle step enabled
  const handleToggleEnabled = useCallback((index: number) => {
    const item = items[index]
    if (!isWorkflowStep(item)) return

    const newItems = [...items]
    newItems[index] = { ...item, enabled: !item.enabled }
    onItemsChange(newItems)
  }, [items, onItemsChange])

  // Delete item at index
  const handleDeleteItem = useCallback((index: number) => {
    const newItems = items.filter((_, i) => i !== index)
    // Also remove deleted item from selection
    const deletedId = items[index]?.id
    if (deletedId && selectedIds.includes(deletedId)) {
      onSelectionChange(selectedIds.filter(id => id !== deletedId))
    }
    onItemsChange(newItems)
  }, [items, selectedIds, onItemsChange, onSelectionChange])

  // Handle step change within parallel group
  const handleParallelStepChange = useCallback((
    groupIndex: number,
    stepId: string,
    updates: Partial<WorkflowStep>
  ) => {
    const group = items[groupIndex]
    if (!isParallelGroup(group)) return

    const newSteps = group.steps.map(step =>
      step.id === stepId ? { ...step, ...updates } : step
    )
    const newItems = [...items]
    newItems[groupIndex] = { ...group, steps: newSteps }
    onItemsChange(newItems)
  }, [items, onItemsChange])

  // Delete a step from a parallel group
  const handleDeleteParallelStep = useCallback((
    groupIndex: number,
    stepId: string
  ) => {
    const group = items[groupIndex]
    if (!isParallelGroup(group)) return

    const newSteps = group.steps.filter(step => step.id !== stepId)

    // If only one step remains, convert to standalone step
    if (newSteps.length === 1) {
      const newItems = [...items]
      newItems[groupIndex] = newSteps[0]
      onItemsChange(newItems)
    } else if (newSteps.length === 0) {
      // If no steps remain, remove the group entirely
      const newItems = items.filter((_, i) => i !== groupIndex)
      onItemsChange(newItems)
    } else {
      // Otherwise, keep it as a parallel group with remaining steps
      const newItems = [...items]
      newItems[groupIndex] = { ...group, steps: newSteps }
      onItemsChange(newItems)
    }

    // Remove deleted step from selection if selected
    if (selectedIds.includes(stepId)) {
      onSelectionChange(selectedIds.filter(id => id !== stepId))
    }
  }, [items, selectedIds, onItemsChange, onSelectionChange])

  // Update a step's properties
  const handleUpdateStep = useCallback((index: number, updates: Partial<WorkflowStep>) => {
    const item = items[index]
    if (!isWorkflowStep(item)) return

    const newItems = [...items]
    newItems[index] = { ...item, ...updates }
    onItemsChange(newItems)
  }, [items, onItemsChange])

  // Toggle expanded state for step editing
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id)
  }, [])

  // Ungroup a parallel group back into sequential steps
  const handleUngroup = useCallback((groupIndex: number) => {
    const group = items[groupIndex]
    if (!isParallelGroup(group)) return

    // Replace the parallel group with its individual steps
    const newItems = [
      ...items.slice(0, groupIndex),
      ...group.steps,
      ...items.slice(groupIndex + 1)
    ]
    onItemsChange(newItems)
  }, [items, onItemsChange])

  // Check if selected steps can be grouped (must be top-level steps, not in parallel groups)
  const canGroupAsParallel = useMemo(() => {
    if (selectedIds.length < 2) return false

    // Check that all selected IDs are top-level steps (not inside parallel groups)
    return selectedIds.every(id =>
      items.some(item => isWorkflowStep(item) && item.id === id)
    )
  }, [selectedIds, items])

  // Create parallel group from selected steps
  const handleCreateParallelGroup = useCallback(() => {
    if (!canGroupAsParallel) return

    // Find the selected steps (must be sequential, not already in parallel groups)
    const selectedSteps: WorkflowStep[] = []
    const newItems: WorkflowItem[] = []
    let insertIndex = -1

    items.forEach((item) => {
      if (isWorkflowStep(item) && selectedIds.includes(item.id)) {
        selectedSteps.push(item)
        if (insertIndex === -1) insertIndex = newItems.length
      } else {
        newItems.push(item)
      }
    })

    if (selectedSteps.length >= 2) {
      const parallelGroup: ParallelGroup = {
        id: `parallel-${Date.now()}`,
        type: 'parallel',
        steps: selectedSteps
      }
      newItems.splice(insertIndex, 0, parallelGroup)
      onItemsChange(newItems)
      onSelectionChange([])
    }
  }, [items, selectedIds, canGroupAsParallel, onItemsChange, onSelectionChange])

  // Clear selection
  const handleClearSelection = useCallback(() => {
    onSelectionChange([])
  }, [onSelectionChange])

  if (items.length === 0) {
    return (
      <div className="workflow-pipeline-empty">
        <p>No steps configured. Add steps to build your workflow.</p>
      </div>
    )
  }

  return (
    <div className="workflow-pipeline" role="list" aria-label="Workflow steps">
      {/* START marker */}
      <div className="pipeline-marker start">
        START
      </div>

      {items.map((item, index) => (
        <div
          key={item.id}
          className="pipeline-item"
          data-step-index={index + 1}
          data-step-type={isWorkflowStep(item) ? item.subagentTypeId : 'parallel'}
        >
          {/* Step number indicator */}
          <div className="step-index">{index + 1}</div>
          {/* Connector line */}
          <div className="pipeline-connector" />

          {isWorkflowStep(item) ? (
            <StepCard
              step={item}
              index={index}
              totalCount={items.length}
              subagentType={getSubagentType(item.subagentTypeId)}
              subagentTypes={subagentTypes}
              isSelected={selectedIds.includes(item.id)}
              isExpanded={expandedId === item.id}
              onSelect={handleSelect}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onToggleEnabled={() => handleToggleEnabled(index)}
              onDelete={() => handleDeleteItem(index)}
              onUpdate={(updates) => handleUpdateStep(index, updates)}
              onToggleExpand={() => handleToggleExpand(item.id)}
            />
          ) : isParallelGroup(item) ? (
            <ParallelGroupCard
              group={item}
              index={index}
              totalCount={items.length}
              subagentTypes={subagentTypes}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onStepChange={(stepId, updates) =>
                handleParallelStepChange(index, stepId, updates)
              }
              onDeleteStep={(stepId) =>
                handleDeleteParallelStep(index, stepId)
              }
              onUngroup={() => handleUngroup(index)}
              onDelete={() => handleDeleteItem(index)}
            />
          ) : null}
        </div>
      ))}

      {/* Final connector and END marker */}
      <div className="pipeline-connector" />
      <div className="pipeline-marker end">
        END
      </div>

      {/* Selection action bar - shows when 2+ steps are selected */}
      {canGroupAsParallel && (
        <div className="selection-action-bar">
          <span className="selection-count">
            <strong>{selectedIds.length}</strong> steps selected
          </span>
          <button
            className="group-parallel-btn"
            onClick={handleCreateParallelGroup}
            title="Group selected steps to run in parallel"
          >
            Group as Parallel
          </button>
          <button
            className="cancel-selection-btn"
            onClick={handleClearSelection}
            aria-label="Cancel selection"
          >
            <XIcon size="sm" />
          </button>
        </div>
      )}
    </div>
  )
}
