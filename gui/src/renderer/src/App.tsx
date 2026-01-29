import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import ProjectPicker from './components/ProjectPicker'
import MainLayout from './components/MainLayout'
import { SnackbarProvider } from './contexts/SnackbarContext'
import { KeyboardShortcutsProvider } from './contexts/KeyboardShortcutsContext'
import SnackbarContainer from './components/SnackbarContainer'
import { initGlobalOutputListener } from './components/Terminal'
import { useAgentStore } from './store/agentStore'
import './App.css'

function App() {
  const activeProjects = useAgentStore((s) => s.activeProjects)
  const fetchActiveProjects = useAgentStore((s) => s.fetchActiveProjects)
  const subscribeToEvents = useAgentStore((s) => s.subscribeToEvents)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Initialize global terminal output listener BEFORE any agent operations.
    // This prevents a race condition where the PTY starts sending output before
    // the listener is registered, which would cause the terminal to appear blank.
    initGlobalOutputListener()

    async function init() {
      await fetchActiveProjects()
      setLoading(false)
    }
    init()

    // Subscribe to IPC events for centralized state updates
    const unsubscribe = subscribeToEvents()
    return () => unsubscribe()
  }, [])

  const refreshState = async () => {
    await fetchActiveProjects()
  }

  const handleProjectSelect = async (_project: unknown) => {
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
    <SnackbarProvider>
      <KeyboardShortcutsProvider>
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
        <SnackbarContainer />
      </KeyboardShortcutsProvider>
    </SnackbarProvider>
  )
}

export default App
