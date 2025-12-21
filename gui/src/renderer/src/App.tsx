import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import ProjectPicker from './components/ProjectPicker'
import MainLayout from './components/MainLayout'
import './App.css'

function App() {
  const [currentProject, setCurrentProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if there's a current project on load
    window.electronAPI.getCurrentProject().then((project) => {
      setCurrentProject(project)
      setLoading(false)
    })
  }, [])

  // Listen for project clear/change events from Sidebar or other components
  // In a real app we might use a Context or Redux, but checking periodically or exposing a refresher works too
  // Or simply, since Sidebar calls clearCurrentProject and then navigates to /, we should be fine IF App re-renders
  // But App only checks on mount. We need a way to know when project state changes.
  // Actually, MainLayout is rendered when currentProject is set. 
  // When Sidebar navigates to '/', if currentProject is still set, it redirects back to /workspace.
  // So we MUST update currentProject state here.
  
  // Quick fix: Expose a way for children to update project state
  // const handleProjectCleared = () => {
  //   setCurrentProject(null)
  // }

  // We can pass this down, but Sidebar is deep in MainLayout.
  // Instead, let's poll or listen for an event.
  // Or better: MainLayout can accept a prop 'onProjectCleared'


  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            currentProject ? (
              <Navigate to="/workspace" replace />
            ) : (
              <ProjectPicker onProjectSelect={setCurrentProject} />
            )
          }
        />
        <Route
          path="/workspace/*"
          element={
            currentProject ? (
              <MainLayout project={currentProject} onProjectCleared={() => setCurrentProject(null)} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
      </Routes>
    </Router>
  )
}

export default App

