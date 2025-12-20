import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import './Terminal.css'

interface TestEnvTerminalProps {
  agentId: string
  commandId: string
}

// Cache terminal OUTPUT per agent+command
const outputCache = new Map<string, string[]>()

// Track active terminals for live output
const activeTerminals = new Map<string, XTerm>()

// Global listener - set up once, captures ALL test env output
let globalListenerInitialized = false
function initGlobalOutputListener() {
  if (globalListenerInitialized) return
  globalListenerInitialized = true
  
  window.electronAPI.onTestEnvOutput((agentId, commandId, data) => {
    const key = `${agentId}:${commandId}`
    
    // Always cache output
    if (!outputCache.has(key)) {
      outputCache.set(key, [])
    }
    outputCache.get(key)!.push(data)
    
    // If this terminal is currently active, write to it immediately
    const terminal = activeTerminals.get(key)
    if (terminal) {
      terminal.write(data)
    }
  })
}

function TestEnvTerminal({ agentId, commandId }: TestEnvTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const key = `${agentId}:${commandId}`

  useEffect(() => {
    // Initialize global listener on first mount
    initGlobalOutputListener()
    
    if (!terminalRef.current) return

    // Create a fresh terminal instance
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
    terminal.open(terminalRef.current)
    fitAddon.fit()

    // Initialize output cache if needed
    if (!outputCache.has(key)) {
      outputCache.set(key, [])
    }

    // Replay cached output to restore terminal history
    const cachedOutput = outputCache.get(key)!
    for (const chunk of cachedOutput) {
      terminal.write(chunk)
    }

    // Register this as an active terminal for live output
    activeTerminals.set(key, terminal)

    // Handle terminal input
    terminal.onData((data) => {
      window.electronAPI.sendTestEnvInput(agentId, commandId, data)
    })

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit()
      if (terminal.rows && terminal.cols) {
        window.electronAPI.resizeTestEnv(agentId, commandId, terminal.cols, terminal.rows)
      }
    }

    window.addEventListener('resize', handleResize)
    
    // Initial fit
    setTimeout(() => {
      fitAddon.fit()
      if (terminal.rows && terminal.cols) {
        window.electronAPI.resizeTestEnv(agentId, commandId, terminal.cols, terminal.rows)
      }
    }, 100)

    return () => {
      // Unregister active terminal
      activeTerminals.delete(key)
      window.removeEventListener('resize', handleResize)
      terminal.dispose()
    }
  }, [agentId, commandId, key])

  return <div ref={terminalRef} className="terminal-container" />
}

export default TestEnvTerminal

