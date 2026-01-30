import { useState } from 'react'
import { createPortal } from 'react-dom'
import './HandoffModal.css'

interface HandoffModalProps {
  isOpen: boolean
  sourceAgentName?: string
  initialPrompt?: string
  initialBranchMode?: 'inherit' | 'fresh'
  defaultBranch?: string
  onConfirm: (request: {
    prompt: string
    branchMode: 'inherit' | 'fresh'
    shortName?: string
    tool?: string
    model?: string
  }) => void
  onCancel: () => void
  isLoading?: boolean
}

function HandoffModal({
  isOpen,
  sourceAgentName,
  initialPrompt = '',
  initialBranchMode = 'inherit',
  defaultBranch = 'main',
  onConfirm,
  onCancel,
  isLoading = false
}: HandoffModalProps) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [branchMode, setBranchMode] = useState<'inherit' | 'fresh'>(initialBranchMode)
  const [shortName, setShortName] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim()) return

    onConfirm({
      prompt: prompt.trim(),
      branchMode,
      shortName: shortName.trim() || undefined
    })
  }

  const modalContent = (
    <div className="modal-overlay" onClick={isLoading ? undefined : onCancel}>
      <div className="handoff-modal-content" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h3>Hand Off to New Agent</h3>
            {sourceAgentName && (
              <span className="handoff-source">From: {sourceAgentName}</span>
            )}
          </div>

          <div className="modal-body">
            <p className="handoff-workflow-hint">
              Paste the plan your current agent created for this work.
            </p>

            <div className="handoff-form-group">
              <label htmlFor="handoff-prompt">Plan for new agent</label>
              <textarea
                id="handoff-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Paste the plan from your current agent here..."
                rows={12}
                autoFocus
                disabled={isLoading}
              />
            </div>

            <div className="handoff-form-group">
              <label>Branch Mode</label>
              <div className="handoff-branch-options">
                <label className="handoff-radio-option">
                  <input
                    type="radio"
                    name="branchMode"
                    value="inherit"
                    checked={branchMode === 'inherit'}
                    onChange={() => setBranchMode('inherit')}
                    disabled={isLoading}
                  />
                  <div className="handoff-radio-content">
                    <span className="handoff-radio-title">Inherit Branch</span>
                    <span className="handoff-radio-desc">New agent continues from current code state</span>
                  </div>
                </label>
                <label className="handoff-radio-option">
                  <input
                    type="radio"
                    name="branchMode"
                    value="fresh"
                    checked={branchMode === 'fresh'}
                    onChange={() => setBranchMode('fresh')}
                    disabled={isLoading}
                  />
                  <div className="handoff-radio-content">
                    <span className="handoff-radio-title">Fresh Branch</span>
                    <span className="handoff-radio-desc">New agent starts from {defaultBranch} branch</span>
                  </div>
                </label>
              </div>
            </div>

            <button
              type="button"
              className="handoff-advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Options
            </button>

            {showAdvanced && (
              <div className="handoff-form-group handoff-advanced">
                <label htmlFor="handoff-shortname">Custom Branch Name (optional)</label>
                <input
                  id="handoff-shortname"
                  type="text"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder="e.g., bugfix-auth"
                  disabled={isLoading}
                />
                <span className="handoff-help-text">
                  Leave empty to auto-generate from the prompt
                </span>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onCancel} className="secondary" disabled={isLoading}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={isLoading || !prompt.trim()}
            >
              {isLoading ? 'Creating...' : 'Create Handoff Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

export default HandoffModal
