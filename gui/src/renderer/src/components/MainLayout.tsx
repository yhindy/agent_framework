import { Routes, Route, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import AgentView from './AgentView'
import './MainLayout.css'

interface MainLayoutProps {
  project: any
}

function MainLayout({ project }: MainLayoutProps) {
  const navigate = useNavigate()

  return (
    <div className="main-layout">
      <Sidebar project={project} onNavigate={navigate} />
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

