import { BaseIcon, IconProps } from './Icon'

/** Copy icon - Two overlapping rectangles */
export function CopyIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="copy-icon">
      {/* Back rectangle */}
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" />
      {/* Front rectangle */}
      <path
        d="M16 8V6C16 4.89543 15.1046 4 14 4H6C4.89543 4 4 4.89543 4 6V14C4 15.1046 4.89543 16 6 16H8"
        stroke="currentColor"
      />
    </BaseIcon>
  )
}

/** Folder icon - Standard folder shape */
export function FolderIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="folder-icon">
      <path
        d="M3 7C3 5.89543 3.89543 5 5 5H9L11 7H19C20.1046 7 21 7.89543 21 9V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17V7Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Satellite icon - Signal arcs for teleport feature */
export function SatelliteIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="satellite-icon">
      {/* Dish arc */}
      <path
        d="M4 14C4 8.47715 8.47715 4 14 4"
        stroke="currentColor"
        strokeLinecap="round"
      />
      <path
        d="M7 17C7 11.4772 11.4772 7 17 7"
        stroke="currentColor"
        strokeLinecap="round"
      />
      <path
        d="M10 20C10 14.4772 14.4772 10 20 10"
        stroke="currentColor"
        strokeLinecap="round"
      />
      {/* Signal dot */}
      <circle cx="4" cy="20" r="2" fill="currentColor" />
    </BaseIcon>
  )
}

/** Refresh icon - Circular arrow for reload actions */
export function RefreshIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="refresh-icon">
      {/* Circular arrow */}
      <path
        d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C15.3137 3 18.1973 4.85653 19.7322 7.5"
        stroke="currentColor"
        strokeLinecap="round"
      />
      {/* Arrow head */}
      <path
        d="M21 3V8H16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Plus Circle icon - Plus inside circle for new item */
export function PlusCircleIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="plus-circle-icon">
      <circle cx="12" cy="12" r="9" stroke="currentColor" />
      <line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" strokeLinecap="round" />
      <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}
