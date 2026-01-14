import { CSSProperties, ReactNode } from 'react'
import './Icon.css'

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface IconProps {
  /** Size of the icon */
  size?: IconSize
  /** Custom className for styling */
  className?: string
  /** Accessible label for screen readers */
  'aria-label'?: string
  /** Custom inline styles */
  style?: CSSProperties
  /** Test ID for testing */
  'data-testid'?: string
}

// Size mapping to pixels
export const ICON_SIZES: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24
}

export interface BaseIconProps extends IconProps {
  children: ReactNode
  viewBox?: string
}

export function BaseIcon({
  size = 'md',
  className,
  'aria-label': ariaLabel,
  style,
  'data-testid': testId,
  children,
  viewBox = '0 0 24 24'
}: BaseIconProps): JSX.Element {
  const sizeValue = ICON_SIZES[size]
  const classes = className ? `icon icon--${size} ${className}` : `icon icon--${size}`

  return (
    <svg
      width={sizeValue}
      height={sizeValue}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={classes}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-hidden={!ariaLabel}
      style={style}
      data-testid={testId}
    >
      {children}
    </svg>
  )
}
