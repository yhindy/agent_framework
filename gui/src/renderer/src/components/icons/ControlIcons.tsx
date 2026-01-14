import { BaseIcon, IconProps } from './Icon'

/** Chevron Left icon - Navigate/collapse left */
export function ChevronLeftIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="chevron-left-icon">
      <path
        d="M15 6L9 12L15 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Chevron Right icon - Navigate/expand right */
export function ChevronRightIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="chevron-right-icon">
      <path
        d="M9 6L15 12L9 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Chevron Down icon - Collapse/show more */
export function ChevronDownIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="chevron-down-icon">
      <path
        d="M6 9L12 15L18 9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Chevron Up icon - Expand/show less */
export function ChevronUpIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="chevron-up-icon">
      <path
        d="M6 15L12 9L18 15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Stop icon - Filled square for stop action */
export function StopIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="stop-icon">
      <rect
        x="6"
        y="6"
        width="12"
        height="12"
        rx="1"
        fill="currentColor"
        stroke="currentColor"
      />
    </BaseIcon>
  )
}

/** Play icon - Play triangle for start action */
export function PlayIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="play-icon">
      <polygon
        points="7,5 19,12 7,19"
        fill="currentColor"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </BaseIcon>
  )
}

/** Plus icon - Add/create action */
export function PlusIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="plus-icon">
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}

/** X icon - Close/remove action */
export function XIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="x-icon">
      <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeLinecap="round" />
      <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeLinecap="round" />
    </BaseIcon>
  )
}
