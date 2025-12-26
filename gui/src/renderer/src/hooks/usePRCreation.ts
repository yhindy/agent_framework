import { useState } from 'react'

export const usePRCreation = () => {
  const [showPRConfirm, setShowPRConfirm] = useState(false)
  const [autoCommit, setAutoCommit] = useState(true)
  const [isCreatingPR, setIsCreatingPR] = useState(false)

  const prMessages = [
    'Stuffing code into a rocket...',
    'Learning to speak Human for the PR description...',
    'Bribing the CI/CD pipeline with bananas...',
    'Checking for accidentally committed secret cookie recipes...',
    'Pushing code to the moon...',
    'Summoning the code review council (Kevin, Stuart, and Bob)...',
    'Crossing fingers and toes...'
  ]

  const handleCreatePRClick = () => {
    setAutoCommit(true)
    setShowPRConfirm(true)
  }

  const handleConfirmCreatePR = async (agentId: string, onSuccess: () => void) => {
    try {
      setIsCreatingPR(true)
      setShowPRConfirm(false)

      console.log('[usePRCreation] Creating PR for:', agentId, 'autoCommit:', autoCommit)
      const result = await window.electronAPI.createPullRequest(agentId, autoCommit)

      // Show success with link
      alert(`Pull Request created successfully!\n\n${result.url}\n\nOpening in browser...`)
      window.open(result.url, '_blank')

      // Call the callback to reload data
      onSuccess()
    } catch (error: any) {
      alert(`Failed to create PR: ${error.message}`)
    } finally {
      setIsCreatingPR(false)
    }
  }

  return {
    showPRConfirm,
    setShowPRConfirm,
    autoCommit,
    setAutoCommit,
    isCreatingPR,
    prMessages,
    handleCreatePRClick,
    handleConfirmCreatePR
  }
}
