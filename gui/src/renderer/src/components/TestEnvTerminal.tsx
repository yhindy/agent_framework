import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import './Terminal.css'
import { createStatefulFilter, DA_RESPONSE_INPUT, StatefulFilter } from '../utils/terminalOutputFilter'
import { setupShiftEnterHandler, getDroppedFilePaths } from '../utils/terminalUtils'

interface TestEnvTerminalProps {
  agentId: string
  commandId: string
  autoFocus?: boolean
  onMount?: () => void
}

// Configuration constants for terminal output limits
const TERMINAL_SCROLLBACK_LINES = 10000 // xterm.js scrollback buffer limit
const MAX_OUTPUT_CHUNKS = 10000 // Maximum number of chunks to keep in cache
const CONSOLIDATION_THRESHOLD = 1000 // Consolidate when cache exceeds this many chunks
const REPLAY_BATCH_SIZE = 100 // Number of chunks to batch together during replay

// Cache terminal OUTPUT per agent+command
const outputCache = new Map<string, string[]>()

// Per-terminal stateful filters to handle escape sequences split across chunks
const terminalFilters = new Map<string, StatefulFilter>()

// Track active terminals for live output
const activeTerminals = new Map<string, XTerm>()

// Helper function to consolidate many small chunks into fewer large ones
function consolidateCache(key: string) {
  const cache = outputCache.get(key)
  if (!cache || cache.length < CONSOLIDATION_THRESHOLD) return

  // Combine all chunks into a single chunk to reduce array operations
  const consolidated = cache.join('')
  cache.length = 0
  cache.push(consolidated)
}

// Helper function to trim cache when it exceeds limits
function trimCache(key: string) {
  const cache = outputCache.get(key)
  if (!cache || cache.length <= MAX_OUTPUT_CHUNKS) return

  // Remove oldest chunks, keeping only the most recent MAX_OUTPUT_CHUNKS
  const excessChunks = cache.length - MAX_OUTPUT_CHUNKS
  cache.splice(0, excessChunks)
}

// Global listener - set up once, captures ALL test env output
let globalListenerInitialized = false
function initGlobalOutputListener() {
  if (globalListenerInitialized) return
  globalListenerInitialized = true
  
  window.electronAPI.onTestEnvOutput((agentId, commandId, data) => {
    const key = `${agentId}:${commandId}`

    // Get or create stateful filter for this terminal
    let filter = terminalFilters.get(key)
    if (!filter) {
      filter = createStatefulFilter()
      terminalFilters.set(key, filter)
    }

    // Filter PTY query responses (DA1, DA2, OSC color) that appear as garbage
    const filteredData = filter.process(data)

    // Cache filtered output
    let cache = outputCache.get(key)
    if (!cache) {
      cache = []
      outputCache.set(key, cache)
    }
    if (filteredData) {
      cache.push(filteredData)
    }

    trimCache(key)
    if (cache.length >= CONSOLIDATION_THRESHOLD) {
      consolidateCache(key)
    }

    // If this terminal is currently active, write filtered data to it
    const terminal = activeTerminals.get(key)
    if (terminal && filteredData) {
      terminal.write(filteredData)
    }
  })
}

function TestEnvTerminal({ agentId, commandId, autoFocus, onMount }: TestEnvTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const key = `${agentId}:${commandId}`
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
        window.electronAPI.sendTestEnvInput(agentId, commandId, paths)
        // Focus the terminal after dropping
        terminalInstanceRef.current?.focus()
      }
    },
    [agentId, commandId]
  )

  useEffect(() => {
    // Initialize global listener on first mount
    initGlobalOutputListener()
    
    if (!terminalRef.current) return

    // Create a fresh terminal instance
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
      (data) => window.electronAPI.sendTestEnvInput(agentId, commandId, data),
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
      } catch (err) {
        // Ignore fit errors on disposed terminal
      }
      
      // Initialize output cache if needed
      if (!outputCache.has(key)) {
        outputCache.set(key, [])
      }

      // Replay cached output to restore terminal history (batched for performance)
      const cachedOutput = outputCache.get(key)!
      for (let i = 0; i < cachedOutput.length; i += REPLAY_BATCH_SIZE) {
        const batch = cachedOutput.slice(i, i + REPLAY_BATCH_SIZE).join('')
        terminal.write(batch)
      }

      // Scroll to bottom after replaying cached content
      terminal.scrollToBottom()

      // Register this as an active terminal for live output
      activeTerminals.set(key, terminal)

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
        window.electronAPI.sendTestEnvInput(agentId, commandId, data)
      })
      
      // Secondary fit after layout settles
      setTimeout(() => {
        if (isDisposed) return
        try {
          fitAddon.fit()
          if (terminal.rows && terminal.cols) {
            window.electronAPI.resizeTestEnv(agentId, commandId, terminal.cols, terminal.rows)
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
          window.electronAPI.resizeTestEnv(agentId, commandId, terminal.cols, terminal.rows)
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
          window.electronAPI.resizeTestEnv(agentId, commandId, terminal.cols, terminal.rows)
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
      // Unregister active terminal
      activeTerminals.delete(key)
      containerElement.removeEventListener('focus', handleFocus, true)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [agentId, commandId, key])

  return (
    <div
      ref={terminalRef}
      className={`terminal-container${isDragOver ? ' drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    />
  )
}

export default TestEnvTerminal
