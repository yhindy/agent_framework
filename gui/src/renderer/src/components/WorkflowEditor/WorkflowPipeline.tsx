import { useCallback, useState } from 'react'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  SearchIcon,
  HammerIcon,
  ClipboardIcon,
  BugIcon,
  XIcon,
  PlusIcon
} from '../icons'
import type { WorkflowStep, SubagentType } from '../../../../main/services/types/WorkflowTypes'
import './WorkflowPanel.css'

export interface WorkflowPipelineProps {
  steps: WorkflowStep[]
  subagentTypes: SubagentType[]
  onStepsChange: (steps: WorkflowStep[]) => void
}

// Get icon for agent type
function getAgentIcon(agentId: string) {
  switch (agentId) {
    case 'explore':
      return <SearchIcon size="sm" />
    case 'implement':
      return <HammerIcon size="sm" />
    case 'plan':
      return <ClipboardIcon size="sm" />
    case 'debug':
      return <BugIcon size="sm" />
    default:
      return <HammerIcon size="sm" />
  }
}

// Get color class for agent type
function getAgentColorClass(agentId: string): string {
  switch (agentId) {
    case 'explore':
      return 'agent-explore'
    case 'implement':
      return 'agent-implement'
    case 'plan':
      return 'agent-plan'
    case 'debug':
      return 'agent-debug'
    default:
      return 'agent-implement'
  }
}

interface StepCardProps {
  step: WorkflowStep
  index: number
  totalCount: number
  subagentTypes: SubagentType[]
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onUpdateAgents: (agents: string[]) => void
  onUpdateName: (name: string) => void
}

function StepCard({
  step,
  index,
  totalCount,
  subagentTypes,
  onMoveUp,
  onMoveDown,
  onDelete,
  onUpdateAgents,
  onUpdateName
}: StepCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(step.name)
  const [showAddAgent, setShowAddAgent] = useState(false)

  const isParallel = step.agents.length > 1

  const handleSaveName = () => {
    if (editName.trim()) {
      onUpdateName(editName.trim())
    }
    setIsEditing(false)
  }

  const handleAddAgent = (agentId: string) => {
    if (!step.agents.includes(agentId)) {
      onUpdateAgents([...step.agents, agentId])
    }
    setShowAddAgent(false)
  }

  const handleRemoveAgent = (agentId: string) => {
    if (step.agents.length > 1) {
      onUpdateAgents(step.agents.filter(a => a !== agentId))
    }
  }

  const getAgentType = (id: string) => subagentTypes.find(t => t.id === id)

  return (
    <div className={`simple-step-card ${isParallel ? 'parallel' : ''}`}>
      <div className="step-header">
        <div className="step-number">{index + 1}</div>

        {isEditing ? (
          <input
            type="text"
            className="step-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
            autoFocus
          />
        ) : (
          <span
            className="step-name"
            onClick={() => setIsEditing(true)}
            title="Click to edit"
          >
            {step.name}
          </span>
        )}

        {isParallel && (
          <span className="parallel-badge">PARALLEL</span>
        )}

        <div className="step-actions">
          <button
            className="step-action-btn"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
          >
            <ChevronUpIcon size="sm" />
          </button>
          <button
            className="step-action-btn"
            onClick={onMoveDown}
            disabled={index === totalCount - 1}
            title="Move down"
          >
            <ChevronDownIcon size="sm" />
          </button>
          <button
            className="step-action-btn delete"
            onClick={onDelete}
            title="Delete step"
          >
            <XIcon size="sm" />
          </button>
        </div>
      </div>

      <div className="step-agents">
        {step.agents.map((agentId) => {
          const agent = getAgentType(agentId)
          return (
            <div key={agentId} className={`agent-chip ${getAgentColorClass(agentId)}`}>
              {getAgentIcon(agentId)}
              <span>{agent?.name || agentId}</span>
              {step.agents.length > 1 && (
                <button
                  className="agent-remove-btn"
                  onClick={() => handleRemoveAgent(agentId)}
                  title="Remove agent"
                >
                  <XIcon size="sm" />
                </button>
              )}
            </div>
          )
        })}

        <div className="add-agent-wrapper">
          <button
            className="add-agent-btn"
            onClick={() => setShowAddAgent(!showAddAgent)}
            title="Add parallel agent"
          >
            <PlusIcon size="sm" />
          </button>

          {showAddAgent && (
            <div className="agent-dropdown">
              {subagentTypes
                .filter(t => !step.agents.includes(t.id))
                .map(agent => (
                  <button
                    key={agent.id}
                    className={`agent-option ${getAgentColorClass(agent.id)}`}
                    onClick={() => handleAddAgent(agent.id)}
                  >
                    {getAgentIcon(agent.id)}
                    <span>{agent.name}</span>
                  </button>
                ))}
              {step.agents.length === subagentTypes.length && (
                <span className="agent-option disabled">All agents added</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function WorkflowPipeline({
  steps,
  subagentTypes,
  onStepsChange
}: WorkflowPipelineProps) {
  const [showAddStep, setShowAddStep] = useState(false)

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return
    const newSteps = [...steps]
    const temp = newSteps[index]
    newSteps[index] = newSteps[index - 1]
    newSteps[index - 1] = temp
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handleMoveDown = useCallback((index: number) => {
    if (index >= steps.length - 1) return
    const newSteps = [...steps]
    const temp = newSteps[index]
    newSteps[index] = newSteps[index + 1]
    newSteps[index + 1] = temp
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handleDelete = useCallback((index: number) => {
    const newSteps = steps.filter((_, i) => i !== index)
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handleUpdateAgents = useCallback((index: number, agents: string[]) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], agents }
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handleUpdateName = useCallback((index: number, name: string) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], name }
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handleAddStep = useCallback((agentId: string) => {
    const agent = subagentTypes.find(t => t.id === agentId)
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: agent?.name || 'New Step',
      agents: [agentId]
    }
    onStepsChange([...steps, newStep])
    setShowAddStep(false)
  }, [steps, subagentTypes, onStepsChange])

  if (steps.length === 0) {
    return (
      <div className="workflow-empty">
        <p>No steps yet. Add your first step to get started.</p>
        <div className="empty-actions">
          {subagentTypes.map(agent => (
            <button
              key={agent.id}
              className={`add-first-step-btn ${getAgentColorClass(agent.id)}`}
              onClick={() => handleAddStep(agent.id)}
            >
              {getAgentIcon(agent.id)}
              <span>{agent.name}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="simple-pipeline">
      {steps.map((step, index) => (
        <div key={step.id} className="pipeline-row">
          {index > 0 && <div className="pipeline-connector-line" />}
          <StepCard
            step={step}
            index={index}
            totalCount={steps.length}
            subagentTypes={subagentTypes}
            onMoveUp={() => handleMoveUp(index)}
            onMoveDown={() => handleMoveDown(index)}
            onDelete={() => handleDelete(index)}
            onUpdateAgents={(agents) => handleUpdateAgents(index, agents)}
            onUpdateName={(name) => handleUpdateName(index, name)}
          />
        </div>
      ))}

      <div className="add-step-section">
        <div className="pipeline-connector-line" />
        {showAddStep ? (
          <div className="add-step-dropdown">
            <span className="add-step-label">Add step with agent:</span>
            {subagentTypes.map(agent => (
              <button
                key={agent.id}
                className={`agent-option ${getAgentColorClass(agent.id)}`}
                onClick={() => handleAddStep(agent.id)}
              >
                {getAgentIcon(agent.id)}
                <span>{agent.name}</span>
              </button>
            ))}
            <button
              className="cancel-add-btn"
              onClick={() => setShowAddStep(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="add-step-btn"
            onClick={() => setShowAddStep(true)}
          >
            <PlusIcon size="sm" />
            <span>Add Step</span>
          </button>
        )}
      </div>
    </div>
  )
}
