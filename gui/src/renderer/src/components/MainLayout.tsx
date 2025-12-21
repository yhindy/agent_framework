import { Routes, Route, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import AgentView from './AgentView'
import './MainLayout.css'

interface MainLayoutProps {
  project: any
  onProjectCleared?: () => void
}

function MainLayout({ project, onProjectCleared }: MainLayoutProps) {
  const navigate = useNavigate()

  const handleNavigate = (path: string) => {
    // If navigating to root, check if we're clearing project
    if (path === '/') {
      onProjectCleared?.()
    }
    navigate(path)
  }

  return (
    <div className="main-layout">
      <Sidebar project={project} onNavigate={handleNavigate} />
      <div className="content-area">
        <Routes>
          <Route path="/" element={<Dashboard project={project} />} />
          <Route path="/agent/:agentId" element={<AgentView project={project} />} />
        </Routes>
      </div>
    </div>
  )
}

export default MainLayout

