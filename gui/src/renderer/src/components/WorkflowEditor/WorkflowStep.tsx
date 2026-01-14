import { useState, ReactNode } from 'react'
import { WorkflowStep as WorkflowStepType, SubagentType, StepType } from './workflowTypes'
import SubagentTypeDropdown from './SubagentTypeDropdown'
import { SearchIcon, HammerIcon, ClipboardIcon, BugIcon, ChevronUpIcon, ChevronDownIcon, XIcon } from '../icons'
import './WorkflowStep.css'

// =============================================================================
// WORKFLOW STEP COMPONENT
// Individual step card with editing capabilities
// =============================================================================

interface WorkflowStepProps {
  step: WorkflowStepType
  subagentTypes: SubagentType[]
  isSelected: boolean
  onUpdate: (step: WorkflowStepType) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onSelect: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}

// Icons for each step type
const STEP_TYPE_ICONS: Record<StepType, ReactNode> = {
  explore: <SearchIcon size="md" />,
  implement: <HammerIcon size="md" />,
  plan: <ClipboardIcon size="md" />,
  debug: <BugIcon size="md" />
}

function WorkflowStepComponent({
  step,
  subagentTypes,
  isSelected,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  onSelect,
  canMoveUp,
  canMoveDown
}: WorkflowStepProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [editedName, setEditedName] = useState(step.name)
  const [editedDescription, setEditedDescription] = useState(step.description || '')

  const handleToggleEnabled = () => {
    onUpdate({ ...step, enabled: !step.enabled })
  }

  const handleTypeChange = (typeId: string) => {
    const newType = typeId as StepType
    const subagent = subagentTypes.find(s => s.id === newType)
    onUpdate({
      ...step,
      type: newType,
      name: subagent?.name || step.name
    })
  }

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditedName(e.target.value)
  }

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditedDescription(e.target.value)
  }

  const handleSaveChanges = () => {
    onUpdate({
      ...step,
      name: editedName,
      description: editedDescription || undefined
    })
    setIsExpanded(false)
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't toggle expansion if clicking on interactive elements
    const target = e.target as HTMLElement
    if (
      target.closest('.step-toggle-switch') ||
      target.closest('.step-actions-btn') ||
      target.closest('.step-reorder-btn') ||
      target.closest('.step-delete-btn') ||
      target.closest('.subagent-type-dropdown') ||
      target.closest('.step-config-form')
    ) {
      return
    }

    if (e.shiftKey) {
      onSelect()
    } else {
      setIsExpanded(!isExpanded)
    }
  }

  const stepIcon = STEP_TYPE_ICONS[step.type]

  return (
    <div
      className={`workflow-step-card ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''} ${!step.enabled ? 'disabled' : ''}`}
      data-type={step.type}
      onClick={handleCardClick}
    >
      {/* Drag Handle */}
      <div className="step-drag-handle" title="Drag to reorder">
        <span></span>
        <span></span>
        <span></span>
      </div>

      {/* Header */}
      <div className="step-card-header">
        <span className="step-icon">{stepIcon}</span>
        <span className="step-name">{step.name}</span>

        {/* Reorder buttons */}
        <div className="step-reorder-controls">
          <button
            className="step-reorder-btn"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="Move up"
            aria-label="Move step up"
          >
            <ChevronUpIcon size="sm" />
          </button>
          <button
            className="step-reorder-btn"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="Move down"
            aria-label="Move step down"
          >
            <ChevronDownIcon size="sm" />
          </button>
        </div>

        {/* Delete button (visible on hover) */}
        <button
          className="step-actions-btn"
          onClick={onRemove}
          title="Remove step"
          aria-label="Remove step"
        >
          <XIcon size="sm" />
        </button>
      </div>

      {/* Description (if present and not expanded) */}
      {!isExpanded && step.description && (
        <p className="step-description">{step.description}</p>
      )}

      {/* Expanded Configuration Form */}
      {isExpanded && (
        <div className="step-config-form">
          <div className="step-config-field">
            <label htmlFor={`step-name-${step.id}`}>Name</label>
            <input
              id={`step-name-${step.id}`}
              type="text"
              value={editedName}
              onChange={handleNameChange}
              placeholder="Step name"
            />
          </div>

          <div className="step-config-field">
            <label htmlFor={`step-desc-${step.id}`}>Description (optional)</label>
            <textarea
              id={`step-desc-${step.id}`}
              value={editedDescription}
              onChange={handleDescriptionChange}
              placeholder="What does this step do?"
              rows={2}
            />
          </div>

          <div className="step-config-actions">
            <button
              className="step-save-btn"
              onClick={handleSaveChanges}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Metadata Row */}
      <div className="step-metadata">
        <SubagentTypeDropdown
          value={step.type}
          subagentTypes={subagentTypes}
          onChange={handleTypeChange}
          disabled={!step.enabled}
        />

        <div className="step-toggle">
          <span className="step-toggle-label">Enabled</span>
          <button
            className={`step-toggle-switch ${step.enabled ? 'enabled' : ''}`}
            onClick={handleToggleEnabled}
            role="switch"
            aria-checked={step.enabled}
            aria-label="Toggle step enabled"
          />
        </div>

        {/* Delete button in expanded mode */}
        {isExpanded && (
          <button
            className="step-delete-btn"
            onClick={onRemove}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

export default WorkflowStepComponent
