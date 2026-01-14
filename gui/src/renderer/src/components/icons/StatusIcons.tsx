import { BaseIcon, IconProps } from './Icon'

/** Check icon - Simple checkmark */
export function CheckIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="check-icon">
      <path
        d="M5 12L10 17L19 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Check Circle icon - Checkmark inside circle (success) */
export function CheckCircleIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="check-circle-icon">
      <circle cx="12" cy="12" r="9" stroke="currentColor" />
      <path
        d="M8 12L11 15L16 9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** X Circle icon - X inside circle (error/failed) */
export function XCircleIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="x-circle-icon">
      <circle cx="12" cy="12" r="9" stroke="currentColor" />
      <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeLinecap="round" />
      <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}

/** Warning icon - Triangle with exclamation mark */
export function WarningIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="warning-icon">
      {/* Triangle */}
      <path
        d="M12 3L22 20H2L12 3Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      {/* Exclamation mark */}
      <line x1="12" y1="9" x2="12" y2="14" stroke="currentColor" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </BaseIcon>
  )
}

/** Sync icon - Bidirectional rotating arrows (in progress) */
export function SyncIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="sync-icon">
      {/* Top arc with arrow */}
      <path
        d="M4 12C4 7.58172 7.58172 4 12 4C14.5 4 16.7 5.1 18.2 6.8"
        stroke="currentColor"
        strokeLinecap="round"
      />
      <path
        d="M18.2 3V7H14.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom arc with arrow */}
      <path
        d="M20 12C20 16.4183 16.4183 20 12 20C9.5 20 7.3 18.9 5.8 17.2"
        stroke="currentColor"
        strokeLinecap="round"
      />
      <path
        d="M5.8 21V17H9.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Hourglass icon - Time/pending indicator */
export function HourglassIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="hourglass-icon">
      {/* Top and bottom bars */}
      <line x1="6" y1="3" x2="18" y2="3" stroke="currentColor" strokeLinecap="round" />
      <line x1="6" y1="21" x2="18" y2="21" stroke="currentColor" strokeLinecap="round" />
      {/* Hourglass shape */}
      <path
        d="M7 3V6C7 8 8 10 12 12C8 14 7 16 7 18V21"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 3V6C17 8 16 10 12 12C16 14 17 16 17 18V21"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Sand in bottom */}
      <path
        d="M9 17.5C10 16.5 14 16.5 15 17.5"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </BaseIcon>
  )
}
