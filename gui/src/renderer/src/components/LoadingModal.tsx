import { useState, useEffect } from 'react'
import './LoadingModal.css'

interface LoadingModalProps {
  isOpen: boolean
  title?: string
  messages: string[]
  rotationInterval?: number
}

function LoadingModal({
  isOpen,
  title = 'Creating Mission...',
  messages,
  rotationInterval = 3000
}: LoadingModalProps) {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0)
  const [isFading, setIsFading] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const interval = setInterval(() => {
      setIsFading(true)
      setTimeout(() => {
        setCurrentMessageIndex((prev) => (prev + 1) % messages.length)
        setIsFading(false)
      }, 500) // Half a second for fade out
    }, rotationInterval)

    return () => clearInterval(interval)
  }, [isOpen, messages.length, rotationInterval])

  if (!isOpen) return null

  return (
    <div className="loading-modal-overlay">
      <div className="loading-modal-content">
        <div className="loading-modal-header">
          <h2>{title}</h2>
        </div>
        <div className="loading-modal-body">
          <div className="progress-bar-container">
            <div className="progress-bar-indeterminate"></div>
          </div>
          <p className={`loading-message ${isFading ? 'fade-out' : 'fade-in'}`}>
            {messages[currentMessageIndex]}
          </p>
        </div>
      </div>
    </div>
  )
}

export default LoadingModal

