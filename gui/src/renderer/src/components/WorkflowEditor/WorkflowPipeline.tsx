import { useCallback, useState, useEffect, useRef } from 'react'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  XIcon,
  PlusIcon,
  EditIcon
} from '../icons'
import { getAgentIcon, getAgentColorClass } from './agentIcons'
import type { WorkflowStep, SubagentType, StepAgent } from '../../../../main/services/types/WorkflowTypes'
import './WorkflowPanel.css'

export interface WorkflowPipelineProps {
  steps: WorkflowStep[]
  subagentTypes: SubagentType[]
  onStepsChange: (steps: WorkflowStep[]) => void
  readOnly?: boolean
}

interface StepCardProps {
  step: WorkflowStep
  index: number
  totalCount: number
  subagentTypes: SubagentType[]
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onUpdateAgents: (agents: StepAgent[]) => void
  onUpdateName: (name: string) => void
  readOnly?: boolean
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
  onUpdateName,
  readOnly = false
}: StepCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(step.name)
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null)
  const [editPromptValue, setEditPromptValue] = useState('')
  const addAgentRef = useRef<HTMLDivElement>(null)

  const isParallel = step.agents.length > 1

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showAddAgent) return

    const handleClickOutside = (event: MouseEvent) => {
      if (addAgentRef.current && !addAgentRef.current.contains(event.target as Node)) {
        setShowAddAgent(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddAgent])

  const handleSaveName = () => {
    if (editName.trim()) {
      onUpdateName(editName.trim())
    }
    setIsEditing(false)
  }

  const handleAddAgent = (typeId: string) => {
    const newAgent: StepAgent = {
      id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      typeId
    }
    onUpdateAgents([...step.agents, newAgent])
    setShowAddAgent(false)
  }

  const handleRemoveAgent = (agentId: string) => {
    if (step.agents.length > 1) {
      onUpdateAgents(step.agents.filter(a => a.id !== agentId))
    }
  }

  const handleEditPrompt = (agent: StepAgent) => {
    setEditingPromptId(agent.id)
    setEditPromptValue(agent.customPrompt || '')
  }

  const handleSavePrompt = () => {
    if (editingPromptId) {
      const updatedAgents = step.agents.map(a =>
        a.id === editingPromptId
          ? { ...a, customPrompt: editPromptValue.trim() || undefined }
          : a
      )
      onUpdateAgents(updatedAgents)
      setEditingPromptId(null)
      setEditPromptValue('')
    }
  }

  const getAgentType = (typeId: string) => subagentTypes.find(t => t.id === typeId)

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
            className={`step-name ${readOnly ? 'read-only' : ''}`}
            onClick={readOnly ? undefined : () => setIsEditing(true)}
            title={readOnly ? undefined : 'Click to edit'}
          >
            {step.name}
          </span>
        )}

        {isParallel && (
          <span className="parallel-badge">PARALLEL</span>
        )}

        {!readOnly && (
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
        )}
      </div>

      <div className="step-agents">
        {step.agents.map((stepAgent) => {
          const agentType = getAgentType(stepAgent.typeId)
          const isEditingThisPrompt = editingPromptId === stepAgent.id

          return (
            <div key={stepAgent.id} className="agent-item">
              <div className={`agent-chip ${getAgentColorClass(stepAgent.typeId)}`}>
                {getAgentIcon(stepAgent.typeId)}
                <span>{agentType?.name || stepAgent.typeId}</span>
                {!readOnly && (
                  <button
                    className="agent-edit-btn"
                    onClick={() => handleEditPrompt(stepAgent)}
                    title={stepAgent.customPrompt ? 'Edit custom prompt' : 'Add custom prompt'}
                  >
                    <EditIcon size="sm" />
                  </button>
                )}
                {!readOnly && step.agents.length > 1 && (
                  <button
                    className="agent-remove-btn"
                    onClick={() => handleRemoveAgent(stepAgent.id)}
                    title="Remove agent"
                  >
                    <XIcon size="sm" />
                  </button>
                )}
              </div>
              {stepAgent.customPrompt && !isEditingThisPrompt && (
                <div
                  className={`agent-custom-prompt ${readOnly ? 'read-only' : ''}`}
                  onClick={readOnly ? undefined : () => handleEditPrompt(stepAgent)}
                >
                  {stepAgent.customPrompt}
                </div>
              )}
              {isEditingThisPrompt && (
                <div className="prompt-editor">
                  <textarea
                    className="prompt-input"
                    value={editPromptValue}
                    onChange={(e) => setEditPromptValue(e.target.value)}
                    placeholder="Custom instructions for this agent..."
                    rows={2}
                    autoFocus
                  />
                  <div className="prompt-actions">
                    <button className="prompt-cancel-btn" onClick={() => setEditingPromptId(null)}>
                      Cancel
                    </button>
                    <button className="prompt-save-btn" onClick={handleSavePrompt}>
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {!readOnly && (
          <div className="add-agent-wrapper" ref={addAgentRef}>
            <button
              className="add-agent-btn"
              onClick={() => setShowAddAgent(!showAddAgent)}
              title="Add parallel agent"
            >
              <PlusIcon size="sm" />
            </button>

            {showAddAgent && (
              <div className="agent-dropdown" onClick={(e) => e.stopPropagation()}>
                {subagentTypes.map(agentType => (
                  <button
                    key={agentType.id}
                    className={`agent-option ${getAgentColorClass(agentType.id)}`}
                    onClick={() => handleAddAgent(agentType.id)}
                  >
                    {getAgentIcon(agentType.id)}
                    <span>{agentType.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function WorkflowPipeline({
  steps,
  subagentTypes,
  onStepsChange,
  readOnly = false
}: WorkflowPipelineProps) {
  const [showAddStep, setShowAddStep] = useState(false)
  const addStepRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showAddStep) return

    const handleClickOutside = (event: MouseEvent) => {
      if (addStepRef.current && !addStepRef.current.contains(event.target as Node)) {
        setShowAddStep(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddStep])

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

  const handleUpdateAgents = useCallback((index: number, agents: StepAgent[]) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], agents }
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handleUpdateName = useCallback((index: number, name: string) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], name }
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handleAddStep = useCallback((typeId: string) => {
    const agentType = subagentTypes.find(t => t.id === typeId)
    const newAgent: StepAgent = {
      id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      typeId
    }
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}`,
      name: agentType?.name || 'New Step',
      agents: [newAgent]
    }
    onStepsChange([...steps, newStep])
    setShowAddStep(false)
  }, [steps, subagentTypes, onStepsChange])

  if (steps.length === 0) {
    return (
      <div className="workflow-empty">
        <p>{readOnly ? 'No workflow steps configured.' : 'No steps yet. Add your first step to get started.'}</p>
        {!readOnly && (
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
        )}
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
            readOnly={readOnly}
          />
        </div>
      ))}

      {!readOnly && (
        <div className="add-step-section" ref={addStepRef}>
          <div className="pipeline-connector-line" />
          {showAddStep ? (
            <div className="add-step-dropdown" onClick={(e) => e.stopPropagation()}>
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
      )}
    </div>
  )
}
