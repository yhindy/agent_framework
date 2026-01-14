import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ConfirmModal from './ConfirmModal'
import { useSnackbar } from '../contexts/SnackbarContext'
import './ProjectPicker.css'

interface ProjectPickerProps {
  onProjectSelect: (project: any) => void
}

type SetupStep = 'confirm' | 'initializing' | 'configuring' | 'starting' | 'ready' | 'error'

function ProjectPicker({ onProjectSelect }: ProjectPickerProps) {
  const navigate = useNavigate()
  const { addSnackbar, removeSnackbar } = useSnackbar()
  const [recentProjects, setRecentProjects] = useState<any[]>([])
  const [error, setError] = useState<string>('')
  const [showMigrationModal, setShowMigrationModal] = useState(false)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [isSettingUp, setIsSettingUp] = useState(false)
  const [setupStep, setSetupStep] = useState<SetupStep>('initializing')
  const [setupError, setSetupError] = useState<string>('')
  const [wizardAgentId, setWizardAgentId] = useState<string | null>(null)
  const [showSetupModal, setShowSetupModal] = useState(false)
  const [pendingProject, setPendingProject] = useState<any>(null)
  const [pendingSetupPath, setPendingSetupPath] = useState<string | null>(null)

  useEffect(() => {
    loadRecentProjects()
  }, [])

  const loadRecentProjects = async () => {
    const projects = await window.electronAPI.getRecentProjects()
    setRecentProjects(projects)
  }

  const handleSelectFolder = async () => {
    try {
      console.log('[ProjectPicker] Opening folder selection dialog')
      // Use electron dialog to select folder
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true as any

      input.onchange = async (e: any) => {
        const files = e.target.files
        if (files && files.length > 0) {
          console.log('[ProjectPicker] Folder selected, extracting path')
          const file = files[0]
          const fullPath = (file as any).path
          if (fullPath) {
             const path = fullPath.substring(0, fullPath.lastIndexOf(window.navigator.platform.startsWith('Win') ? '\\' : '/'))
             console.log('[ProjectPicker] Extracted project path:', path)
             await selectProject(path)
          } else {
            console.warn('[ProjectPicker] Could not extract path from selected file')
          }
        }
      }

      input.click()
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to open folder selection'
      console.error('[ProjectPicker] Error in folder selection:', errorMsg)
      setError(errorMsg)
    }
  }

  const selectProject = async (path: string) => {
    try {
      console.log('[ProjectPicker] Selecting project:', path)
      setError('')

      // Check if wizard is needed
      const wizardCheck = await window.electronAPI.checkWizard(path)
      console.log('[ProjectPicker] Wizard check:', wizardCheck)

      if (wizardCheck.needsWizard) {
        // Show confirmation modal before starting wizard
        console.log('[ProjectPicker] Project needs setup, showing confirmation:', path)
        setPendingSetupPath(path)
        setShowSetupModal(true)
        setSetupStep('confirm')
        setSetupError('')
      } else if (wizardCheck.hasLegacy) {
        // Has legacy structure - offer migration
        console.log('[ProjectPicker] Project has legacy structure, showing migration modal')
        setPendingPath(path)
        setShowMigrationModal(true)
      } else {
        // Already configured - just select it
        const project = await window.electronAPI.selectProject(path)
        console.log('[ProjectPicker] Project ready, navigating to dashboard')
        onProjectSelect(project)
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to select project'
      console.error('[ProjectPicker] Error:', errorMsg)
      setError(errorMsg)
      setIsSettingUp(false)
    }
  }

  const handleMigration = async () => {
    if (!pendingPath) return

    const snackbarId = addSnackbar({
      title: 'Migrating project',
      messages: ['Converting to new format...', 'This may take a moment...'],
      rotationInterval: 2000
    })

    try {
      console.log('[ProjectPicker] Migrating legacy project:', pendingPath)
      setIsSettingUp(true)

      // Migrate the project from legacy to new format
      await window.electronAPI.migrateProject(pendingPath)

      // Now select the migrated project
      const project = await window.electronAPI.selectProject(pendingPath)
      console.log('[ProjectPicker] Migration complete, navigating to dashboard')
      removeSnackbar(snackbarId)
      onProjectSelect(project)
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to migrate project'
      console.error('[ProjectPicker] Error migrating project:', errorMsg)
      setError(errorMsg)
      removeSnackbar(snackbarId)
    } finally {
      setIsSettingUp(false)
      setShowMigrationModal(false)
      setPendingPath(null)
    }
  }

  const handleConfirmSetup = async () => {
    if (!pendingSetupPath) return

    const path = pendingSetupPath
    console.log('[ProjectPicker] User confirmed setup, starting wizard for:', path)

    setIsSettingUp(true)
    setSetupStep('initializing')

    try {
      // Step 1: Initialize configuration
      await new Promise(resolve => setTimeout(resolve, 500))
      setSetupStep('configuring')

      // Step 2: Start wizard (creates minions.json, .minions/, and spawns Claude agent)
      const wizardSession = await window.electronAPI.startWizard(path)
      console.log('[ProjectPicker] Wizard session started:', wizardSession)
      setWizardAgentId(wizardSession.agentId)
      setSetupStep('starting')

      // Step 3: Add project to backend state (but don't trigger navigation yet)
      const project = await window.electronAPI.selectProject(path)
      console.log('[ProjectPicker] Project added to backend, storing for later navigation')
      // Store project for when user clicks "Open Project" button
      setPendingProject(project)

      // Step 4: Wait a moment for Claude to initialize, then show ready
      await new Promise(resolve => setTimeout(resolve, 1500))
      setSetupStep('ready')

    } catch (err: any) {
      console.error('[ProjectPicker] Setup error:', err)
      // Show error in modal instead of closing it
      setSetupStep('error')
      // Parse the error message for user-friendly display
      let errorMessage = err.message || 'An unexpected error occurred'
      if (errorMessage.includes('not a git repository')) {
        errorMessage = 'This folder is not a git repository. Please initialize git first with "git init".'
      }
      setSetupError(errorMessage)
    } finally {
      setIsSettingUp(false)
    }
  }

  const handleSkipSetup = async () => {
    if (!pendingSetupPath) return

    const path = pendingSetupPath
    console.log('[ProjectPicker] User skipped auto-setup, creating minimal config for:', path)

    setIsSettingUp(true)

    try {
      // Create minimal config without starting Claude
      await window.electronAPI.quickSetup(path)
      console.log('[ProjectPicker] Quick setup complete')

      // Now select the project
      const project = await window.electronAPI.selectProject(path)
      console.log('[ProjectPicker] Project added with minimal config')
      setShowSetupModal(false)
      setPendingSetupPath(null)
      onProjectSelect(project)
    } catch (err: any) {
      console.error('[ProjectPicker] Skip setup error:', err)
      setSetupStep('error')
      let errorMessage = err.message || 'An unexpected error occurred'
      if (errorMessage.includes('not a git repository')) {
        errorMessage = 'This folder is not a git repository. Please initialize git first with "git init".'
      }
      setSetupError(errorMessage)
    } finally {
      setIsSettingUp(false)
    }
  }

  const handleGoToWizard = () => {
    if (pendingProject) {
      // Now trigger navigation - user has seen the modal and clicked "Open Project"
      setShowSetupModal(false)
      onProjectSelect(pendingProject)
      if (wizardAgentId) {
        navigate(`/workspace/agent/${wizardAgentId}`)
      }
    } else if (wizardAgentId) {
      setShowSetupModal(false)
      navigate(`/workspace/agent/${wizardAgentId}`)
    }
  }

  const handleDismissSetup = () => {
    setShowSetupModal(false)
    setSetupStep('confirm')
    setSetupError('')
    setWizardAgentId(null)
    setPendingProject(null)
    setPendingSetupPath(null)
  }

  const getStepStatus = (step: SetupStep): 'pending' | 'active' | 'complete' => {
    if (setupStep === 'error' || setupStep === 'confirm') return 'pending'
    const steps: SetupStep[] = ['initializing', 'configuring', 'starting', 'ready']
    const currentIndex = steps.indexOf(setupStep)
    const stepIndex = steps.indexOf(step)

    if (stepIndex < currentIndex) return 'complete'
    if (stepIndex === currentIndex) return 'active'
    return 'pending'
  }

  return (
    <div className="project-picker">
      <div className="project-picker-container">
        <h1>Minion Laboratory</h1>
        <p className="subtitle">Select a project to manage AI agents</p>

        {error && <div className="error">{error}</div>}

        <button className="select-button" onClick={handleSelectFolder} disabled={isSettingUp}>
          Select Project Folder
        </button>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <h2>Recent Projects</h2>
            <div className="project-list">
              {recentProjects.map((project) => (
                <div
                  key={project.path}
                  className={`project-item ${isSettingUp ? 'disabled' : ''}`}
                  onClick={() => !isSettingUp && selectProject(project.path)}
                >
                  <div className="project-name">{project.name}</div>
                  <div className="project-path">{project.path}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Migration modal for legacy projects */}
      {showMigrationModal && (
        <ConfirmModal
          isOpen={true}
          title="Migrate Project?"
          message={`The folder "${pendingPath?.split('/').pop()}" uses an older configuration format. Would you like to migrate it to the new format? Your existing data will be preserved.`}
          confirmText="Migrate"
          onConfirm={handleMigration}
          onCancel={() => {
            setShowMigrationModal(false)
            setPendingPath(null)
          }}
          isLoading={isSettingUp}
        />
      )}

      {/* Setup wizard modal */}
      {showSetupModal && (
        <div className="setup-modal-overlay">
          <div className="setup-modal">
            {setupStep === 'error' ? (
              <>
                <div className="setup-modal-header">
                  <div className="setup-modal-icon error">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>
                  <h2>Setup Failed</h2>
                  <p className="setup-modal-subtitle">We couldn't set up this project</p>
                </div>

                <div className="setup-error-message">
                  {setupError}
                </div>

                <button className="setup-modal-button dismiss" onClick={handleDismissSetup}>
                  Go Back
                </button>
              </>
            ) : setupStep === 'confirm' ? (
              <>
                <div className="setup-modal-header">
                  <div className="setup-modal-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                  </div>
                  <h2>New Project Detected</h2>
                  <p className="setup-modal-subtitle">
                    {pendingSetupPath?.split('/').pop() || 'This project'}
                  </p>
                </div>

                <div className="setup-confirm-content">
                  <p className="setup-confirm-description">
                    This project hasn't been set up with Minions yet. You can either:
                  </p>
                  <div className="setup-options">
                    <div className="setup-option">
                      <div className="setup-option-header">
                        <strong>Auto-Setup with Claude</strong>
                        <span className="setup-option-badge">Recommended</span>
                      </div>
                      <p className="setup-option-description">
                        Start a Claude session to analyze your project and configure build/test commands automatically.
                      </p>
                      <p className="setup-option-note">Uses Anthropic API credits</p>
                    </div>
                    <div className="setup-option-divider">or</div>
                    <div className="setup-option">
                      <div className="setup-option-header">
                        <strong>Skip & Configure Manually</strong>
                      </div>
                      <p className="setup-option-description">
                        Import the project with a minimal config. You can edit <code>minions.json</code> later.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="setup-modal-buttons-stack">
                  <button className="setup-modal-button ready" onClick={handleConfirmSetup} disabled={isSettingUp}>
                    Start Auto-Setup
                  </button>
                  <button className="setup-modal-button secondary" onClick={handleSkipSetup} disabled={isSettingUp}>
                    Skip & Import Project
                  </button>
                  <button className="setup-modal-button dismiss" onClick={handleDismissSetup} disabled={isSettingUp}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="setup-modal-header">
                  <div className="setup-modal-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <h2>Setting Up Your Project</h2>
                  <p className="setup-modal-subtitle">Starting a Claude session to configure your project</p>
                </div>

                <div className="setup-steps">
                  <div className={`setup-step ${getStepStatus('initializing')}`}>
                    <div className="step-indicator">
                      {getStepStatus('initializing') === 'complete' ? '✓' : '1'}
                    </div>
                    <div className="step-content">
                      <div className="step-title">Initializing</div>
                      <div className="step-description">Creating project configuration</div>
                    </div>
                  </div>

                  <div className={`setup-step ${getStepStatus('configuring')}`}>
                    <div className="step-indicator">
                      {getStepStatus('configuring') === 'complete' ? '✓' : '2'}
                    </div>
                    <div className="step-content">
                      <div className="step-title">Configuring</div>
                      <div className="step-description">Setting up minions framework</div>
                    </div>
                  </div>

                  <div className={`setup-step ${getStepStatus('starting')}`}>
                    <div className="step-indicator">
                      {getStepStatus('starting') === 'complete' ? '✓' : '3'}
                    </div>
                    <div className="step-content">
                      <div className="step-title">Starting Claude Session</div>
                      <div className="step-description">Launching AI to analyze your project</div>
                    </div>
                  </div>

                  <div className={`setup-step ${getStepStatus('ready')}`}>
                    <div className="step-indicator">
                      {getStepStatus('ready') === 'complete' || setupStep === 'ready' ? '✓' : '4'}
                    </div>
                    <div className="step-content">
                      <div className="step-title">Ready</div>
                      <div className="step-description">Claude is ready to help configure your project</div>
                    </div>
                  </div>
                </div>

                {setupStep === 'ready' ? (
                  <button className="setup-modal-button ready" onClick={handleGoToWizard}>
                    Open Project
                  </button>
                ) : (
                  <div className="setup-modal-loading">
                    <div className="setup-spinner-small"></div>
                    <span>This may take a moment...</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ProjectPicker

