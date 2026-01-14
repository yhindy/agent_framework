import React, { useState, ReactNode } from 'react'
import './TaskStatusCard.css'
import { TaskInvocation } from '../../../main/services/ClaudeSessionInfoService'
import { HammerIcon, SearchIcon, ClipboardIcon, BugIcon, TerminalIcon } from './icons'

interface TaskStatusCardProps {
  task: TaskInvocation
}

const PERSONA_ICONS: Record<string, ReactNode> = {
  'general-purpose': <HammerIcon size="sm" />,
  'Explore': <SearchIcon size="sm" />,
  'Plan': <ClipboardIcon size="sm" />,
  'debugger': <BugIcon size="sm" />,
  'Bash': <TerminalIcon size="sm" />
}

const TaskStatusCard: React.FC<TaskStatusCardProps> = ({ task }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const getPersonaIcon = (subagentType: string): ReactNode => {
    return PERSONA_ICONS[subagentType] || <HammerIcon size="sm" />
  }

  const getStatusClass = (status: string): string => {
    switch (status) {
      case 'running':
        return 'in_progress'
      case 'completed':
        return 'completed'
      case 'failed':
        return 'blocked'
      default:
        return 'pending'
    }
  }

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'running':
        return 'Running'
      case 'completed':
        return 'Completed'
      case 'failed':
        return 'Failed'
      default:
        return 'Unknown'
    }
  }

  const formatDuration = (startedAt: string, completedAt?: string): string => {
    const start = new Date(startedAt).getTime()
    const end = completedAt ? new Date(completedAt).getTime() : Date.now()
    const seconds = Math.floor((end - start) / 1000)

    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  return (
    <div
      className={`task-card ${isExpanded ? 'expanded' : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="task-card-header">
        <span className="task-icon">{getPersonaIcon(task.subagentType)}</span>
        <span className="task-description" title={task.description}>
          {task.description || 'Task'}
        </span>
        <span className={`status-badge ${getStatusClass(task.status)}`}>
          {getStatusLabel(task.status)}
        </span>
        <span className={`status-dot ${getStatusClass(task.status)}`}></span>
      </div>

      <div className="task-card-body">
        <div className="task-meta">
          <span className="task-type">{task.subagentType}</span>
          <span className="task-duration">
            {formatDuration(task.startedAt, task.completedAt)}
          </span>
        </div>

        {isExpanded && task.resultSummary && (
          <div className="task-result">
            <div className="result-label">Result:</div>
            <pre className="result-content">{task.resultSummary}</pre>
          </div>
        )}

        {!isExpanded && task.resultSummary && (
          <span className="expand-hint">Click to view result</span>
        )}
      </div>
    </div>
  )
}

export default TaskStatusCard
