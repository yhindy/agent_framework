import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AppSettings,
  DEFAULT_SETTINGS,
  TOOL_DISPLAY_NAMES,
  CLAUDE_MODEL_DISPLAY_NAMES,
  CURSOR_CLI_MODEL_DISPLAY_NAMES,
  TERMINAL_MODE_DISPLAY_NAMES
} from '../../../shared/types/settings'
import WorkflowSettings from './WorkflowSettings'
import ImportedAgentsSettings from './ImportedAgentsSettings'
import './SettingsPage.css'

interface SettingSelectProps<T extends string> {
  label: string
  value: T
  options: Record<T, string>
  onChange: (value: T) => void
}

function SettingSelect<T extends string>({
  label,
  value,
  options,
  onChange
}: SettingSelectProps<T>): JSX.Element {
  return (
    <div className="setting-item">
      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">{label}</span>
        </div>
        <select
          className="settings-select"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {(Object.keys(options) as T[]).map((key) => (
            <option key={key} value={key}>
              {options[key]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [tmuxAvailable, setTmuxAvailable] = useState<boolean | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    async function loadSettings(): Promise<void> {
      try {
        const loadedSettings = await window.electronAPI.getSettings()
        setSettings(loadedSettings)
      } catch (error) {
        console.error('Failed to load settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()

    // Check tmux availability
    window.electronAPI.checkTmuxAvailable().then(setTmuxAvailable).catch(() => setTmuxAvailable(false))

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
    }
  }, [])

  const saveSettings = useCallback(async (newSettings: AppSettings) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await window.electronAPI.updateSettings(newSettings)
        setSaveStatus('saved')
        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current)
        statusTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (error) {
        console.error('Failed to save settings:', error)
        setSaveStatus('idle')
      }
    }, 300)
  }, [])

  const updateSettings = useCallback(
    (updater: (prev: AppSettings) => AppSettings) => {
      setSettings((prev) => {
        const newSettings = updater(prev)
        saveSettings(newSettings)
        return newSettings
      })
    },
    [saveSettings]
  )

  function updateNotification<K extends keyof AppSettings['notifications']>(
    key: K,
    value: AppSettings['notifications'][K]
  ): void {
    if (key === 'cooldownSeconds') {
      value = Math.max(0, Math.min(300, value as number)) as AppSettings['notifications'][K]
    }
    updateSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value }
    }))
  }

  function updateDefaultTool<K extends keyof AppSettings['defaultTool']>(
    key: K,
    value: AppSettings['defaultTool'][K]
  ): void {
    updateSettings((prev) => ({
      ...prev,
      defaultTool: { ...prev.defaultTool, [key]: value }
    }))
  }

  function updateDefaultAgent<K extends keyof AppSettings['defaultAgent']>(
    key: K,
    value: AppSettings['defaultAgent'][K]
  ): void {
    updateSettings((prev) => ({
      ...prev,
      defaultAgent: { ...prev.defaultAgent, [key]: value }
    }))
  }

  function updateTerminal<K extends keyof AppSettings['terminal']>(
    key: K,
    value: AppSettings['terminal'][K]
  ): void {
    updateSettings((prev) => ({
      ...prev,
      terminal: { ...prev.terminal, [key]: value }
    }))
  }

  async function handleLeaveFeedback(): Promise<void> {
    try {
      await window.electronAPI.openFeedback()
    } catch (error) {
      console.error('Failed to open feedback:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="settings-page">
        <div className="settings-loading">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        {saveStatus !== 'idle' && (
          <span className={`save-status save-status--${saveStatus}`}>
            {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
          </span>
        )}
      </div>

      <div className="settings-content">
        {/* Notifications Section */}
        <section className="settings-section">
          <h2 className="section-title">Notifications</h2>
          <div className="settings-card">
            <div className="setting-item">
              <label className="checkbox-setting">
                <input
                  type="checkbox"
                  checked={settings.notifications.enabled}
                  onChange={(e) => updateNotification('enabled', e.target.checked)}
                />
                <div className="setting-text">
                  <span className="setting-label">Enable OS notifications</span>
                  <span className="setting-description">
                    Get notified when agents need your attention
                  </span>
                </div>
              </label>
            </div>

            <div className="setting-item">
              <div className="setting-row">
                <div className="setting-text">
                  <span className="setting-label">Notification cooldown</span>
                  <span className="setting-description">
                    Minimum time between notifications for the same agent
                  </span>
                </div>
                <div className="setting-input-group">
                  <input
                    type="number"
                    className="cooldown-input"
                    value={settings.notifications.cooldownSeconds}
                    onChange={(e) =>
                      updateNotification('cooldownSeconds', parseInt(e.target.value, 10) || 0)
                    }
                    min={0}
                    max={300}
                  />
                  <span className="input-suffix">seconds</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Default Tool & Model Section */}
        <section className="settings-section">
          <h2 className="section-title">Default Tool & Model</h2>
          <div className="settings-card">
            <SettingSelect
              label="Default tool"
              value={settings.defaultTool.tool}
              options={TOOL_DISPLAY_NAMES}
              onChange={(tool) => updateDefaultTool('tool', tool)}
            />

            {settings.defaultTool.tool === 'claude' && (
              <SettingSelect
                label="Default Claude model"
                value={settings.defaultTool.claudeModel}
                options={CLAUDE_MODEL_DISPLAY_NAMES}
                onChange={(model) => updateDefaultTool('claudeModel', model)}
              />
            )}

            {settings.defaultTool.tool === 'cursor-cli' && (
              <SettingSelect
                label="Default Cursor CLI model"
                value={settings.defaultTool.cursorCLIModel}
                options={CURSOR_CLI_MODEL_DISPLAY_NAMES}
                onChange={(model) => updateDefaultTool('cursorCLIModel', model)}
              />
            )}

            {/* Show Codex model info when Codex is selected */}
            {settings.defaultTool.tool === 'codex' && (
              <div className="setting-item">
                <div className="setting-row">
                  <div className="setting-text">
                    <span className="setting-label">Codex model</span>
                    <span className="setting-description">
                      Codex always uses gpt-5.2-codex (hardcoded)
                    </span>
                  </div>
                  <span className="codex-model-badge">gpt-5.2-codex</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Default Agent Settings Section */}
        <section className="settings-section">
          <h2 className="section-title">Default Agent Settings</h2>
          <div className="settings-card">
            <div className="setting-item">
              <div className="setting-text full-width">
                <span className="setting-label">Default workflow</span>
              </div>
              <div className="workflow-options">
                {(['planning', 'dev'] as const).map((mode) => (
                  <label
                    key={mode}
                    className={`workflow-radio ${settings.defaultAgent.workflowMode === mode ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="workflowMode"
                      value={mode}
                      checked={settings.defaultAgent.workflowMode === mode}
                      onChange={() => updateDefaultAgent('workflowMode', mode)}
                    />
                    <div className="workflow-radio-content">
                      <span className="workflow-radio-title">
                        {mode === 'planning' ? 'Plan First' : 'Start Immediately'}
                      </span>
                      <span className="workflow-radio-description">
                        {mode === 'planning'
                          ? 'Agent proposes a plan for review before making changes'
                          : 'Agent begins implementing right away'}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="setting-item">
              <label className="checkbox-setting">
                <input
                  type="checkbox"
                  checked={settings.defaultAgent.yoloMode}
                  onChange={(e) => updateDefaultAgent('yoloMode', e.target.checked)}
                />
                <div className="setting-text">
                  <span className="setting-label">YOLO mode</span>
                  <span className="setting-description">
                    Auto-approve edits and commands without confirmation
                  </span>
                </div>
              </label>
            </div>

            <div className="setting-item">
              <label className="checkbox-setting">
                <input
                  type="checkbox"
                  checked={settings.defaultAgent.chromeIntegration}
                  onChange={(e) => updateDefaultAgent('chromeIntegration', e.target.checked)}
                />
                <div className="setting-text">
                  <span className="setting-label">Chrome integration</span>
                  <span className="setting-description">
                    Enable browser automation capabilities
                  </span>
                </div>
              </label>
            </div>
          </div>
        </section>

        {/* Terminal Section */}
        <section className="settings-section">
          <h2 className="section-title">Terminal</h2>
          <div className="settings-card">
            <SettingSelect
              label="Terminal mode"
              value={settings.terminal?.terminalMode || 'tmux'}
              options={TERMINAL_MODE_DISPLAY_NAMES}
              onChange={(mode) => updateTerminal('terminalMode', mode)}
            />
            <div className="setting-item">
              <div className="setting-text">
                <span className="setting-description">
                  {settings.terminal?.terminalMode === 'tmux'
                    ? 'Agent terminals run inside tmux sessions. Use Ctrl+B for tmux commands.'
                    : 'Agent terminals use traditional GUI tabs.'}
                </span>
              </div>
            </div>
            {settings.terminal?.terminalMode === 'tmux' && tmuxAvailable === false && (
              <div className="setting-item">
                <div className="setting-warning">
                  ⚠️ tmux is not installed. Will automatically fall back to tabs mode.
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Workflow Templates Section */}
        <WorkflowSettings />

        {/* Imported Agents Section */}
        <ImportedAgentsSettings />

        {/* Feedback Section */}
        <section className="settings-section">
          <h2 className="section-title">Feedback</h2>
          <div className="settings-card">
            <div className="feedback-content">
              <p className="feedback-text">
                Help us improve Minion Laboratory! Share your feedback, report bugs, or suggest new
                features.
              </p>
              <button className="feedback-button" onClick={handleLeaveFeedback}>
                Leave Feedback
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default SettingsPage
