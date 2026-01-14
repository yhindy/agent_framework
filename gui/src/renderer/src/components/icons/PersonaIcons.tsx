import { BaseIcon, IconProps } from './Icon'

/**
 * Hammer icon - General purpose task
 * Design: Task Cube - 3D cube suggesting building blocks of work
 * Conveys: Building, constructing, foundational work, modular execution
 */
export function HammerIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="hammer-icon">
      {/* Isometric cube - top face */}
      <path
        d="M12 3L20 8V16L12 21L4 16V8L12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Internal edges for 3D effect */}
      <line x1="12" y1="12" x2="12" y2="21" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="4" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5" />
      {/* Center accent dot */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </BaseIcon>
  )
}

// =============================================================================
// HAMMER ICON ALTERNATIVES - General Purpose / Worker
// =============================================================================

/**
 * Hammer Option A: Wrench Tool
 * Design: Bold adjustable wrench - universal tool for any job.
 * Conveys: Versatility, professional craftsmanship, ready for any task.
 */
export function HammerOptionA(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="hammer-option-a">
      {/* Wrench head - open jaw */}
      <path
        d="M5 3L3 5L5 7L7 5L9 7V10L7 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 3L7 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Handle - long diagonal */}
      <line
        x1="7"
        y1="12"
        x2="17"
        y2="20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Handle end accent */}
      <line
        x1="17"
        y1="20"
        x2="20"
        y2="17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </BaseIcon>
  )
}

/**
 * Hammer Option B: Precision Gear
 * Design: Single bold gear with inner detail - distinct from settings (uses cog outline only).
 * Conveys: Precision work, mechanical reliability, systematic execution.
 */
export function HammerOptionB(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="hammer-option-b">
      {/* Outer gear with 8 teeth */}
      <path
        d="M12 2L13.5 4.5L16.5 4L17.5 6.5L20 8L19 10.5L21 12.5L19 14.5L20 17L17.5 18.5L16.5 21L13.5 20.5L12 23L10.5 20.5L7.5 21L6.5 18.5L4 17L5 14.5L3 12.5L5 10.5L4 8L6.5 6.5L7.5 4L10.5 4.5L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Inner hexagon - technical precision */}
      <path
        d="M12 8L15.5 10V14L12 16L8.5 14V10L12 8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </BaseIcon>
  )
}

/**
 * Hammer Option C: Task Cube
 * Design: 3D cube suggesting building blocks of work - abstract but professional.
 * Conveys: Building, constructing, foundational work, modular execution.
 */
export function HammerOptionC(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="hammer-option-c">
      {/* Isometric cube - top face */}
      <path
        d="M12 3L20 8V16L12 21L4 16V8L12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Internal edges for 3D effect */}
      <line x1="12" y1="12" x2="12" y2="21" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="4" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5" />
      {/* Center accent dot */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </BaseIcon>
  )
}

/**
 * Hammer Option D: Lightning Bolt
 * Design: Clean lightning bolt - energy, action, getting things done fast.
 * Conveys: Speed, power, efficient execution, dynamic work.
 */
export function HammerOptionD(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="hammer-option-d">
      {/* Bold lightning bolt */}
      <path
        d="M13 2L4 13H11L10 22L20 10H13L13 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
    </BaseIcon>
  )
}

/** Search icon - Magnifying glass for explore tasks */
export function SearchIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="search-icon">
      {/* Glass circle */}
      <circle cx="10" cy="10" r="6" stroke="currentColor" />
      {/* Handle */}
      <line x1="14.5" y1="14.5" x2="20" y2="20" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}

/** Clipboard icon - Plan/document tasks */
export function ClipboardIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="clipboard-icon">
      {/* Board */}
      <rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" />
      {/* Clip */}
      <path
        d="M9 2H15V4C15 4.55228 14.5523 5 14 5H10C9.44772 5 9 4.55228 9 4V2Z"
        stroke="currentColor"
      />
      {/* Lines */}
      <line x1="8" y1="10" x2="16" y2="10" stroke="currentColor" strokeLinecap="round" />
      <line x1="8" y1="14" x2="16" y2="14" stroke="currentColor" strokeLinecap="round" />
      <line x1="8" y1="18" x2="12" y2="18" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}

/** Bug icon - Debug tasks */
export function BugIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="bug-icon">
      {/* Body - oval */}
      <ellipse cx="12" cy="14" rx="5" ry="6" stroke="currentColor" />
      {/* Head */}
      <circle cx="12" cy="6" r="2" stroke="currentColor" />
      {/* Antennae */}
      <path d="M10 4L8 2" stroke="currentColor" strokeLinecap="round" />
      <path d="M14 4L16 2" stroke="currentColor" strokeLinecap="round" />
      {/* Left legs */}
      <path d="M7 11L4 9" stroke="currentColor" strokeLinecap="round" />
      <path d="M7 14L4 14" stroke="currentColor" strokeLinecap="round" />
      <path d="M7 17L4 19" stroke="currentColor" strokeLinecap="round" />
      {/* Right legs */}
      <path d="M17 11L20 9" stroke="currentColor" strokeLinecap="round" />
      <path d="M17 14L20 14" stroke="currentColor" strokeLinecap="round" />
      <path d="M17 17L20 19" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}

/** Terminal icon - Terminal/bash tasks */
export function TerminalIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="terminal-icon">
      {/* Window frame */}
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" />
      {/* Prompt arrow > */}
      <path d="M7 10L10 12.5L7 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      {/* Cursor line */}
      <line x1="12" y1="15" x2="17" y2="15" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}
