import { useState, useEffect, useRef } from 'react'
import './MissionDropdown.css'

interface MissionDropdownProps {
  onNewMission: (isSuper?: boolean) => void
  onTeleport: () => void
  onAddProject?: () => void
  showAddProject?: boolean
  /** Render mode: 'button' shows "+ New Mission" button, 'icon' shows just "+" icon */
  variant?: 'button' | 'icon'
}

function MissionDropdown({
  onNewMission,
  onTeleport,
  onAddProject,
  showAddProject = false,
  variant = 'button'
}: MissionDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
    return undefined
  }, [showDropdown])

  const handleItemClick = (action: () => void) => {
    action()
    setShowDropdown(false)
  }

  return (
    <div className="mission-dropdown-container" ref={dropdownRef}>
      {variant === 'button' ? (
        <button
          className="mission-dropdown-btn"
          onClick={() => setShowDropdown(!showDropdown)}
        >
          + New Mission
        </button>
      ) : (
        <div
          className="mission-dropdown-icon-trigger"
          onClick={() => setShowDropdown(!showDropdown)}
        >
          <span className="mission-dropdown-icon">+</span>
        </div>
      )}

      {showDropdown && (
        <div className="mission-dropdown-menu">
          {showAddProject && onAddProject && (
            <>
              <div
                className="mission-dropdown-item"
                onClick={() => handleItemClick(onAddProject)}
              >
                <span className="mission-dropdown-item-icon">📁</span>
                <span className="mission-dropdown-item-label">Add Project</span>
              </div>
            </>
          )}
          <div
            className="mission-dropdown-item"
            onClick={() => handleItemClick(() => onNewMission())}
          >
            <span className="mission-dropdown-item-icon">🍌</span>
            <span className="mission-dropdown-item-label">New Minion</span>
          </div>
          <div className="mission-dropdown-divider" />
          <div
            className="mission-dropdown-item teleport-option"
            onClick={() => handleItemClick(onTeleport)}
          >
            <span className="mission-dropdown-item-icon">📡</span>
            <span className="mission-dropdown-item-label">Teleport from Cloud</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default MissionDropdown
