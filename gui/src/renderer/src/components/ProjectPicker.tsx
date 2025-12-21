import { useState, useEffect } from 'react'
import './ProjectPicker.css'

interface ProjectPickerProps {
  onProjectSelect: (project: any) => void
}

function ProjectPicker({ onProjectSelect }: ProjectPickerProps) {
  const [recentProjects, setRecentProjects] = useState<any[]>([])
  const [error, setError] = useState<string>('')

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
          const path = files[0].path.split('/').slice(0, -1).join('/')
          await selectProject(path)
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
      onProjectSelect(project)
    } catch (err: any) {
      setError(err.message)
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
    </div>
  )
}

export default ProjectPicker

