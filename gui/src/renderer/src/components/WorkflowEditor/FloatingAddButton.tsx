import { useState, useCallback, useEffect, useRef } from 'react'
import { PlusIcon } from '../icons'
import { getAgentIcon, getAgentColorClass } from './agentIcons'
import type { SubagentType } from '../../../../main/services/types/WorkflowTypes'
import './FloatingAddButton.css'

export interface FloatingAddButtonProps {
  subagentTypes: SubagentType[]
  onAddStep: (typeId: string) => void
}

export function FloatingAddButton({
  subagentTypes,
  onAddStep
}: FloatingAddButtonProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close popover
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev)
  }, [])

  const handleStepClick = useCallback(
    (typeId: string) => {
      onAddStep(typeId)
      setIsOpen(false)
    },
    [onAddStep]
  )

  return (
    <div className="floating-add-button" ref={containerRef}>
      {/* Popover with step type options */}
      {isOpen && (
        <div
          className="fab-popover"
          role="menu"
          aria-labelledby="fab-trigger"
        >
          <div className="fab-popover-title">Add a Step</div>
          <div className="fab-step-grid">
            {subagentTypes.map((type) => (
              <button
                key={type.id}
                className={`fab-step-option ${getAgentColorClass(type.id)}`}
                onClick={() => handleStepClick(type.id)}
                role="menuitem"
                title={type.description}
              >
                <div className="fab-step-icon">
                  {getAgentIcon(type.id, 'md')}
                </div>
                <span className="fab-step-name">{type.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FAB trigger button */}
      <button
        id="fab-trigger"
        className={`fab-trigger ${isOpen ? 'open' : ''}`}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={isOpen ? 'Close step menu' : 'Add a step'}
      >
        <PlusIcon size="md" />
      </button>
    </div>
  )
}

export default FloatingAddButton
