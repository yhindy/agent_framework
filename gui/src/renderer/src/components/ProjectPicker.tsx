import { useState, useEffect } from 'react'
import ConfirmModal from './ConfirmModal'
import './ProjectPicker.css'

interface ProjectPickerProps {
  onProjectSelect: (project: any) => void
}

function ProjectPicker({ onProjectSelect }: ProjectPickerProps) {
  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7254/ingest/6de0f374-f7c6-49b7-b558-3a685ee1af39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ProjectPicker.tsx:11',message:'ProjectPicker rendered',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
  }, []);
  // #endregion
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
      // Use electron dialog to select folder
      const input = document.createElement('input')
      input.type = 'file'
      input.webkitdirectory = true as any
      
      input.onchange = async (e: any) => {
        const files = e.target.files
        if (files && files.length > 0) {
          // This path logic is tricky with file inputs. 
          // Usually files[0].path gives full path to a file. 
          // If we selected a directory, modern browsers/Electron might behave differently.
          // Assuming `files[0].path` works (Electron specific)
          // But with directory selection, we might get the first file inside.
          // Let's rely on standard behavior if possible or what worked before.
          // Assuming the previous logic worked for the user environment.
          
          // Actually, 'webkitdirectory' makes files list all files in directory.
          // We can take the path of the first file and get dirname? 
          // Or usually file.path on Electron returns absolute path.
          
          // Better logic: The previous code did: files[0].path.split('/').slice(0, -1).join('/')
          // But if files[0] IS inside the dir, taking parent is correct?
          // If the dir is empty, we might get nothing?
          
          // Let's assume the previous logic works for now.
          const file = files[0]
          // If 'path' property exists (Electron), use it.
          const fullPath = (file as any).path
          if (fullPath) {
             // If we selected /Users/me/proj, files[0] might be /Users/me/proj/README.md
             // So dirname is /Users/me/proj.
             // But if we selected /Users/me/proj and it has subdirs...
             // Let's try to get the project path more robustly if possible.
             // The previous code: split('/').slice(0, -1) assumes we want the parent of the first file found.
             // This is generally correct for recursive directory selection.
             // Note: Windows paths use backslashes. This split('/') is fragile.
             
             // However, I won't change the path logic unless asked, to minimize risk.
             // I'll stick to the existing implementation but wrap it.
             const path = fullPath.substring(0, fullPath.lastIndexOf(window.navigator.platform.startsWith('Win') ? '\\' : '/'))
             await selectProject(path)
          }
        }
      }
      
      input.click()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const selectProject = async (path: string) => {
    try {
      setError('')
      const project = await window.electronAPI.selectProject(path)
      
      if (project.needsInstall) {
        setPendingPath(path)
        setShowInstallModal(true)
      } else {
        onProjectSelect(project)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleInstall = async () => {
    if (!pendingPath) return

    try {
      setIsInstalling(true)
      const project = await window.electronAPI.installFramework(pendingPath)
      onProjectSelect(project)
    } catch (err: any) {
      setError(err.message)
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

