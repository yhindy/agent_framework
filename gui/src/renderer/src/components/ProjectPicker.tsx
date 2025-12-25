import { useState, useEffect } from 'react'
import ConfirmModal from './ConfirmModal'
import './ProjectPicker.css'

interface ProjectPickerProps {
  onProjectSelect: (project: any) => void
}

function ProjectPicker({ onProjectSelect }: ProjectPickerProps) {
  const [recentProjects, setRecentProjects] = useState<any[]>([])
  const [error, setError] = useState<string>('')
  const [showInstallModal, setShowInstallModal] = useState(false)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)

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
      const project = await window.electronAPI.selectProject(path)
      console.log('[ProjectPicker] Project selected successfully, needs install:', project.needsInstall)

      if (project.needsInstall) {
        console.log('[ProjectPicker] Showing install modal for:', path)
        setPendingPath(path)
        setShowInstallModal(true)
      } else {
        console.log('[ProjectPicker] Project ready, calling onProjectSelect')
        onProjectSelect(project)
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to select project'
      console.error('[ProjectPicker] Error selecting project:', errorMsg)
      setError(errorMsg)
    }
  }

  const handleInstall = async () => {
    if (!pendingPath) return

    try {
      console.log('[ProjectPicker] Installing framework for:', pendingPath)
      setIsInstalling(true)
      const project = await window.electronAPI.installFramework(pendingPath)
      console.log('[ProjectPicker] Framework installed successfully')
      onProjectSelect(project)
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to install framework'
      console.error('[ProjectPicker] Error installing framework:', errorMsg)
      setError(errorMsg)
    } finally {
      setIsInstalling(false)
      setShowInstallModal(false)
      setPendingPath(null)
    }
  }

  return (
    <div className="project-picker">
      <div className="project-picker-container">
        <h1>Minion Laboratory</h1>
        <p className="subtitle">Select a project to manage AI agents</p>

        {error && <div className="error">{error}</div>}

        <button className="select-button" onClick={handleSelectFolder}>
          Select Project Folder
        </button>

        {recentProjects.length > 0 && (
          <div className="recent-projects">
            <h2>Recent Projects</h2>
            <div className="project-list">
              {recentProjects.map((project) => (
                <div
                  key={project.path}
                  className="project-item"
                  onClick={() => selectProject(project.path)}
                >
                  <div className="project-name">{project.name}</div>
                  <div className="project-path">{project.path}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showInstallModal && (
        <ConfirmModal
          isOpen={true}
          title="Initialize Minions?"
          message={`The folder "${pendingPath?.split('/').pop()}" is not yet a Minion project. Would you like to install the framework?`}
          onConfirm={handleInstall}
          onCancel={() => {
            setShowInstallModal(false)
            setPendingPath(null)
          }}
          isLoading={isInstalling}
        />
      )}
    </div>
  )
}

export default ProjectPicker

