import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import './Terminal.css'
import { filterTerminalQueryResponses } from '../utils/terminalOutputFilter'

interface TerminalProps {
  agentId: string
  autoFocus?: boolean
  onMount?: () => void
}

// Configuration constants for terminal output limits
const TERMINAL_SCROLLBACK_LINES = 10000 // xterm.js scrollback buffer limit
const MAX_OUTPUT_CHUNKS = 10000 // Maximum number of chunks to keep in cache
const CONSOLIDATION_THRESHOLD = 1000 // Consolidate when cache exceeds this many chunks
const REPLAY_BATCH_SIZE = 100 // Number of chunks to batch together during replay

// Cache terminal OUTPUT (not XTerm instances - they can't be re-attached to DOM)
const outputCache = new Map<string, string[]>()

// Track the currently active terminal for live output
let activeTerminal: { agentId: string; terminal: XTerm } | null = null

// Helper function to consolidate many small chunks into fewer large ones
function consolidateCache(agentId: string) {
  const cache = outputCache.get(agentId)
  if (!cache || cache.length < CONSOLIDATION_THRESHOLD) return

  // Combine all chunks into a single chunk to reduce array operations
  const consolidated = cache.join('')
  cache.length = 0
  cache.push(consolidated)
}

// Helper function to trim cache when it exceeds limits
function trimCache(agentId: string) {
  const cache = outputCache.get(agentId)
  if (!cache || cache.length <= MAX_OUTPUT_CHUNKS) return

  // Remove oldest chunks, keeping only the most recent MAX_OUTPUT_CHUNKS
  const excessChunks = cache.length - MAX_OUTPUT_CHUNKS
  cache.splice(0, excessChunks)
}

// Global listener - set up once, captures ALL output for ALL agents
let globalListenerInitialized = false
function initGlobalOutputListener() {
  if (globalListenerInitialized) return
  globalListenerInitialized = true
  
  window.electronAPI.onTerminalOutput((id, data) => {
    // Filter terminal query responses before caching to prevent garbage on replay.
    // These are PTY responses (DA1, DA2, OSC color) that xterm.js processes live
    // but appear as visible text when replayed from cache.
    const filteredData = filterTerminalQueryResponses(data)

    // Always cache filtered output for every agent
    if (!outputCache.has(id)) {
      outputCache.set(id, [])
    }
    if (filteredData) {
      outputCache.get(id)!.push(filteredData)
    }

    // Trim cache if it exceeds limits
    trimCache(id)

    // Periodically consolidate chunks to prevent array fragmentation
    const cache = outputCache.get(id)!
    if (cache.length >= CONSOLIDATION_THRESHOLD) {
      consolidateCache(id)
    }

    // If this agent's terminal is currently active, write to it immediately
    // Use original data for live display so xterm.js can process query responses
    if (activeTerminal && activeTerminal.agentId === id) {
      activeTerminal.terminal.write(data)
    }
  })
}

function Terminal({ agentId, autoFocus, onMount }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Initialize global listener on first mount
    initGlobalOutputListener()
    
    if (!terminalRef.current) return

    // Always create a fresh terminal (XTerm can't be re-attached to a new DOM element)
    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline', // Show outline cursor when unfocused so it's always visible
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: TERMINAL_SCROLLBACK_LINES, // Limit scrollback buffer to prevent memory issues
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
      } catch (err) {
        // Ignore fit errors on disposed terminal
      }
      
      // Initialize output cache for this agent if needed
      if (!outputCache.has(agentId)) {
        outputCache.set(agentId, [])
      }

      // Replay cached output to restore terminal history (batched for performance)
      const cachedOutput = outputCache.get(agentId)!
      for (let i = 0; i < cachedOutput.length; i += REPLAY_BATCH_SIZE) {
        const batch = cachedOutput.slice(i, i + REPLAY_BATCH_SIZE).join('')
        terminal.write(batch)
      }

      // Scroll to bottom after replaying cached content
      terminal.scrollToBottom()

      // Register this as the active terminal for live output
      activeTerminal = { agentId, terminal }

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

    // Handle container resize (when parent elements expand/collapse)
    const resizeObserver = new ResizeObserver(() => {
      if (isDisposed) return
      try {
        fitAddon.fit()
        if (terminal.rows && terminal.cols) {
          window.electronAPI.resizeTerminal(agentId, terminal.cols, terminal.rows)
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
      if (activeTerminal && activeTerminal.agentId === agentId) {
        activeTerminal = null
      }
      containerElement.removeEventListener('focus', handleFocus, true)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [agentId])

  return <div ref={terminalRef} className="terminal-container" />
}

export default Terminal
