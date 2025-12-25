import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import ProjectPicker from './components/ProjectPicker'
import MainLayout from './components/MainLayout'
import './App.css'

function App() {
  const [activeProjects, setActiveProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      const active = await window.electronAPI.getActiveProjects()
      setActiveProjects(active)
      setLoading(false)
    }
    init()
  }, [])

  const refreshState = async () => {
    const active = await window.electronAPI.getActiveProjects()
    setActiveProjects(active)
  }

  const handleProjectSelect = async (_project: any) => {
    // ProjectPicker (via electronAPI) handles the add/select logic backend-side
    // We just need to refresh our state
    await refreshState()
  }

  const handleRemoveProject = async (path: string) => {
    await window.electronAPI.removeProject(path)
    await refreshState()
  }

  const handleProjectAdd = () => {
    // Refresh active projects list when a new project is added
    console.log('[App] Project added, refreshing state')
    refreshState()
  }

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <Router>
      <div className="app-container">
        <Routes>
          <Route
            path="/"
            element={
              activeProjects.length > 0 ? (
                <Navigate to="/workspace" replace />
              ) : (
                <ProjectPicker onProjectSelect={handleProjectSelect} />
              )
            }
          />
          <Route
            path="/workspace/*"
            element={
              activeProjects.length > 0 ? (
                <MainLayout 
                  activeProjects={activeProjects}
                  onProjectRemove={handleRemoveProject}
                  onProjectAdd={handleProjectAdd}
                  onRefresh={refreshState}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Routes>
      </div>
    </Router>
  )
}

export default App
