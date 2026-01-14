import { ReactNode } from 'react'
import type { SubagentType } from '../../../../main/services/types/WorkflowTypes'
import { SearchIcon, HammerIcon, ClipboardIcon, BugIcon, PlusIcon } from '../icons'
import './StepPalette.css'

// =============================================================================
// STEP PALETTE COMPONENT
// Collapsible palette for adding new steps to the workflow
// =============================================================================

interface StepPaletteProps {
  subagentTypes: SubagentType[]
  onAddStep: (typeId: string) => void
  isExpanded: boolean
  onToggleExpanded: () => void
}

// Icons for each step type
const STEP_TYPE_ICONS: Record<string, ReactNode> = {
  explore: <SearchIcon size="lg" />,
  implement: <HammerIcon size="lg" />,
  plan: <ClipboardIcon size="lg" />,
  debug: <BugIcon size="lg" />,
  'general-purpose': <HammerIcon size="lg" />,
  debugger: <BugIcon size="lg" />
}

// Get icon for a step type, with fallback
function getStepIcon(typeId: string): ReactNode {
  return STEP_TYPE_ICONS[typeId] || <HammerIcon size="lg" />
}

function StepPalette({
  subagentTypes,
  onAddStep,
  isExpanded,
  onToggleExpanded
}: StepPaletteProps) {
  const handleAddStep = (typeId: string) => {
    onAddStep(typeId)
    // Optionally collapse after adding
    // onToggleExpanded()
  }

  if (!isExpanded) {
    return (
      <button
        className="step-palette-collapsed"
        onClick={onToggleExpanded}
        aria-expanded={false}
        aria-label="Expand step palette"
      >
        <PlusIcon size="sm" />
        <span>Add a Step</span>
      </button>
    )
  }

  return (
    <div className="step-palette-expanded">
      <div className="step-palette-header">
        <h3 className="step-palette-title">Add a Step</h3>
        <button
          className="step-palette-close"
          onClick={onToggleExpanded}
          aria-label="Close step palette"
        >
          Collapse
        </button>
      </div>

      <div className="step-type-grid">
        {subagentTypes.map((type) => (
          <button
            key={type.id}
            className="step-type-card"
            data-type={type.id}
            onClick={() => handleAddStep(type.id)}
            title={`Add ${type.name} step`}
          >
            <span className="step-type-icon">
              {getStepIcon(type.id)}
            </span>
            <span className="step-type-name">{type.name}</span>
            <span className="step-type-desc">{type.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default StepPalette
