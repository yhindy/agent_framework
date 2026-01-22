import { useState, useEffect, useCallback } from 'react'
import { RefreshIcon } from '../icons'
import { useSnackbar } from '../../contexts/SnackbarContext'
import './SkillsPage.css'

interface SkillScript {
  name: string
  filename: string
  path: string
  content: string
  description?: string
}

interface SkillReference {
  name: string
  path: string
  content: string
}

interface UnifiedSkill {
  id: string
  name: string
  description: string
  sourceType: 'claude-plugin' | 'vercel-skill' | 'project-skill'
  sourceName: string
  filePath: string
  promptContent: string
  scripts: SkillScript[]
  references: SkillReference[]
  overrides?: string
  isOverridden?: boolean
  overriddenBy?: string
  enabled: boolean
}

interface SkillsBySource {
  claudePlugins: UnifiedSkill[]
  vercelSkills: UnifiedSkill[]
  projectSkills: UnifiedSkill[]
}

interface SkillOverride {
  overridingSkillId: string
  overriddenSkillId: string
  overridingName: string
  overriddenName: string
}

interface UnifiedSkillsScanResult {
  skills: UnifiedSkill[]
  skillsBySource: SkillsBySource
  overrides: SkillOverride[]
  errors: Array<{ type: string; path: string; message: string }>
  lastScanned: string
}

function plural(count: number): string {
  return count !== 1 ? 's' : ''
}

function SkillsIcon({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }): JSX.Element {
  const sizeMap = { sm: 16, md: 20, lg: 24, xl: 48 }
  const px = sizeMap[size]
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}

function SourceBadge({ sourceType }: { sourceType: UnifiedSkill['sourceType'] }): JSX.Element {
  const labels: Record<UnifiedSkill['sourceType'], string> = {
    'claude-plugin': 'Plugin',
    'vercel-skill': 'Vercel',
    'project-skill': 'Project'
  }
  return <span className={`source-badge source-badge--${sourceType}`}>{labels[sourceType]}</span>
}

function TypeBadge({ sourceType }: { sourceType: UnifiedSkill['sourceType'] }): JSX.Element {
  // Plugin sources can be either agents or skills; Vercel/project are always skills
  const isPlugin = sourceType === 'claude-plugin'
  return <span className={`type-badge ${isPlugin ? 'type-badge--agent' : 'type-badge--skill'}`}>
    {isPlugin ? 'Agent' : 'Skill'}
  </span>
}

function SkillCard({
  skill,
  onToggle,
  isExpanded,
  onToggleExpand
}: {
  skill: UnifiedSkill
  onToggle: (skillId: string, enabled: boolean) => void
  isExpanded: boolean
  onToggleExpand: () => void
}): JSX.Element {
  return (
    <div className={`skill-card ${!skill.enabled ? 'skill-card--disabled' : ''} ${skill.isOverridden ? 'skill-card--overridden' : ''}`}>
      <div className="skill-card-header" onClick={onToggleExpand}>
        <label className="skill-checkbox" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={skill.enabled}
            disabled={skill.isOverridden}
            onChange={(e) => onToggle(skill.id, e.target.checked)}
          />
        </label>
        <div className="skill-info">
          <div className="skill-name-row">
            <span className="skill-name">{skill.name}</span>
            <SourceBadge sourceType={skill.sourceType} />
            <TypeBadge sourceType={skill.sourceType} />
            {skill.isOverridden && (
              <span className="override-badge" title={`Overridden by project skill`}>
                Overridden
              </span>
            )}
            {skill.overrides && (
              <span className="overrides-badge" title={`Overrides a global skill`}>
                Override
              </span>
            )}
          </div>
          <span className="skill-description">{skill.description}</span>
          <span className="skill-source-name">{skill.sourceName}</span>
        </div>
        <div className="skill-expand">
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

      {isExpanded && (
        <div className="skill-details">
          {skill.scripts.length > 0 && (
            <div className="skill-scripts">
              <h4>Scripts ({skill.scripts.length})</h4>
              <ul>
                {skill.scripts.map((script) => (
                  <li key={script.path}>
                    <code>{script.filename}</code>
                    {script.description && <span className="script-desc"> - {script.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skill.references.length > 0 && (
            <div className="skill-references">
              <h4>References ({skill.references.length})</h4>
              <ul>
                {skill.references.map((ref) => (
                  <li key={ref.path}>
                    <code>{ref.name}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="skill-path">
            <span className="path-label">Path:</span>
            <code>{skill.filePath}</code>
          </div>
        </div>
      )}
    </div>
  )
}

export function SkillsPage(): JSX.Element {
  const [scanResult, setScanResult] = useState<UnifiedSkillsScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set())
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['claudePlugins', 'vercelSkills', 'projectSkills'])
  )
  const { addSnackbar } = useSnackbar()

  const loadData = useCallback(async () => {
    try {
      const result = await window.electronAPI.getUnifiedSkillsScanResult()
      setScanResult(result)
    } catch (error) {
      console.error('Failed to load skills:', error)
      addSnackbar({ title: 'Error', messages: ['Failed to load skills'] })
    } finally {
      setIsLoading(false)
    }
  }, [addSnackbar])

  useEffect(() => {
    loadData()

    // Subscribe to updates
    const unsubClaudeConfig = window.electronAPI.onClaudeConfigUpdated(() => {
      loadData()
    })
    const unsubSkillsLibrary = window.electronAPI.onSkillsLibraryUpdated(() => {
      loadData()
    })
    const unsubUnifiedSkills = window.electronAPI.onUnifiedSkillsUpdated((result) => {
      setScanResult(result)
    })

    return () => {
      unsubClaudeConfig()
      unsubSkillsLibrary()
      unsubUnifiedSkills()
    }
  }, [loadData])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const result = await window.electronAPI.refreshUnifiedSkills()
      setScanResult(result)
      addSnackbar({ title: 'Refreshed', messages: ['Skills library refreshed'] })
    } catch (error) {
      console.error('Failed to refresh:', error)
      addSnackbar({ title: 'Error', messages: ['Failed to refresh skills'] })
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleToggleSkill = async (skillId: string, enabled: boolean) => {
    try {
      await window.electronAPI.setSkillEnabled(skillId, enabled)
      // Refresh to get updated state
      const result = await window.electronAPI.getUnifiedSkillsScanResult()
      setScanResult(result)
    } catch (error) {
      console.error('Failed to toggle skill:', error)
      addSnackbar({ title: 'Error', messages: ['Failed to update skill'] })
    }
  }

  const toggleSkillExpanded = (skillId: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev)
      next.has(skillId) ? next.delete(skillId) : next.add(skillId)
      return next
    })
  }

  const toggleSectionExpanded = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      next.has(section) ? next.delete(section) : next.add(section)
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="skills-page">
        <div className="skills-header">
          <h1>
            <SkillsIcon size="lg" />
            Skills
          </h1>
        </div>
        <div className="skills-content">
          <div className="skills-loading">Loading skills...</div>
        </div>
      </div>
    )
  }

  const totalSkills = scanResult?.skills.length ?? 0
  const enabledSkills = scanResult?.skills.filter((s) => s.enabled && !s.isOverridden).length ?? 0

  const renderSection = (
    title: string,
    key: string,
    skills: UnifiedSkill[],
    emptyMessage: string,
    helpText?: string
  ) => {
    const isExpanded = expandedSections.has(key)
    const enabledCount = skills.filter((s) => s.enabled && !s.isOverridden).length

    return (
      <div className="skills-section">
        <div className="section-header" onClick={() => toggleSectionExpanded(key)}>
          <div className="section-title-row">
            <svg
              className={`section-expand-icon ${isExpanded ? 'expanded' : ''}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <h2>{title}</h2>
            <span className="section-count">
              {enabledCount}/{skills.length}
            </span>
          </div>
          {helpText && <span className="section-help">{helpText}</span>}
        </div>

        {isExpanded && (
          <div className="section-content">
            {skills.length === 0 ? (
              <div className="section-empty">{emptyMessage}</div>
            ) : (
              skills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onToggle={handleToggleSkill}
                  isExpanded={expandedSkills.has(skill.id)}
                  onToggleExpand={() => toggleSkillExpanded(skill.id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="skills-page">
      <div className="skills-header">
        <div className="header-title">
          <h1>
            <SkillsIcon size="lg" />
            Skills
          </h1>
          <span className="skills-summary">
            {enabledSkills} of {totalSkills} skill{plural(totalSkills)} enabled
          </span>
        </div>
        <button
          className="refresh-btn"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh skills"
        >
          <RefreshIcon size="sm" className={isRefreshing ? 'spinning' : ''} />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {scanResult && scanResult.overrides.length > 0 && (
        <div className="skills-info-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          <span>
            {scanResult.overrides.length} project skill{plural(scanResult.overrides.length)} overriding
            global skill{plural(scanResult.overrides.length)}
          </span>
        </div>
      )}

      {scanResult && scanResult.errors.length > 0 && (
        <div className="skills-error-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <span>
            {scanResult.errors.length} error{plural(scanResult.errors.length)} during scan
          </span>
        </div>
      )}

      <div className="skills-content">
        {renderSection(
          'Claude Code Plugins',
          'claudePlugins',
          scanResult?.skillsBySource.claudePlugins ?? [],
          'No Claude Code plugins with agents or skills found. Install plugins using Claude Code to see them here.',
          '~/.claude/plugins/cache/'
        )}

        {renderSection(
          'Vercel Skills',
          'vercelSkills',
          scanResult?.skillsBySource.vercelSkills ?? [],
          'No Vercel skills found. Install skills using: npx add-skill <skill-name>',
          '~/.claude/skills/'
        )}

        {renderSection(
          'Project Skills',
          'projectSkills',
          scanResult?.skillsBySource.projectSkills ?? [],
          'No project-local skills found. Add skills to your project\'s .claude/skills/ directory.',
          '{project}/.claude/skills/'
        )}
      </div>

      {scanResult && (
        <div className="skills-footer">
          <span className="last-scanned">
            Last scanned: {new Date(scanResult.lastScanned).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}

export default SkillsPage
