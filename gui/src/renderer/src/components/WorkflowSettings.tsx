import { useState, useEffect } from 'react'
import type {
  WorkflowConfig,
  SubagentType
} from '../../../main/services/types/WorkflowTypes'
import { WorkflowBuilderPage } from './WorkflowEditor'
import './WorkflowSettings.css'

function WorkflowSettings(): JSX.Element {
  const [templates, setTemplates] = useState<WorkflowConfig[]>([])
  const [subagentTypes, setSubagentTypes] = useState<SubagentType[]>([])
  const [editingTemplate, setEditingTemplate] = useState<WorkflowConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const [types, tmpls] = await Promise.all([
        window.electronAPI.getSubagentTypes(),
        window.electronAPI.getWorkflowTemplates()
      ])
      setSubagentTypes(types)
      setTemplates(tmpls)
    } catch (err) {
      console.error('Failed to load workflow data:', err)
      setError('Failed to load workflow templates')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateTemplate = async (): Promise<void> => {
    try {
      const config = await window.electronAPI.getWorkflowConfig()
      const defaultWorkflow = config.workflows.find((w) => w.isDefault)
      if (defaultWorkflow) {
        setEditingTemplate({
          ...defaultWorkflow,
          id: `template-${Date.now()}`,
          name: 'New Workflow Template',
          description: '',
          isDefault: false,
          isTemplate: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      } else {
        // Create empty template if no default exists
        setEditingTemplate({
          id: `template-${Date.now()}`,
          name: 'New Workflow Template',
          description: '',
          items: [],
          isDefault: false,
          isTemplate: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1
        })
      }
    } catch (err) {
      console.error('Failed to create template:', err)
      setError('Failed to create new template')
    }
  }

  const handleSaveTemplate = async (workflow: WorkflowConfig): Promise<void> => {
    try {
      await window.electronAPI.saveWorkflowAsTemplate(workflow, workflow.name)
      await loadData()
      setEditingTemplate(null)
    } catch (err) {
      console.error('Failed to save template:', err)
      setError('Failed to save template')
    }
  }

  const handleEditTemplate = (template: WorkflowConfig): void => {
    setEditingTemplate({ ...template })
  }

  const getStepCount = (template: WorkflowConfig): number => {
    let count = 0
    for (const item of template.items) {
      if (item.type === 'step') {
        count++
      } else if (item.type === 'parallel') {
        count += item.steps.length
      }
    }
    return count
  }

  if (isLoading) {
    return (
      <div className="workflow-settings">
        <div className="workflow-settings-loading">Loading workflow templates...</div>
      </div>
    )
  }

  return (
    <div className="workflow-settings">
      <div className="settings-section">
        <h2 className="section-title">Workflow Templates</h2>
        <div className="settings-card">
          <div className="workflow-settings-description">
            <p>
              Create and manage workflow templates for Super Minions. Templates define the phases
              and steps that orchestrators follow when executing tasks.
            </p>
          </div>

          {error && (
            <div className="workflow-settings-error">
              <p>{error}</p>
              <button onClick={() => setError(null)}>Dismiss</button>
            </div>
          )}

          <div className="template-list">
            {templates.length === 0 ? (
              <div className="template-empty-state">
                <p>No workflow templates yet. Create one to get started.</p>
              </div>
            ) : (
              templates.map((template) => (
                <div key={template.id} className="template-card">
                  <div className="template-info">
                    <div className="template-header">
                      <h3 className="template-name">{template.name}</h3>
                      {template.isDefault && <span className="default-badge">Default</span>}
                    </div>
                    <p className="template-description">
                      {template.description || 'No description'}
                    </p>
                    <span className="step-count">{getStepCount(template)} steps</span>
                  </div>
                  <div className="template-actions">
                    <button
                      className="template-edit-btn"
                      onClick={() => handleEditTemplate(template)}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <button className="create-template-btn" onClick={handleCreateTemplate}>
            + Create New Template
          </button>
        </div>
      </div>

      {editingTemplate && (
        <WorkflowBuilderPage
          workflow={editingTemplate}
          subagentTypes={subagentTypes}
          onSave={handleSaveTemplate}
          onCancel={() => setEditingTemplate(null)}
          title="Edit Template"
        />
      )}
    </div>
  )
}

export default WorkflowSettings
