import { BaseIcon, IconProps } from './Icon'

/**
 * Bot icon - Modern robot/agent representation
 * Design: Rounded robot head with antenna, two circular eyes, horizontal mouth line
 */
export function BotIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="bot-icon">
      {/* Antenna */}
      <line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" strokeLinecap="round" />
      <circle cx="12" cy="2" r="1" fill="currentColor" />
      {/* Head - rounded rectangle */}
      <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" />
      {/* Eyes - two circles */}
      <circle cx="9" cy="11" r="1.5" fill="currentColor" />
      <circle cx="15" cy="11" r="1.5" fill="currentColor" />
      {/* Mouth - horizontal line */}
      <line x1="8" y1="15" x2="16" y2="15" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}

/**
 * Crown icon - Represents super minion/orchestrator
 * Design: Hierarchy Diamond - Abstract organizational hierarchy with diamond at apex
 * Conveys: Top of the hierarchy, overseeing structure, systematic leadership
 */
export function CrownIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="crown-icon">
      {/* Apex diamond - the super minion */}
      <rect
        x="9"
        y="2"
        width="6"
        height="6"
        rx="1"
        transform="rotate(45 12 5)"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.2"
      />
      {/* Connecting lines down - 3 spokes */}
      <line x1="12" y1="9" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="6" y2="19" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="12" y2="19" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="18" y2="19" stroke="currentColor" strokeWidth="1.5" />
      {/* Lower tier nodes - 3 subordinates on same horizontal line */}
      <circle cx="6" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Middle connection point */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </BaseIcon>
  )
}

// =============================================================================
// CROWN ICON ALTERNATIVES - Super Minion / Orchestrator
// =============================================================================

/**
 * Crown Option A: Conductor Baton
 * Design: Elegant conductor's baton with motion lines suggesting orchestration.
 * Conveys: Leadership through coordination, directing multiple elements in harmony.
 */
export function CrownOptionA(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="crown-option-a">
      {/* Baton - thick diagonal stroke */}
      <line
        x1="6"
        y1="18"
        x2="18"
        y2="4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Baton tip accent */}
      <circle cx="18" cy="4" r="2" fill="currentColor" />
      {/* Motion arc lines - showing orchestration movement */}
      <path
        d="M8 8C10 6 14 6 16 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M6 12C9 9 15 9 18 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
        opacity="0.7"
      />
    </BaseIcon>
  )
}

/**
 * Crown Option B: Command Node
 * Design: Central hub with radiating connection lines - modern tech leadership.
 * Conveys: Central control, network orchestration, the brain of the operation.
 */
export function CrownOptionB(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="crown-option-b">
      {/* Central command node - larger, bold */}
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      {/* Radiating control lines to subordinate nodes */}
      <line x1="12" y1="8" x2="12" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14.8" y1="14.8" x2="18" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9.2" y1="14.8" x2="6" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Small endpoint nodes */}
      <circle cx="12" cy="3" r="1.5" fill="currentColor" />
      <circle cx="21" cy="12" r="1.5" fill="currentColor" />
      <circle cx="3" cy="12" r="1.5" fill="currentColor" />
    </BaseIcon>
  )
}

/**
 * Crown Option C: Hierarchy Diamond
 * Design: Abstract organizational hierarchy - diamond at apex with downward structure.
 * Conveys: Top of the hierarchy, overseeing structure, systematic leadership.
 */
export function CrownOptionC(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="crown-option-c">
      {/* Apex diamond - the super minion */}
      <rect
        x="9"
        y="2"
        width="6"
        height="6"
        rx="1"
        transform="rotate(45 12 5)"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.2"
      />
      {/* Connecting lines down */}
      <line x1="12" y1="9" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="6" y2="18" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="18" y2="18" stroke="currentColor" strokeWidth="1.5" />
      {/* Lower tier nodes */}
      <circle cx="6" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="19" r="2" stroke="currentColor" strokeWidth="1.5" />
      {/* Middle connection point */}
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </BaseIcon>
  )
}

/**
 * Crown Option D: Star Commander
 * Design: Bold star with emphasis ring - modern badge of authority.
 * Conveys: Excellence, premium status, the star player coordinating the team.
 */
export function CrownOptionD(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="crown-option-d">
      {/* Outer emphasis ring - subtle authority */}
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      {/* Inner ring */}
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" />
      {/* Bold 4-point star */}
      <path
        d="M12 5L13.5 10H18L14.5 13L16 18L12 15L8 18L9.5 13L6 10H10.5L12 5Z"
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
 * Home icon - Represents base branch agent
 * Design: Classic house silhouette with door
 */
export function HomeIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="home-icon">
      {/* Roof */}
      <path
        d="M3 12L12 4L21 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* House body */}
      <path
        d="M5 10V19C5 19.5523 5.44772 20 6 20H18C18.5523 20 19 19.5523 19 19V10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Door */}
      <path
        d="M10 20V15C10 14.4477 10.4477 14 11 14H13C13.5523 14 14 14.4477 14 15V20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}
