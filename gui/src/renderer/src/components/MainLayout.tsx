import { Routes, Route, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import AgentView from './AgentView'
import './MainLayout.css'

interface MainLayoutProps {
  activeProjects: any[]
  onProjectRemove: (path: string) => void
  onProjectAdd: () => void
  onRefresh: () => void
}

function MainLayout({ activeProjects, onProjectRemove, onProjectAdd, onRefresh }: MainLayoutProps) {
  const navigate = useNavigate()

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  return (
    <div className="main-layout">
      <Sidebar 
        activeProjects={activeProjects}
        onNavigate={handleNavigate}
        onProjectRemove={onProjectRemove}
        onProjectAdd={onProjectAdd}
      />
      <div className="content-area">
        <Routes>
          <Route path="/" element={<Dashboard activeProjects={activeProjects} onRefresh={onRefresh} />} />
          <Route path="/agent/:agentId" element={<AgentView activeProjects={activeProjects} />} />
        </Routes>
      </div>
    </div>
  )
}

export default MainLayout
