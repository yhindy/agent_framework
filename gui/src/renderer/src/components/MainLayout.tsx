import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Dashboard from './Dashboard'
import AgentView from './AgentView'
import SuperAgentView from './SuperAgentView'
import { ArchivePage } from './archive'
import { SkillsPage } from './skills/SkillsPage'
import SettingsPage from './SettingsPage'
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useKeyboardShortcutsContext } from '../contexts/KeyboardShortcutsContext'
import './MainLayout.css'

interface AgentInfo {
  id: string
  isSuperMinion?: boolean
}

interface MainLayoutProps {
  activeProjects: any[]
  onProjectRemove: (path: string) => void
  onProjectAdd: () => void
  onRefresh: () => void
}

function MainLayout({ activeProjects, onProjectRemove, onProjectAdd, onRefresh }: MainLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)
  const [flatAgentList, setFlatAgentList] = useState<AgentInfo[]>([])

  // Get keyboard shortcuts context
  const {
    modalControls,
    navigationControls,
    showHelpOverlay,
    toggleHelpOverlay,
    registerNavigationControls,
    unregisterNavigationControls,
    setShowHelpOverlay
  } = useKeyboardShortcutsContext()

  // Extract current agent ID from URL
  const getAgentIdFromPath = useCallback((): string | null => {
    const agentMatch = location.pathname.match(/\/workspace\/agent\/(.+)/)
    const superMatch = location.pathname.match(/\/workspace\/super\/(.+)/)
    return agentMatch?.[1] || superMatch?.[1] || null
  }, [location.pathname])

  const activeAgentId = getAgentIdFromPath()

  // Navigation functions
  const navigateToPreviousMinion = useCallback(() => {
    if (flatAgentList.length === 0) return
    const currentIndex = flatAgentList.findIndex(a => a.id === activeAgentId)
    if (currentIndex > 0) {
      const prevAgent = flatAgentList[currentIndex - 1]
      const route = prevAgent.isSuperMinion
        ? `/workspace/super/${prevAgent.id}`
        : `/workspace/agent/${prevAgent.id}`
      navigate(route)
    }
  }, [flatAgentList, activeAgentId, navigate])

  const navigateToNextMinion = useCallback(() => {
    if (flatAgentList.length === 0) return
    const currentIndex = flatAgentList.findIndex(a => a.id === activeAgentId)
    if (currentIndex < flatAgentList.length - 1) {
      const nextAgent = flatAgentList[currentIndex + 1]
      const route = nextAgent.isSuperMinion
        ? `/workspace/super/${nextAgent.id}`
        : `/workspace/agent/${nextAgent.id}`
      navigate(route)
    }
  }, [flatAgentList, activeAgentId, navigate])

  // Register navigation controls on mount
  useEffect(() => {
    const currentIndex = flatAgentList.findIndex(a => a.id === activeAgentId)
    registerNavigationControls({
      navigateToPreviousMinion,
      navigateToNextMinion,
      canNavigatePrevious: currentIndex > 0,
      canNavigateNext: currentIndex < flatAgentList.length - 1
    })

    return () => unregisterNavigationControls()
  }, [
    registerNavigationControls,
    unregisterNavigationControls,
    navigateToPreviousMinion,
    navigateToNextMinion,
    flatAgentList,
    activeAgentId
  ])

  // Set up keyboard shortcuts
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'n',
        modifiers: { meta: true },
        action: () => modalControls?.openNewMinionModal(),
        description: 'Open New Minion modal',
        enabled: () => !!modalControls
      },
      {
        key: 'n',
        modifiers: { meta: true, shift: true },
        action: () => modalControls?.openSuperMinionModal(),
        description: 'Open Super Minion modal',
        enabled: () => !!modalControls
      },
      {
        key: 'o',
        modifiers: { meta: true },
        action: () => modalControls?.openProjectPicker(),
        description: 'Open Project Picker',
        enabled: () => !!modalControls
      },
      {
        key: 't',
        modifiers: { meta: true },
        action: () => modalControls?.openTeleportModal(),
        description: 'Open Teleport modal',
        enabled: () => !!modalControls
      },
      {
        key: 'ArrowUp',
        modifiers: { meta: true },
        action: () => navigationControls?.navigateToPreviousMinion(),
        description: 'Navigate to previous minion',
        enabled: () => !!navigationControls?.canNavigatePrevious
      },
      {
        key: 'ArrowDown',
        modifiers: { meta: true },
        action: () => navigationControls?.navigateToNextMinion(),
        description: 'Navigate to next minion',
        enabled: () => !!navigationControls?.canNavigateNext
      },
      {
        key: 'Escape',
        action: () => {
          if (showHelpOverlay) {
            setShowHelpOverlay(false)
          } else if (modalControls?.isModalOpen) {
            modalControls.closeCurrentModal()
          }
        },
        description: 'Close dialog or help overlay',
        enabled: () => showHelpOverlay || !!modalControls?.isModalOpen
      },
      {
        key: '/',
        modifiers: { meta: true },
        action: () => toggleHelpOverlay(),
        description: 'Show keyboard shortcuts help'
      }
    ]
  })

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem('leftSidebarCollapsed')
    if (savedState !== null) {
      setIsLeftSidebarCollapsed(savedState === 'true')
    }
  }, [])

  // Handle navigation state (e.g., when redirected from wizard setup)
  useEffect(() => {
    const state = location.state as { targetAgent?: string } | null
    if (state?.targetAgent) {
      console.log('[MainLayout] Navigating to target agent from state:', state.targetAgent)
      // Small delay to let the agent list populate
      const timer = setTimeout(() => {
        navigate(`/workspace/agent/${state.targetAgent}`, { replace: true })
      }, 500)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [location.state, navigate])

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  const toggleLeftSidebar = () => {
    const newState = !isLeftSidebarCollapsed
    setIsLeftSidebarCollapsed(newState)
    localStorage.setItem('leftSidebarCollapsed', String(newState))
  }

  const handleAgentListChange = useCallback((agents: AgentInfo[]) => {
    setFlatAgentList(agents)
  }, [])

  return (
    <div className="main-layout">
      <Sidebar
        activeProjects={activeProjects}
        onNavigate={handleNavigate}
        onProjectRemove={onProjectRemove}
        onProjectAdd={onProjectAdd}
        isCollapsed={isLeftSidebarCollapsed}
        onToggleCollapse={toggleLeftSidebar}
        onAgentListChange={handleAgentListChange}
      />
      <div className="content-area">
        <Routes>
          <Route path="/" element={<Dashboard activeProjects={activeProjects} onRefresh={onRefresh} />} />
          <Route path="/agent/:agentId" element={<AgentView activeProjects={activeProjects} />} />
          <Route path="/super/:agentId" element={<SuperAgentView activeProjects={activeProjects} />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
      <KeyboardShortcutsHelp
        isOpen={showHelpOverlay}
        onClose={() => setShowHelpOverlay(false)}
      />
    </div>
  )
}

export default MainLayout
