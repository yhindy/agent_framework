import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import AgentView from './AgentView'
import SuperAgentView from './SuperAgentView'
import './MainLayout.css'

interface MainLayoutProps {
  activeProjects: any[]
  onProjectRemove: (path: string) => void
  onProjectAdd: () => void
  onRefresh: () => void
}

function MainLayout({ activeProjects, onProjectRemove, onProjectAdd, onRefresh }: MainLayoutProps) {
  const navigate = useNavigate()
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem('leftSidebarCollapsed')
    if (savedState !== null) {
      setIsLeftSidebarCollapsed(savedState === 'true')
    }
  }, [])

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  const toggleLeftSidebar = () => {
    const newState = !isLeftSidebarCollapsed
    setIsLeftSidebarCollapsed(newState)
    localStorage.setItem('leftSidebarCollapsed', String(newState))
  }

  return (
    <div className="main-layout">
      <Sidebar
        activeProjects={activeProjects}
        onNavigate={handleNavigate}
        onProjectRemove={onProjectRemove}
        onProjectAdd={onProjectAdd}
        isCollapsed={isLeftSidebarCollapsed}
        onToggleCollapse={toggleLeftSidebar}
      />
      <div className="content-area">
        <Routes>
          <Route path="/" element={<Dashboard activeProjects={activeProjects} onRefresh={onRefresh} />} />
          <Route path="/agent/:agentId" element={<AgentView activeProjects={activeProjects} />} />
          <Route path="/super/:agentId" element={<SuperAgentView activeProjects={activeProjects} />} />
        </Routes>
      </div>
    </div>
  )
}

export default MainLayout
