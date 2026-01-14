import { ParallelGroup as ParallelGroupType, WorkflowStep, SubagentType } from './workflowTypes'
import WorkflowStepComponent from './WorkflowStep'
import './ParallelGroup.css'

// =============================================================================
// PARALLEL GROUP COMPONENT
// Container for parallel steps with visual distinction
// =============================================================================

interface ParallelGroupProps {
  group: ParallelGroupType
  subagentTypes: SubagentType[]
  onUpdate: (group: ParallelGroupType) => void
  onUngroup: () => void
  onStepUpdate: (stepId: string, step: WorkflowStep) => void
  onStepRemove: (stepId: string) => void
}

function ParallelGroup({
  group,
  subagentTypes,
  onUpdate,
  onUngroup,
  onStepUpdate,
  onStepRemove
}: ParallelGroupProps) {
  const handleStepUpdate = (stepId: string, updatedStep: WorkflowStep) => {
    const updatedSteps = group.steps.map(step =>
      step.id === stepId ? updatedStep : step
    )
    onUpdate({ ...group, steps: updatedSteps })
    onStepUpdate(stepId, updatedStep)
  }

  const handleStepRemove = (stepId: string) => {
    // If only one step remains after removal, auto-ungroup
    if (group.steps.length <= 2) {
      onUngroup()
      return
    }

    const updatedSteps = group.steps.filter(step => step.id !== stepId)
    onUpdate({ ...group, steps: updatedSteps })
    onStepRemove(stepId)
  }

  const handleMoveStep = (stepId: string, direction: 'up' | 'down') => {
    const currentIndex = group.steps.findIndex(s => s.id === stepId)
    if (currentIndex === -1) return

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= group.steps.length) return

    const newSteps = [...group.steps]
    const [movedStep] = newSteps.splice(currentIndex, 1)
    newSteps.splice(newIndex, 0, movedStep)

    onUpdate({ ...group, steps: newSteps })
  }

  return (
    <div className="parallel-group">
      {/* Ungroup button (visible on hover) */}
      <div className="parallel-group-actions">
        <button
          className="ungroup-btn"
          onClick={onUngroup}
          title="Ungroup steps"
          aria-label="Ungroup parallel steps"
        >
          Ungroup
        </button>
      </div>

      {/* Steps container */}
      <div className={`parallel-steps ${group.steps.length > 2 ? 'stacked' : ''}`}>
        {group.steps.map((step, index) => (
          <WorkflowStepComponent
            key={step.id}
            step={step}
            subagentTypes={subagentTypes}
            isSelected={false}
            onUpdate={(updatedStep) => handleStepUpdate(step.id, updatedStep)}
            onRemove={() => handleStepRemove(step.id)}
            onMoveUp={() => handleMoveStep(step.id, 'up')}
            onMoveDown={() => handleMoveStep(step.id, 'down')}
            onSelect={() => {/* Selection not supported in parallel groups */}}
            canMoveUp={index > 0}
            canMoveDown={index < group.steps.length - 1}
          />
        ))}
      </div>

      {/* Visual connector between steps */}
      {group.steps.length > 1 && (
        <div className="parallel-connector-line" aria-hidden="true" />
      )}
    </div>
  )
}

export default ParallelGroup
