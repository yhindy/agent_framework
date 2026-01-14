import { useCallback, useMemo } from 'react'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  SearchIcon,
  HammerIcon,
  ClipboardIcon,
  BugIcon,
  XIcon
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
  isSelected: boolean
  onSelect: (id: string, multiSelect: boolean) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleEnabled: () => void
  onDelete: () => void
}

function StepCard({
  step,
  index,
  totalCount,
  subagentType,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onDelete
}: StepCardProps) {
  const handleClick = (e: React.MouseEvent) => {
    onSelect(step.id, e.shiftKey || e.metaKey || e.ctrlKey)
  }

  const colorClass = getSubagentColorClass(step.subagentTypeId)

  return (
    <div
      className={`workflow-step-card ${colorClass} ${isSelected ? 'selected' : ''} ${!step.enabled ? 'disabled' : ''}`}
      onClick={handleClick}
      data-type={step.subagentTypeId}
      role="listitem"
      aria-selected={isSelected}
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
          className="step-delete-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete step"
          aria-label="Delete step"
        >
          <XIcon size="sm" />
        </button>
      </div>

      {subagentType?.description && (
        <p className="step-description">{subagentType.description}</p>
      )}

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
        <div key={item.id} className="pipeline-item" data-step-index={index + 1}>
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
              isSelected={selectedIds.includes(item.id)}
              onSelect={handleSelect}
              onMoveUp={() => handleMoveUp(index)}
              onMoveDown={() => handleMoveDown(index)}
              onToggleEnabled={() => handleToggleEnabled(index)}
              onDelete={() => handleDeleteItem(index)}
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
