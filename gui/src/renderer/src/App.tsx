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
              <MainLayout project={currentProject} />
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

