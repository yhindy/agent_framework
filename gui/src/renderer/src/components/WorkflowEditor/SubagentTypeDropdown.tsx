import { useState, useRef, useEffect, ReactNode } from 'react'
import { SubagentType, StepType } from './workflowTypes'
import { SearchIcon, HammerIcon, ClipboardIcon, BugIcon, ChevronDownIcon } from '../icons'
import './SubagentTypeDropdown.css'

// =============================================================================
// SUBAGENT TYPE DROPDOWN
// Dropdown selector for changing step type with color-coded icons
// =============================================================================

interface SubagentTypeDropdownProps {
  value: string
  subagentTypes: SubagentType[]
  onChange: (typeId: string) => void
  disabled?: boolean
}

// Icons for each step type
const STEP_TYPE_ICONS: Record<StepType, ReactNode> = {
  explore: <SearchIcon size="xs" />,
  implement: <HammerIcon size="xs" />,
  plan: <ClipboardIcon size="xs" />,
  debug: <BugIcon size="xs" />
}

function SubagentTypeDropdown({
  value,
  subagentTypes,
  onChange,
  disabled = false
}: SubagentTypeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedType = subagentTypes.find(t => t.id === value)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close dropdown on escape key
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!disabled) {
      setIsOpen(!isOpen)
    }
  }

  const handleSelect = (typeId: string) => {
    onChange(typeId)
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled) {
        setIsOpen(!isOpen)
      }
    }
  }

  return (
    <div
      className={`subagent-type-dropdown ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
      ref={dropdownRef}
    >
      <button
        className="dropdown-trigger"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        data-type={value}
      >
        <span className="dropdown-icon" data-type={value}>
          {STEP_TYPE_ICONS[value as StepType]}
        </span>
        <span className="dropdown-value">{selectedType?.name || value}</span>
        <ChevronDownIcon size="xs" className={`dropdown-chevron ${isOpen ? 'rotated' : ''}`} />
      </button>

      {isOpen && (
        <div className="dropdown-menu" role="listbox">
          {subagentTypes.map((type) => (
            <button
              key={type.id}
              className={`dropdown-option ${type.id === value ? 'selected' : ''}`}
              onClick={() => handleSelect(type.id)}
              role="option"
              aria-selected={type.id === value}
              data-type={type.id}
            >
              <span className="option-icon" data-type={type.id}>
                {STEP_TYPE_ICONS[type.id]}
              </span>
              <div className="option-content">
                <span className="option-name">{type.name}</span>
                <span className="option-description">{type.description}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default SubagentTypeDropdown
