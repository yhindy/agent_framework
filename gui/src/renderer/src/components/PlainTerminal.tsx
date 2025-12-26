import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import './Terminal.css'

interface PlainTerminalProps {
  agentId: string
  terminalId: string
  autoFocus?: boolean
  onMount?: () => void
}

// Cache terminal OUTPUT (not XTerm instances - they can't be re-attached to DOM)
const outputCache = new Map<string, string[]>()

// Track the currently active terminal for live output
let activeTerminal: { terminalId: string; terminal: XTerm } | null = null

// Global listener - set up once, captures ALL output for ALL terminals
let globalListenerInitialized = false
function initGlobalOutputListener() {
  if (globalListenerInitialized) return
  globalListenerInitialized = true
  
  window.electronAPI.onPlainTerminalOutput((terminalId, data) => {
    // Always cache output for every terminal
    if (!outputCache.has(terminalId)) {
      outputCache.set(terminalId, [])
    }
    outputCache.get(terminalId)!.push(data)
    
    // If this terminal is currently active, write to it immediately
    if (activeTerminal && activeTerminal.terminalId === terminalId) {
      activeTerminal.terminal.write(data)
    }
  })
}

function PlainTerminal({ agentId, terminalId, autoFocus, onMount }: PlainTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const fullTerminalId = `${agentId}-${terminalId}`

  useEffect(() => {
    // Initialize global listener on first mount
    initGlobalOutputListener()
    
    if (!terminalRef.current) return

    // Start the plain terminal on the backend
    window.electronAPI.startPlainTerminal(agentId, terminalId)

    // Always create a fresh terminal (XTerm can't be re-attached to a new DOM element)
    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline', // Show outline cursor when unfocused so it's always visible
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#000000', // Text color inside block cursor for contrast
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      }
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    
    // Track if we've been disposed (must be declared before async operations)
    let isDisposed = false
    
    // Store the container element reference for use in RAF callback
    const containerElement = terminalRef.current
    
    // Defer terminal.open() to next frame to prevent React StrictMode issues
    // StrictMode unmounts immediately after mount, and xterm's internal async operations
    // from open() would fire on a disposed terminal causing "dimensions" errors
    const rafId = requestAnimationFrame(() => {
      if (isDisposed) return
      
      terminal.open(containerElement)
      
      try {
        fitAddon.fit()
        terminal.focus()
      } catch (err) {
        // Ignore fit errors on disposed terminal
      }
      
      // Initialize output cache for this terminal if needed
      if (!outputCache.has(fullTerminalId)) {
        outputCache.set(fullTerminalId, [])
      }

      // Replay cached output to restore terminal history
      const cachedOutput = outputCache.get(fullTerminalId)!
      for (const chunk of cachedOutput) {
        terminal.write(chunk)
      }

      // Scroll to bottom after replaying cached content
      terminal.scrollToBottom()

      // Register this as the active terminal for live output
      activeTerminal = { terminalId: fullTerminalId, terminal }

      // Auto-focus if requested (for restoring focus after navigation)
      if (autoFocus) {
        setTimeout(() => {
          if (!isDisposed) {
            terminal.focus()
            terminal.scrollToBottom()
          }
        }, 100)
      }

      // Call mount callback if provided
      if (onMount) {
        onMount()
      }

      // Handle terminal input (must be after open)
      terminal.onData((data) => {
        // Filter out focus reporting sequences that xterm.js sends but shouldn't go to PTY
        // \x1b[I = Focus In, \x1b[O = Focus Out (CSI I and CSI O)
        // These sequences confuse applications like vim and claude code
        if (data === '\x1b[I' || data === '\x1b[O') {
          return // Don't send focus sequences to PTY
        }
        
        window.electronAPI.sendPlainTerminalInput(fullTerminalId, data)
      })
      
      // Secondary fit after layout settles
      setTimeout(() => {
        if (isDisposed) return
        try {
          fitAddon.fit()
          if (terminal.rows && terminal.cols) {
            window.electronAPI.resizePlainTerminal(fullTerminalId, terminal.cols, terminal.rows)
          }
        } catch (err) {
          // Ignore fit errors on disposed terminal
        }
      }, 100)
    })

    // Handle focus to scroll to bottom
    const handleFocus = () => {
      terminal.scrollToBottom()
    }
    containerElement.addEventListener('focus', handleFocus, true)

    // Handle window resize
    const handleResize = () => {
      if (isDisposed) return
      try {
        fitAddon.fit()
        if (terminal.rows && terminal.cols) {
          window.electronAPI.resizePlainTerminal(fullTerminalId, terminal.cols, terminal.rows)
        }
      } catch (err) {
        // Ignore resize errors on disposed terminal
      }
    }

    window.addEventListener('resize', handleResize)

    // Handle container resize (when parent elements expand/collapse)
    const resizeObserver = new ResizeObserver(() => {
      if (isDisposed) return
      try {
        fitAddon.fit()
        if (terminal.rows && terminal.cols) {
          window.electronAPI.resizePlainTerminal(fullTerminalId, terminal.cols, terminal.rows)
        }
        // Auto-scroll to bottom after resize so user sees latest output
        terminal.scrollToBottom()
      } catch (err) {
        // Ignore resize errors on disposed terminal
      }
    })

    resizeObserver.observe(containerElement)

    return () => {
      isDisposed = true

      // Cancel pending animation frame (prevents open() from running on disposed terminal)
      cancelAnimationFrame(rafId)

      // Clear active terminal if it's this one
      if (activeTerminal && activeTerminal.terminalId === fullTerminalId) {
        activeTerminal = null
      }
      containerElement.removeEventListener('focus', handleFocus, true)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      terminal.dispose()
      // Note: We don't stop the backend terminal here to preserve the session
    }
  }, [agentId, terminalId, fullTerminalId])

  return (
    <div
      ref={terminalRef}
      className="terminal-container"
      onClick={() => {
        activeTerminal?.terminal.focus()
        activeTerminal?.terminal.scrollToBottom()
      }}
    />
  )
}

export default PlainTerminal
