import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import './Terminal.css'

interface TerminalProps {
  agentId: string
}

// Cache terminal OUTPUT (not XTerm instances - they can't be re-attached to DOM)
const outputCache = new Map<string, string[]>()

// Track the currently active terminal for live output
let activeTerminal: { agentId: string; terminal: XTerm } | null = null

// Global listener - set up once, captures ALL output for ALL agents
let globalListenerInitialized = false
function initGlobalOutputListener() {
  if (globalListenerInitialized) return
  globalListenerInitialized = true
  
  window.electronAPI.onTerminalOutput((id, data) => {
    // Always cache output for every agent
    if (!outputCache.has(id)) {
      outputCache.set(id, [])
    }
    outputCache.get(id)!.push(data)
    
    // If this agent's terminal is currently active, write to it immediately
    if (activeTerminal && activeTerminal.agentId === id) {
      activeTerminal.terminal.write(data)
    }
  })
}

function Terminal({ agentId }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Initialize global listener on first mount
    initGlobalOutputListener()
    
    if (!terminalRef.current) return

    // Always create a fresh terminal (XTerm can't be re-attached to a new DOM element)
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
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
      } catch (err) {
        // Ignore fit errors on disposed terminal
      }
      
      // Initialize output cache for this agent if needed
      if (!outputCache.has(agentId)) {
        outputCache.set(agentId, [])
      }

      // Replay cached output to restore terminal history
      const cachedOutput = outputCache.get(agentId)!
      for (const chunk of cachedOutput) {
        terminal.write(chunk)
      }

      // Scroll to bottom after replaying cached content
      terminal.scrollToBottom()

      // Register this as the active terminal for live output
      activeTerminal = { agentId, terminal }
      
      // Handle terminal input (must be after open)
      terminal.onData((data) => {
        window.electronAPI.sendTerminalInput(agentId, data)
      })
      
      // Secondary fit after layout settles
      setTimeout(() => {
        if (isDisposed) return
        try {
          fitAddon.fit()
          if (terminal.rows && terminal.cols) {
            window.electronAPI.resizeTerminal(agentId, terminal.cols, terminal.rows)
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
          window.electronAPI.resizeTerminal(agentId, terminal.cols, terminal.rows)
        }
      } catch (err) {
        // Ignore resize errors on disposed terminal
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      isDisposed = true
      
      // Cancel pending animation frame (prevents open() from running on disposed terminal)
      cancelAnimationFrame(rafId)
      
      // Clear active terminal if it's this one
      if (activeTerminal && activeTerminal.agentId === agentId) {
        activeTerminal = null
      }
      containerElement.removeEventListener('focus', handleFocus, true)
      window.removeEventListener('resize', handleResize)
      terminal.dispose()
    }
  }, [agentId])

  return <div ref={terminalRef} className="terminal-container" />
}

export default Terminal
