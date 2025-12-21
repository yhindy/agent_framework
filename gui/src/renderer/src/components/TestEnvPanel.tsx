import { useState, useEffect } from 'react'
import TestEnvTerminal from './TestEnvTerminal'
import './TestEnvPanel.css'

interface TestEnvPanelProps {
  agentId: string
}

interface TestEnvCommand {
  id: string
  name: string
  command: string
  cwd?: string
  port?: number
}

interface ProcessStatus {
  commandId: string
  name: string
  isRunning: boolean
}

function TestEnvPanel({ agentId }: TestEnvPanelProps) {
  const [commands, setCommands] = useState<TestEnvCommand[]>([])
  const [activeTab, setActiveTab] = useState<string>('')
  const [processStatuses, setProcessStatuses] = useState<ProcessStatus[]>([])
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    loadCommands()
    loadStatus()

    // Listen for process lifecycle events
    const unsubscribeStarted = window.electronAPI.onTestEnvStarted((id, commandId) => {
      if (id === agentId) {
        loadStatus()
      }
    })

    const unsubscribeStopped = window.electronAPI.onTestEnvStopped((id, commandId) => {
      if (id === agentId) {
        loadStatus()
      }
    })

    const unsubscribeExited = window.electronAPI.onTestEnvExited((id, commandId, exitCode) => {
      if (id === agentId) {
        console.log(`Test env process ${commandId} exited with code ${exitCode}`)
        loadStatus()
      }
    })

    return () => {
      unsubscribeStarted()
      unsubscribeStopped()
      unsubscribeExited()
    }
  }, [agentId])

  const loadCommands = async () => {
    try {
      console.log('[TestEnvPanel] Loading test env config...')
      const config = await window.electronAPI.getTestEnvConfig()
      console.log('[TestEnvPanel] Received config:', config)
      const cmds = config.defaultCommands || []
      console.log('[TestEnvPanel] Commands:', cmds)
      setCommands(cmds)
      
      // Set initial active tab
      if (cmds.length > 0 && !activeTab) {
        setActiveTab(cmds[0].id)
      }
    } catch (error) {
      console.error('[TestEnvPanel] Error loading test env config:', error)
    }
  }

  const loadStatus = async () => {
    try {
      const statuses = await window.electronAPI.getTestEnvStatus(agentId)
      setProcessStatuses(statuses)
    } catch (error) {
      console.error('Error loading test env status:', error)
    }
  }

  const handleStartAll = async () => {
    try {
      setIsStarting(true)
      await window.electronAPI.startTestEnv(agentId)
      await loadStatus()
    } catch (error: any) {
      alert('Error starting test environment: ' + error.message)
    } finally {
      setIsStarting(false)
    }
  }

  const handleStopAll = async () => {
    try {
      await window.electronAPI.stopTestEnv(agentId)
      await loadStatus()
    } catch (error: any) {
      alert('Error stopping test environment: ' + error.message)
    }
  }

  const handleStartCommand = async (commandId: string) => {
    try {
      await window.electronAPI.startTestEnv(agentId, commandId)
      await loadStatus()
    } catch (error: any) {
      alert('Error starting command: ' + error.message)
    }
  }

  const handleStopCommand = async (commandId: string) => {
    try {
      await window.electronAPI.stopTestEnv(agentId, commandId)
      await loadStatus()
    } catch (error: any) {
      alert('Error stopping command: ' + error.message)
    }
  }

  const getCommandStatus = (commandId: string): boolean => {
    const status = processStatuses.find(s => s.commandId === commandId)
    return status?.isRunning || false
  }

  const hasRunningProcesses = processStatuses.some(s => s.isRunning)

  if (commands.length === 0) {
    return (
      <div className="test-env-panel">
        <div className="test-env-empty">
          <p>No test environment commands configured.</p>
          <p>Create a <code>test-env.config.json</code> file in <code>minions/</code> to define commands.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="test-env-panel">
      <div className="test-env-header">
        <h3>Test Environment</h3>
        <div className="test-env-controls">
          <button 
            onClick={handleStartAll} 
            disabled={isStarting || hasRunningProcesses}
            className="start-btn"
          >
            {isStarting ? 'Starting...' : 'Start All'}
          </button>
          <button 
            onClick={handleStopAll} 
            disabled={!hasRunningProcesses}
            className="stop-btn"
          >
            Stop All
          </button>
        </div>
      </div>

      <div className="test-env-tabs">
        {commands.map(cmd => {
          const isRunning = getCommandStatus(cmd.id)
          return (
            <div
              key={cmd.id}
              className={`test-env-tab ${activeTab === cmd.id ? 'active' : ''}`}
              onClick={() => setActiveTab(cmd.id)}
            >
              <span className={`status-dot ${isRunning ? 'running' : 'stopped'}`} />
              <span className="tab-name">{cmd.name}</span>
              {cmd.port && <span className="tab-port">:{cmd.port}</span>}
              {isRunning ? (
                <button 
                  className="tab-action stop"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStopCommand(cmd.id)
                  }}
                >
                  ⬛
                </button>
              ) : (
                <button 
                  className="tab-action start"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStartCommand(cmd.id)
                  }}
                >
                  ▶
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="test-env-terminal">
        {activeTab && <TestEnvTerminal agentId={agentId} commandId={activeTab} />}
      </div>
    </div>
  )
}

export default TestEnvPanel

