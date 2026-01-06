import { useState, useEffect } from 'react'
import './LoadingSnackbar.css'

interface LoadingSnackbarProps {
  title?: string
  messages: string[]
  rotationInterval?: number
}

function LoadingSnackbar({
  title = 'Loading...',
  messages,
  rotationInterval = 3000
}: LoadingSnackbarProps) {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(() =>
    Math.floor(Math.random() * messages.length)
  )
  const [isFading, setIsFading] = useState(false)

  useEffect(() => {
    if (messages.length <= 1) return

    const interval = setInterval(() => {
      setIsFading(true)
      setTimeout(() => {
        setCurrentMessageIndex((prev) => {
          let nextIndex = prev
          while (nextIndex === prev) {
            nextIndex = Math.floor(Math.random() * messages.length)
          }
          return nextIndex
        })
        setIsFading(false)
      }, 500)
    }, rotationInterval)

    return () => clearInterval(interval)
  }, [messages.length, rotationInterval])

  return (
    <div className="loading-snackbar" role="status" aria-live="polite">
      <div
        className="snackbar-progress-bar-container"
        role="progressbar"
        aria-label="Loading progress"
      >
        <div className="snackbar-progress-bar-indeterminate"></div>
      </div>
      <div className="snackbar-content">
        <span className="snackbar-title">{title}</span>
        <span className={`snackbar-message ${isFading ? 'fade-out' : 'fade-in'}`}>
          {messages[currentMessageIndex]}
        </span>
      </div>
    </div>
  )
}

export default LoadingSnackbar
