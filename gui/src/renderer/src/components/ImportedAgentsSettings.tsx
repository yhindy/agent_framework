import { useState, useEffect, useCallback } from 'react'
import type {
  ClaudeConfigScanResult,
  ClaudeConfigSettings
} from '../../../main/services/types/ClaudeConfigTypes'
import './ImportedAgentsSettings.css'

function ImportedAgentsSettings(): JSX.Element {
  const [scanResult, setScanResult] = useState<ClaudeConfigScanResult | null>(null)
  const [settings, setSettings] = useState<ClaudeConfigSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    try {
      const [result, currentSettings] = await Promise.all([
        window.electronAPI.getClaudeConfigScanResult(),
        window.electronAPI.getClaudeConfigSettings()
      ])
      setScanResult(result)
      setSettings(currentSettings)
    } catch (error) {
      console.error('Failed to load Claude config:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()

    // Subscribe to config updates
    const unsubscribe = window.electronAPI.onClaudeConfigUpdated((result) => {
      setScanResult(result)
    })

    return () => {
      unsubscribe()
    }
  }, [loadData])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const result = await window.electronAPI.refreshClaudeConfig()
      setScanResult(result)
    } catch (error) {
      console.error('Failed to refresh:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!settings) return
    try {
      const updated = await window.electronAPI.setClaudeConfigEnabled({ enabled })
      setSettings(updated)
    } catch (error) {
      console.error('Failed to update settings:', error)
    }
  }

  const handleToggleAutoRefresh = async (autoRefresh: boolean) => {
    if (!settings) return
    try {
      const updated = await window.electronAPI.setClaudeConfigEnabled({ autoRefresh })
      setSettings(updated)
    } catch (error) {
      console.error('Failed to update settings:', error)
    }
  }

  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    if (!settings) return

    // If enabledPlugins is empty, it means all are enabled
    // To disable one, we need to add all others to the enabled list
    let newEnabledPlugins: string[]

    if (settings.enabledPlugins.length === 0) {
      // Currently all enabled - need to build the list
      const allPluginIds = scanResult?.plugins.map(p => p.id) || []
      if (enabled) {
        // Enabling a plugin when all are enabled - no change needed
        return
      } else {
        // Disabling a plugin - add all except this one
        newEnabledPlugins = allPluginIds.filter(id => id !== pluginId)
      }
    } else {
      // Already have an explicit list
      if (enabled) {
        newEnabledPlugins = [...settings.enabledPlugins, pluginId]
      } else {
        newEnabledPlugins = settings.enabledPlugins.filter(id => id !== pluginId)
      }
    }

    try {
      const updated = await window.electronAPI.setClaudeConfigEnabled({
        enabledPlugins: newEnabledPlugins
      })
      setSettings(updated)
    } catch (error) {
      console.error('Failed to update plugin settings:', error)
    }
  }

  const handleToggleAgent = async (agentId: string, enabled: boolean) => {
    if (!settings) return

    let newDisabledAgentIds: string[]

    if (enabled) {
      // Remove from disabled list
      newDisabledAgentIds = settings.disabledAgentIds.filter(id => id !== agentId)
    } else {
      // Add to disabled list
      newDisabledAgentIds = [...settings.disabledAgentIds, agentId]
    }

    try {
      const updated = await window.electronAPI.setClaudeConfigEnabled({
        disabledAgentIds: newDisabledAgentIds
      })
      setSettings(updated)
    } catch (error) {
      console.error('Failed to update agent settings:', error)
    }
  }

  const togglePluginExpanded = (pluginId: string) => {
    setExpandedPlugins(prev => {
      const next = new Set(prev)
      if (next.has(pluginId)) {
        next.delete(pluginId)
      } else {
        next.add(pluginId)
      }
      return next
    })
  }

  const isPluginEnabled = (pluginId: string): boolean => {
    if (!settings) return true
    // Empty list means all enabled
    if (settings.enabledPlugins.length === 0) return true
    return settings.enabledPlugins.includes(pluginId)
  }

  const isAgentEnabled = (agentId: string): boolean => {
    if (!settings) return true
    return !settings.disabledAgentIds.includes(agentId)
  }

  if (isLoading) {
    return (
      <section className="settings-section">
        <h2 className="section-title">Imported Agents</h2>
        <div className="settings-card">
          <div className="imported-loading">Loading Claude Code plugins...</div>
        </div>
      </section>
    )
  }

  // Claude Code not installed
  if (!scanResult?.isInstalled) {
    return (
      <section className="settings-section">
        <h2 className="section-title">Imported Agents</h2>
        <div className="settings-card">
          <div className="imported-empty-state">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h3>Claude Code Not Detected</h3>
            <p>
              Install Claude Code to import agents and skills from plugins.
              Claude Code plugins are discovered from <code>~/.claude/</code>.
            </p>
          </div>
        </div>
      </section>
    )
  }

  // No plugins found
  if (scanResult.plugins.length === 0) {
    return (
      <section className="settings-section">
        <h2 className="section-title">Imported Agents</h2>
        <div className="settings-card">
          <div className="imported-empty-state">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>
            <h3>No Plugins Installed</h3>
            <p>
              No Claude Code plugins with agents or skills were found.
              Install plugins using Claude Code to see them here.
            </p>
            <button className="refresh-button" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  const totalAgents = scanResult.importedTypes.filter(t => t.source.type === 'plugin-agent').length
  const totalSkills = scanResult.importedTypes.filter(t => t.source.type === 'plugin-skill').length

  return (
    <section className="settings-section">
      <h2 className="section-title">Imported Agents</h2>
      <div className="settings-card">
        {/* Master Toggle */}
        <div className="setting-item">
          <label className="checkbox-setting">
            <input
              type="checkbox"
              checked={settings?.enabled ?? true}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            <div className="setting-text">
              <span className="setting-label">Enable Claude Code imports</span>
              <span className="setting-description">
                Import agents and skills from Claude Code plugins for use in workflows
              </span>
            </div>
          </label>
        </div>

        {settings?.enabled && (
          <>
            {/* Auto-refresh toggle */}
            <div className="setting-item">
              <label className="checkbox-setting">
                <input
                  type="checkbox"
                  checked={settings?.autoRefresh ?? true}
                  onChange={(e) => handleToggleAutoRefresh(e.target.checked)}
                />
                <div className="setting-text">
                  <span className="setting-label">Auto-refresh</span>
                  <span className="setting-description">
                    Automatically detect plugin changes
                  </span>
                </div>
              </label>
            </div>

            {/* Summary & Refresh */}
            <div className="setting-item">
              <div className="imported-summary">
                <div className="summary-stats">
                  <span className="stat">
                    <strong>{scanResult.plugins.length}</strong> plugin{scanResult.plugins.length !== 1 ? 's' : ''}
                  </span>
                  <span className="stat-separator">|</span>
                  <span className="stat">
                    <strong>{totalAgents}</strong> agent{totalAgents !== 1 ? 's' : ''}
                  </span>
                  <span className="stat-separator">|</span>
                  <span className="stat">
                    <strong>{totalSkills}</strong> skill{totalSkills !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  className="refresh-button-small"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  title="Refresh plugins"
                >
                  <svg
                    className={isRefreshing ? 'spinning' : ''}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M23 4v6h-6" />
                    <path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Conflicts warning */}
            {scanResult.conflicts.length > 0 && (
              <div className="setting-item">
                <div className="conflicts-warning">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 6v4h2v-4h-2zm0 5v2h2v-2h-2z" />
                  </svg>
                  <span>
                    {scanResult.conflicts.length} name conflict{scanResult.conflicts.length !== 1 ? 's' : ''} with built-in agents (automatically renamed)
                  </span>
                </div>
              </div>
            )}

            {/* Errors */}
            {scanResult.errors.length > 0 && (
              <div className="setting-item">
                <div className="scan-errors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                  </svg>
                  <span>
                    {scanResult.errors.length} error{scanResult.errors.length !== 1 ? 's' : ''} during scan
                  </span>
                </div>
              </div>
            )}

            {/* Plugin list */}
            <div className="plugins-list">
              {scanResult.plugins.map((plugin) => {
                const pluginEnabled = isPluginEnabled(plugin.id)
                const isExpanded = expandedPlugins.has(plugin.id)
                const pluginAgents = scanResult.importedTypes.filter(
                  t => t.source.pluginId === plugin.id
                )

                return (
                  <div key={plugin.id} className={`plugin-item ${!pluginEnabled ? 'disabled' : ''}`}>
                    <div className="plugin-header" onClick={() => togglePluginExpanded(plugin.id)}>
                      <div className="plugin-toggle">
                        <label className="checkbox-inline" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={pluginEnabled}
                            onChange={(e) => handleTogglePlugin(plugin.id, e.target.checked)}
                          />
                        </label>
                      </div>
                      <div className="plugin-info">
                        <div className="plugin-name-row">
                          <span className="plugin-name">{plugin.name}</span>
                          <span className="plugin-version">v{plugin.version}</span>
                          {plugin.marketplace && (
                            <span className="plugin-marketplace">{plugin.marketplace}</span>
                          )}
                        </div>
                        {plugin.description && (
                          <span className="plugin-description">{plugin.description}</span>
                        )}
                        <div className="plugin-counts">
                          {plugin.agentCount > 0 && (
                            <span>{plugin.agentCount} agent{plugin.agentCount !== 1 ? 's' : ''}</span>
                          )}
                          {plugin.agentCount > 0 && plugin.skillCount > 0 && (
                            <span className="count-separator">,</span>
                          )}
                          {plugin.skillCount > 0 && (
                            <span>{plugin.skillCount} skill{plugin.skillCount !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                      <div className="plugin-expand">
                        <svg
                          className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    </div>

                    {isExpanded && pluginEnabled && (
                      <div className="plugin-agents">
                        {pluginAgents.map((agent) => {
                          const agentEnabled = isAgentEnabled(agent.id)
                          const conflict = scanResult.conflicts.find(c => c.importedId === agent.id)

                          return (
                            <div key={agent.id} className={`imported-agent-item ${!agentEnabled ? 'disabled' : ''}`}>
                              <label className="checkbox-inline">
                                <input
                                  type="checkbox"
                                  checked={agentEnabled}
                                  onChange={(e) => handleToggleAgent(agent.id, e.target.checked)}
                                />
                              </label>
                              <div className="imported-agent-info">
                                <div className="imported-agent-name-row">
                                  <span className="imported-agent-name">{agent.name}</span>
                                  <span className={`imported-agent-type ${agent.source.type}`}>
                                    {agent.source.type === 'plugin-agent' ? 'Agent' : 'Skill'}
                                  </span>
                                  {conflict && (
                                    <span className="conflict-badge" title={`Conflicts with built-in "${conflict.builtInName}"`}>
                                      Renamed
                                    </span>
                                  )}
                                </div>
                                <span className="imported-agent-description">{agent.description}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Last scanned */}
            <div className="setting-item last-scanned">
              <span className="setting-description">
                Last scanned: {new Date(scanResult.lastScanned).toLocaleString()}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default ImportedAgentsSettings
