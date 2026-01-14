import { BaseIcon, type IconProps } from './Icon'

/** Clock icon - History/archive indicator */
export function ClockIcon(props: IconProps): JSX.Element {
  return (
    <BaseIcon {...props} data-testid="clock-icon" aria-label={props['aria-label'] || 'Clock'}>
      {/* Clock face */}
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" />
      {/* Hour hand */}
      <line
        x1="12"
        y1="12"
        x2="12"
        y2="7"
        stroke="currentColor"
        strokeLinecap="round"
      />
      {/* Minute hand */}
      <line
        x1="12"
        y1="12"
        x2="16"
        y2="12"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </BaseIcon>
  )
}
