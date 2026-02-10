import { useState } from 'react'
import ConfirmModal from './ConfirmModal'
import { useLoadingSnackbar } from '../hooks/useLoadingSnackbar'
import { cleanupAgentTerminalCache } from './Terminal'
import './AgentCleanupDropdown.css'

interface AgentCleanupDropdownProps {
  agentId: string
  agentName?: string
  onCleanupComplete?: () => void
  className?: string
}

const teardownMessages = [
  'Returning minion to the break room...',
  'Cleaning up banana peels from the workspace...',
  'Shredding incriminating documents...',
  'Wiping fingerprints from the keyboard...',
  'Returning stolen shrink rays...',
  'Escaping before Gru finds out...',
  'Restocking the vending machine...'
]

function AgentCleanupDropdown({
  agentId,
  agentName,
  onCleanupComplete,
  className = ''
}: AgentCleanupDropdownProps) {
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [showForceModal, setShowForceModal] = useState(false)
  const { showLoading, hideLoading } = useLoadingSnackbar()

  const displayName = agentName || agentId

  const handleCleanupClick = () => {
    setShowCleanupModal(true)
  }

  const handleConfirmCleanup = async () => {
    const snackbarId = showLoading({
      title: 'Archiving Mission...',
      messages: teardownMessages
    })
    try {
      setShowCleanupModal(false)
      await window.electronAPI.teardownAgent(agentId, false)
      cleanupAgentTerminalCache(agentId)
      hideLoading(snackbarId)
      onCleanupComplete?.()
    } catch (error: any) {
      hideLoading(snackbarId)

      // Check if error is due to uncommitted changes
      if (error.message.includes('uncommitted changes')) {
        setShowForceModal(true)
      } else {
        alert(`Error during cleanup: ${error.message}`)
      }
    }
  }

  const handleForceTeardown = async () => {
    const snackbarId = showLoading({
      title: 'Force Archiving Mission...',
      messages: teardownMessages
    })
    try {
      setShowForceModal(false)
      await window.electronAPI.teardownAgent(agentId, true)
      cleanupAgentTerminalCache(agentId)
      hideLoading(snackbarId)

      onCleanupComplete?.()
    } catch (error: any) {
      hideLoading(snackbarId)
      alert(`Error during force teardown: ${error.message}`)
    }
  }

  return (
    <>
      <button
        className={`cleanup-x-button ${className}`}
        onClick={handleCleanupClick}
        title="Remove agent"
        aria-label="Remove agent"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      <ConfirmModal
        isOpen={showCleanupModal}
        title="Remove Minion?"
        message={`This will remove ${displayName} and clean up its workspace. Any unsaved work may be lost. This action cannot be undone.`}
        confirmText="Remove"
        confirmVariant="danger"
        onConfirm={handleConfirmCleanup}
        onCancel={() => setShowCleanupModal(false)}
      />

      <ConfirmModal
        isOpen={showForceModal}
        title="Uncommitted Changes Detected"
        message={`${displayName} has uncommitted changes. Force teardown will permanently delete all uncommitted work. Are you sure you want to proceed?`}
        confirmText="Force Remove"
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={handleForceTeardown}
        onCancel={() => setShowForceModal(false)}
      />
    </>
  )
}

export default AgentCleanupDropdown
