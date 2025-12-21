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
  const [currentMessageIndex, setCurrentMessageIndex] = useState(() => 
    Math.floor(Math.random() * messages.length)
  )
  const [isFading, setIsFading] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    const interval = setInterval(() => {
      setIsFading(true)
      setTimeout(() => {
        setCurrentMessageIndex((prev) => {
          if (messages.length <= 1) return 0
          let nextIndex = prev
          while (nextIndex === prev) {
            nextIndex = Math.floor(Math.random() * messages.length)
          }
          return nextIndex
        })
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

