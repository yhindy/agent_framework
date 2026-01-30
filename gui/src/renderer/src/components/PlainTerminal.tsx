import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import './Terminal.css'
import { createStatefulFilter, DA_RESPONSE_INPUT, StatefulFilter } from '../utils/terminalOutputFilter'
import { setupShiftEnterHandler, getDroppedFilePaths } from '../utils/terminalUtils'

interface PlainTerminalProps {
  agentId: string
  terminalId: string
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

// Per-terminal stateful filters to handle escape sequences split across chunks
const terminalFilters = new Map<string, StatefulFilter>()

// Track the currently active terminal for live output
let activeTerminal: { terminalId: string; terminal: XTerm } | null = null

// Helper function to consolidate many small chunks into fewer large ones
function consolidateCache(terminalId: string) {
  const cache = outputCache.get(terminalId)
  if (!cache || cache.length < CONSOLIDATION_THRESHOLD) return

  // Combine all chunks into a single chunk to reduce array operations
  const consolidated = cache.join('')
  cache.length = 0
  cache.push(consolidated)
}

// Helper function to trim cache when it exceeds limits
function trimCache(terminalId: string) {
  const cache = outputCache.get(terminalId)
  if (!cache || cache.length <= MAX_OUTPUT_CHUNKS) return

  // Remove oldest chunks, keeping only the most recent MAX_OUTPUT_CHUNKS
  const excessChunks = cache.length - MAX_OUTPUT_CHUNKS
  cache.splice(0, excessChunks)
}

// Global listener - set up once, captures ALL output for ALL terminals
let globalListenerInitialized = false
function initGlobalOutputListener() {
  if (globalListenerInitialized) return
  globalListenerInitialized = true
  
  window.electronAPI.onPlainTerminalOutput((terminalId, data) => {
    // Get or create stateful filter for this terminal
    let filter = terminalFilters.get(terminalId)
    if (!filter) {
      filter = createStatefulFilter()
      terminalFilters.set(terminalId, filter)
    }

    // Filter PTY query responses (DA1, DA2, OSC color) that appear as garbage
    const filteredData = filter.process(data)

    // Cache filtered output for every terminal
    let cache = outputCache.get(terminalId)
    if (!cache) {
      cache = []
      outputCache.set(terminalId, cache)
    }
    if (filteredData) {
      cache.push(filteredData)
    }

    trimCache(terminalId)
    if (cache.length >= CONSOLIDATION_THRESHOLD) {
      consolidateCache(terminalId)
    }

    // If this terminal is currently active, write filtered data to it
    if (activeTerminal && activeTerminal.terminalId === terminalId && filteredData) {
      activeTerminal.terminal.write(filteredData)
    }
  })
}

function PlainTerminal({ agentId, terminalId, autoFocus, onMount }: PlainTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const fullTerminalId = `${agentId}-${terminalId}`
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const terminalInstanceRef = useRef<XTerm | null>(null)

  // Drag and drop handlers for file path insertion
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer?.types.includes('Files')) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragOver(false)

      const paths = getDroppedFilePaths(e.nativeEvent)
      if (paths) {
        window.electronAPI.sendPlainTerminalInput(fullTerminalId, paths)
        // Focus the terminal after dropping
        terminalInstanceRef.current?.focus()
      }
    },
    [fullTerminalId]
  )

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
    const isDisposedRef = { current: false }

    // Store terminal instance for drop handler access
    terminalInstanceRef.current = terminal

    // Set up Shift+Enter handler for literal newline insertion
    setupShiftEnterHandler(
      terminal,
      (data) => window.electronAPI.sendPlainTerminalInput(fullTerminalId, data),
      isDisposedRef
    )

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

      // Replay cached output to restore terminal history (batched for performance)
      const cachedOutput = outputCache.get(fullTerminalId)!
      for (let i = 0; i < cachedOutput.length; i += REPLAY_BATCH_SIZE) {
        const batch = cachedOutput.slice(i, i + REPLAY_BATCH_SIZE).join('')
        terminal.write(batch)
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

      // Filter out focus reporting and DA responses that confuse the PTY
      terminal.onData((data) => {
        if (data === '\x1b[I' || data === '\x1b[O') return
        if (DA_RESPONSE_INPUT.test(data)) return
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
      isDisposedRef.current = true
      terminalInstanceRef.current = null

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
      className={`terminal-container${isDragOver ? ' drag-over' : ''}`}
      onClick={() => {
        activeTerminal?.terminal.focus()
        activeTerminal?.terminal.scrollToBottom()
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    />
  )
}

export default PlainTerminal
