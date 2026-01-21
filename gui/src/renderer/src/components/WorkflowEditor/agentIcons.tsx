// Shared icon helpers for workflow editor components

import {
  SearchIcon,
  HammerIcon,
  ClipboardIcon,
  BugIcon,
  RefreshIcon,
  PaletteIcon
} from '../icons'

type IconSize = 'xs' | 'sm' | 'md' | 'lg'

export function getAgentIcon(agentId: string, size: IconSize = 'sm'): JSX.Element {
  switch (agentId) {
    // Current valid agent IDs
    case 'Explore':
    case 'explore': // legacy
      return <SearchIcon size={size} />
    case 'Plan':
    case 'plan': // legacy
      return <ClipboardIcon size={size} />
    case 'general-purpose':
    case 'implement': // legacy
    case 'review': // legacy
    case 'test': // legacy
    case 'document': // legacy
      return <HammerIcon size={size} />
    case 'debugger':
    case 'debug': // legacy
      return <BugIcon size={size} />
    case 'code-simplifier':
    case 'simplify': // legacy
      return <RefreshIcon size={size} />
    case 'bold-frontend-designer':
      return <PaletteIcon size={size} />
    default:
      return <HammerIcon size={size} />
  }
}

export function getAgentColorClass(agentId: string): string {
  switch (agentId) {
    // Current valid agent IDs
    case 'Explore':
    case 'explore': // legacy
      return 'agent-explore'
    case 'Plan':
    case 'plan': // legacy
      return 'agent-plan'
    case 'general-purpose':
    case 'implement': // legacy
    case 'review': // legacy
    case 'test': // legacy
    case 'document': // legacy
      return 'agent-implement'
    case 'debugger':
    case 'debug': // legacy
      return 'agent-debug'
    case 'code-simplifier':
    case 'simplify': // legacy
      return 'agent-simplify'
    case 'bold-frontend-designer':
      return 'agent-frontend'
    default:
      return 'agent-implement'
  }
}
