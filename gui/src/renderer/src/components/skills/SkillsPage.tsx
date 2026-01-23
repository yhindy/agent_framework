import { useState, useEffect, useCallback } from 'react'
import { RefreshIcon } from '../icons'
import { useSnackbar } from '../../contexts/SnackbarContext'
import './SkillsPage.css'

type SourceType = 'claude-plugin' | 'vercel-skill' | 'project-skill'

interface Skill {
  id: string; name: string; description: string; sourceType: SourceType; sourceName: string
  filePath: string; promptContent: string; enabled: boolean
  scripts: { name: string; filename: string; path: string; content: string; description?: string }[]
  references: { name: string; path: string; content: string }[]
  overrides?: string; isOverridden?: boolean; overriddenBy?: string
}

interface ScanResult {
  skills: Skill[]
  skillsBySource: { claudePlugins: Skill[]; vercelSkills: Skill[]; projectSkills: Skill[] }
  overrides: { overridingSkillId: string; overriddenSkillId: string; overridingName: string; overriddenName: string }[]
  errors: { type: string; path: string; message: string }[]
  lastScanned: string
}

const plural = (n: number) => n !== 1 ? 's' : ''
const SOURCE_LABELS: Record<SourceType, string> = { 'claude-plugin': 'Plugin', 'vercel-skill': 'Vercel', 'project-skill': 'Project' }

const SkillsIcon = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) => {
  const px = { sm: 16, md: 20, lg: 24, xl: 48 }[size]
  return <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
  </svg>
}

const ChevronIcon = ({ expanded }: { expanded: boolean }) =>
  <svg className={`expand-icon ${expanded ? 'expanded' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="6 9 12 15 18 9" />
  </svg>

const SkillCard = ({ skill, onToggle, isExpanded, onToggleExpand }: {
  skill: Skill; onToggle: (id: string, enabled: boolean) => void; isExpanded: boolean; onToggleExpand: () => void
}) => (
  <div className={`skill-card ${!skill.enabled ? 'skill-card--disabled' : ''} ${skill.isOverridden ? 'skill-card--overridden' : ''}`}>
    <div className="skill-card-header" onClick={onToggleExpand}>
      <label className="skill-checkbox" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={skill.enabled} disabled={skill.isOverridden} onChange={e => onToggle(skill.id, e.target.checked)} />
      </label>
      <div className="skill-info">
        <div className="skill-name-row">
          <span className="skill-name">{skill.name}</span>
          <span className={`source-badge source-badge--${skill.sourceType}`}>{SOURCE_LABELS[skill.sourceType]}</span>
          <span className={`type-badge ${skill.sourceType === 'claude-plugin' ? 'type-badge--agent' : 'type-badge--skill'}`}>
            {skill.sourceType === 'claude-plugin' ? 'Agent' : 'Skill'}
          </span>
          {skill.isOverridden && <span className="override-badge" title="Overridden by project skill">Overridden</span>}
          {skill.overrides && <span className="overrides-badge" title="Overrides a global skill">Override</span>}
        </div>
        <span className="skill-description">{skill.description}</span>
        <span className="skill-source-name">{skill.sourceName}</span>
      </div>
      <div className="skill-expand"><ChevronIcon expanded={isExpanded} /></div>
    </div>
    {isExpanded && (
      <div className="skill-details">
        {skill.scripts.length > 0 && <div className="skill-scripts">
          <h4>Scripts ({skill.scripts.length})</h4>
          <ul>{skill.scripts.map(s => <li key={s.path}><code>{s.filename}</code>{s.description && <span className="script-desc"> - {s.description}</span>}</li>)}</ul>
        </div>}
        {skill.references.length > 0 && <div className="skill-references">
          <h4>References ({skill.references.length})</h4>
          <ul>{skill.references.map(r => <li key={r.path}><code>{r.name}</code></li>)}</ul>
        </div>}
        <div className="skill-path"><span className="path-label">Path:</span><code>{skill.filePath}</code></div>
      </div>
    )}
  </div>
)

export function SkillsPage(): JSX.Element {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sections, setSections] = useState<Set<string>>(new Set(['claudePlugins', 'vercelSkills', 'projectSkills']))
  const { addSnackbar } = useSnackbar()

  const load = useCallback(async () => {
    try { setResult(await window.electronAPI.getUnifiedSkillsScanResult()) }
    catch (e) { console.error('Failed to load skills:', e); addSnackbar({ title: 'Error', messages: ['Failed to load skills'] }) }
    finally { setIsLoading(false) }
  }, [addSnackbar])

  useEffect(() => {
    load()
    const unsubs = [
      window.electronAPI.onClaudeConfigUpdated(load),
      window.electronAPI.onSkillsLibraryUpdated(load),
      window.electronAPI.onUnifiedSkillsUpdated(setResult)
    ]
    return () => unsubs.forEach(fn => fn())
  }, [load])

  const refresh = async () => {
    setIsRefreshing(true)
    try { setResult(await window.electronAPI.refreshUnifiedSkills()); addSnackbar({ title: 'Refreshed', messages: ['Skills library refreshed'] }) }
    catch { addSnackbar({ title: 'Error', messages: ['Failed to refresh skills'] }) }
    finally { setIsRefreshing(false) }
  }

  const toggle = async (id: string, enabled: boolean) => {
    try { await window.electronAPI.setSkillEnabled(id, enabled); setResult(await window.electronAPI.getUnifiedSkillsScanResult()) }
    catch { addSnackbar({ title: 'Error', messages: ['Failed to update skill'] }) }
  }

  const toggleSet = <T extends string>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key); return next
  }

  if (isLoading) return (
    <div className="skills-page">
      <div className="skills-header"><h1><SkillsIcon size="lg" />Skills</h1></div>
      <div className="skills-content"><div className="skills-loading">Loading skills...</div></div>
    </div>
  )

  const total = result?.skills.length ?? 0
  const enabled = result?.skills.filter(s => s.enabled && !s.isOverridden).length ?? 0

  const Section = ({ title, key: k, skills, empty, help }: { title: string; key: string; skills: Skill[]; empty: string; help?: string }) => {
    const open = sections.has(k), count = skills.filter(s => s.enabled && !s.isOverridden).length
    return (
      <div className="skills-section">
        <div className="section-header" onClick={() => setSections(toggleSet(sections, k))}>
          <div className="section-title-row">
            <svg className={`section-expand-icon ${open ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <h2>{title}</h2><span className="section-count">{count}/{skills.length}</span>
          </div>
          {help && <span className="section-help">{help}</span>}
        </div>
        {open && <div className="section-content">
          {skills.length === 0 ? <div className="section-empty">{empty}</div> :
            skills.map(s => <SkillCard key={s.id} skill={s} onToggle={toggle} isExpanded={expanded.has(s.id)} onToggleExpand={() => setExpanded(toggleSet(expanded, s.id))} />)}
        </div>}
      </div>
    )
  }

  return (
    <div className="skills-page">
      <div className="skills-header">
        <div className="header-title">
          <h1><SkillsIcon size="lg" />Skills</h1>
          <span className="skills-summary">{enabled} of {total} skill{plural(total)} enabled</span>
        </div>
        <button className="refresh-btn" onClick={refresh} disabled={isRefreshing} title="Refresh skills">
          <RefreshIcon size="sm" className={isRefreshing ? 'spinning' : ''} />{isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {result && result.overrides.length > 0 && (
        <div className="skills-info-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" /></svg>
          <span>{result.overrides.length} project skill{plural(result.overrides.length)} overriding global skill{plural(result.overrides.length)}</span>
        </div>
      )}

      {result && result.errors.length > 0 && (
        <div className="skills-error-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
          <span>{result.errors.length} error{plural(result.errors.length)} during scan</span>
        </div>
      )}

      <div className="skills-content">
        <Section title="Claude Code Plugins" key="claudePlugins" skills={result?.skillsBySource.claudePlugins ?? []}
          empty="No Claude Code plugins with agents or skills found. Install plugins using Claude Code to see them here." help="~/.claude/plugins/cache/" />
        <Section title="Vercel Skills" key="vercelSkills" skills={result?.skillsBySource.vercelSkills ?? []}
          empty="No Vercel skills found. Install skills using: npx add-skill <skill-name>" help="~/.claude/skills/" />
        <Section title="Project Skills" key="projectSkills" skills={result?.skillsBySource.projectSkills ?? []}
          empty="No project-local skills found. Add skills to your project's .claude/skills/ directory." help="{project}/.claude/skills/" />
      </div>

      {result && <div className="skills-footer"><span className="last-scanned">Last scanned: {new Date(result.lastScanned).toLocaleString()}</span></div>}
    </div>
  )
}

export default SkillsPage
