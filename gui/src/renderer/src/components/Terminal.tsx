import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import './Terminal.css'
import { createStatefulFilter, StatefulFilter } from '../utils/terminalOutputFilter'
import { setupShiftEnterHandler, getDroppedFilePaths } from '../utils/terminalUtils'

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

// Per-agent stateful filters to handle escape sequences split across chunks
const agentFilters = new Map<string, StatefulFilter>()

// Track the currently active terminal for live output
let activeTerminal: { agentId: string; terminal: XTerm } | null = null

/**
 * Clean up cached data for a specific agent.
 * Call this when an agent is deleted to prevent memory leaks.
 */
export function cleanupAgentTerminalCache(agentId: string): void {
  outputCache.delete(agentId)
  agentFilters.delete(agentId)
}

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
export function initGlobalOutputListener() {
  if (globalListenerInitialized) return
  globalListenerInitialized = true

  window.electronAPI.onTerminalOutput((id, data) => {
    // Get or create stateful filter for this agent
    let filter = agentFilters.get(id)
    if (!filter) {
      filter = createStatefulFilter()
      agentFilters.set(id, filter)
    }

    // Filter PTY query responses before caching (they appear as garbage on replay)
    const filteredData = filter.process(data)

    // Cache filtered output for every agent
    let cache = outputCache.get(id)
    if (!cache) {
      cache = []
      outputCache.set(id, cache)
    }
    if (filteredData) {
      cache.push(filteredData)
    }

    trimCache(id)
    if (cache.length >= CONSOLIDATION_THRESHOLD) {
      consolidateCache(id)
    }

    // Write original data to active terminal (xterm.js processes query responses live)
    if (activeTerminal && activeTerminal.agentId === id) {
      activeTerminal.terminal.write(data)
    }
  })
}

function Terminal({ agentId, autoFocus, onMount }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
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
        window.electronAPI.sendTerminalInput(agentId, paths)
        // Focus the terminal after dropping
        terminalInstanceRef.current?.focus()
      }
    },
    [agentId]
  )

  useEffect(() => {
    initGlobalOutputListener()
    if (!terminalRef.current) return

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

    let isDisposed = false
    const isDisposedRef = { current: false }

    // Store terminal instance for drop handler access
    terminalInstanceRef.current = terminal

    // Set up Shift+Enter handler for literal newline insertion
    setupShiftEnterHandler(
      terminal,
      (data) => window.electronAPI.sendTerminalInput(agentId, data),
      isDisposedRef
    )

    // Store the container element reference for use in RAF callback
    const containerElement = terminalRef.current

    // Helper to fit terminal and notify main process of size change
    function fitAndResize(): void {
      if (isDisposed) return
      try {
        fitAddon.fit()
        if (terminal.rows && terminal.cols) {
          window.electronAPI.resizeTerminal(agentId, terminal.cols, terminal.rows)
        }
      } catch {
        // Ignore errors on disposed terminal
      }
    }

    // Defer open() to next frame to prevent React StrictMode double-mount issues
    const rafId = requestAnimationFrame(() => {
      if (isDisposed) return

      terminal.open(containerElement)
      fitAndResize()

      // Initialize cache if needed and replay cached output to restore terminal history
      const cachedOutput = outputCache.get(agentId) || []
      if (!outputCache.has(agentId)) {
        outputCache.set(agentId, cachedOutput)
      }

      for (let i = 0; i < cachedOutput.length; i += REPLAY_BATCH_SIZE) {
        terminal.write(cachedOutput.slice(i, i + REPLAY_BATCH_SIZE).join(''))
      }

      // If cache is empty when attaching to an existing tmux session, request a refresh.
      // This sends Ctrl+L to trigger tmux to redraw the screen content.
      if (cachedOutput.length === 0) {
        setTimeout(() => {
          window.electronAPI.refreshTerminal(agentId).catch(() => {
            // Ignore refresh errors if the agent is not yet running
          })
        }, 100)
      }

      terminal.scrollToBottom()
      activeTerminal = { agentId, terminal }

      if (autoFocus) {
        setTimeout(() => {
          if (!isDisposed) {
            terminal.focus()
            terminal.scrollToBottom()
          }
        }, 100)
      }

      onMount?.()

      // Filter out focus reporting sequences that confuse vim and claude code
      terminal.onData((data) => {
        if (data === '\x1b[I' || data === '\x1b[O') return
        window.electronAPI.sendTerminalInput(agentId, data)
      })

      // Secondary fit after layout settles
      setTimeout(fitAndResize, 100)
    })

    const handleFocus = () => terminal.scrollToBottom()
    containerElement.addEventListener('focus', handleFocus, true)

    const handleResize = () => fitAndResize()
    window.addEventListener('resize', handleResize)

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize()
      if (!isDisposed) terminal.scrollToBottom()
    })
    resizeObserver.observe(containerElement)

    return () => {
      isDisposed = true
      isDisposedRef.current = true
      terminalInstanceRef.current = null

      // Cancel pending animation frame (prevents open() from running on disposed terminal)
      cancelAnimationFrame(rafId)
      if (activeTerminal?.agentId === agentId) {
        activeTerminal = null
      }
      containerElement.removeEventListener('focus', handleFocus, true)
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [agentId])

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

export default Terminal
