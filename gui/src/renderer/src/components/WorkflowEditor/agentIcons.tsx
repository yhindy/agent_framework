// Shared icon helpers for workflow editor components

import {
  SearchIcon,
  HammerIcon,
  ClipboardIcon,
  BugIcon,
  CheckCircleIcon,
  CheckIcon,
  EditIcon,
  RefreshIcon
} from '../icons'

type IconSize = 'xs' | 'sm' | 'md' | 'lg'

export function getAgentIcon(agentId: string, size: IconSize = 'sm'): JSX.Element {
  switch (agentId) {
    case 'explore':
      return <SearchIcon size={size} />
    case 'plan':
      return <ClipboardIcon size={size} />
    case 'review':
      return <CheckCircleIcon size={size} />
    case 'implement':
    case 'general-purpose':
      return <HammerIcon size={size} />
    case 'test':
      return <CheckIcon size={size} />
    case 'debug':
    case 'debugger':
      return <BugIcon size={size} />
    case 'document':
      return <EditIcon size={size} />
    case 'simplify':
      return <RefreshIcon size={size} />
    default:
      return <HammerIcon size={size} />
  }
}

export function getAgentColorClass(agentId: string): string {
  switch (agentId) {
    case 'explore':
      return 'agent-explore'
    case 'plan':
      return 'agent-plan'
    case 'review':
      return 'agent-review'
    case 'implement':
    case 'general-purpose':
      return 'agent-implement'
    case 'test':
      return 'agent-test'
    case 'debug':
    case 'debugger':
      return 'agent-debug'
    case 'document':
      return 'agent-document'
    case 'simplify':
      return 'agent-simplify'
    default:
      return 'agent-implement'
  }
}
