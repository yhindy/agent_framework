import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

export interface ModalControls {
  openNewMinionModal: () => void
  openSuperMinionModal: () => void
  openTeleportModal: () => void
  openProjectPicker: () => void
  closeCurrentModal: () => void
  isModalOpen: boolean
}

export interface NavigationControls {
  navigateToPreviousMinion: () => void
  navigateToNextMinion: () => void
  canNavigatePrevious: boolean
  canNavigateNext: boolean
}

interface KeyboardShortcutsContextType {
  registerModalControls: (controls: ModalControls) => void
  unregisterModalControls: () => void
  modalControls: ModalControls | null
  registerNavigationControls: (controls: NavigationControls) => void
  unregisterNavigationControls: () => void
  navigationControls: NavigationControls | null
  showHelpOverlay: boolean
  setShowHelpOverlay: (show: boolean) => void
  toggleHelpOverlay: () => void
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextType | null>(null)

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const [modalControls, setModalControls] = useState<ModalControls | null>(null)
  const [navigationControls, setNavigationControls] = useState<NavigationControls | null>(null)
  const [showHelpOverlay, setShowHelpOverlay] = useState(false)

  const registerModalControls = useCallback((controls: ModalControls) => {
    setModalControls(controls)
  }, [])

  const unregisterModalControls = useCallback(() => {
    setModalControls(null)
  }, [])

  const registerNavigationControls = useCallback((controls: NavigationControls) => {
    setNavigationControls(controls)
  }, [])

  const unregisterNavigationControls = useCallback(() => {
    setNavigationControls(null)
  }, [])

  const toggleHelpOverlay = useCallback(() => {
    setShowHelpOverlay((prev) => !prev)
  }, [])

  return (
    <KeyboardShortcutsContext.Provider
      value={{
        registerModalControls,
        unregisterModalControls,
        modalControls,
        registerNavigationControls,
        unregisterNavigationControls,
        navigationControls,
        showHelpOverlay,
        setShowHelpOverlay,
        toggleHelpOverlay
      }}
    >
      {children}
    </KeyboardShortcutsContext.Provider>
  )
}

export function useKeyboardShortcutsContext(): KeyboardShortcutsContextType {
  const context = useContext(KeyboardShortcutsContext)
  if (!context) {
    throw new Error('useKeyboardShortcutsContext must be used within KeyboardShortcutsProvider')
  }
  return context
}
