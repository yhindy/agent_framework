import { useState, useEffect, useCallback } from 'react'
import { RefreshIcon } from '../icons'
import { useSnackbar } from '../../contexts/SnackbarContext'
import './SkillsPage.css'

interface Item {
  id: string; name: string; description: string; filePath: string
  source: { type: 'command' | 'agent' | 'plugin'; path: string }
  model?: string
}

interface ScanResult {
  items: Item[]
  itemsBySource: { commands: Item[]; agents: Item[]; plugins: Item[] }
  errors: { type: string; path: string; message: string }[]
  lastScanned: string
}

const plural = (n: number) => n !== 1 ? 's' : ''

const SkillsIcon = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const px = { sm: 16, md: 20, lg: 24 }[size]
  return <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
  </svg>
}

const ItemCard = ({ item, isExpanded, onToggleExpand }: {
  item: Item; isExpanded: boolean; onToggleExpand: () => void
}) => (
  <div className="skill-card">
    <div className="skill-card-header" onClick={onToggleExpand}>
      <div className="skill-info">
        <div className="skill-name-row">
          <span className="skill-name">{item.name}</span>
          <span className={`type-badge type-badge--${item.source.type}`}>
            {item.source.type === 'command' ? 'Skill' : item.source.type === 'agent' ? 'Agent' : 'Plugin'}
          </span>
          {item.model && <span className="model-badge">{item.model}</span>}
        </div>
        <span className="skill-description">{item.description}</span>
      </div>
      <svg className={`expand-icon ${isExpanded ? 'expanded' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
    {isExpanded && (
      <div className="skill-details">
        <div className="skill-path"><span className="path-label">Path:</span><code>{item.filePath}</code></div>
      </div>
    )}
  </div>
)

export function SkillsPage(): JSX.Element {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sections, setSections] = useState<Set<string>>(new Set(['commands', 'agents', 'plugins']))
  const { addSnackbar } = useSnackbar()

  const load = useCallback(async () => {
    try { setResult(await window.electronAPI.getUnifiedSkillsScanResult()) }
    catch (e) { console.error('Failed to load:', e); addSnackbar({ title: 'Error', messages: ['Failed to load'] }) }
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
    try { setResult(await window.electronAPI.refreshUnifiedSkills()); addSnackbar({ title: 'Refreshed', messages: ['Library refreshed'] }) }
    catch { addSnackbar({ title: 'Error', messages: ['Failed to refresh'] }) }
    finally { setIsRefreshing(false) }
  }

  const toggleSet = <T extends string>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key); return next
  }

  if (isLoading) return (
    <div className="skills-page">
      <div className="skills-header"><h1><SkillsIcon size="lg" />Skills & Agents</h1></div>
      <div className="skills-content"><div className="skills-loading">Loading...</div></div>
    </div>
  )

  const total = result?.items.length ?? 0

  const Section = ({ title, sectionKey, items, empty, help }: { title: string; sectionKey: string; items: Item[]; empty: string; help: string }) => {
    const open = sections.has(sectionKey)
    return (
      <div className="skills-section">
        <div className="section-header" onClick={() => setSections(toggleSet(sections, sectionKey))}>
          <div className="section-title-row">
            <svg className={`section-expand-icon ${open ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <h2>{title}</h2><span className="section-count">{items.length}</span>
          </div>
          <span className="section-help">{help}</span>
        </div>
        {open && <div className="section-content">
          {items.length === 0 ? <div className="section-empty">{empty}</div> :
            items.map(i => <ItemCard key={i.id} item={i} isExpanded={expanded.has(i.id)} onToggleExpand={() => setExpanded(toggleSet(expanded, i.id))} />)}
        </div>}
      </div>
    )
  }

  return (
    <div className="skills-page">
      <div className="skills-header">
        <div className="header-title">
          <h1><SkillsIcon size="lg" />Skills & Agents</h1>
          <span className="skills-summary">{total} item{plural(total)} available</span>
        </div>
        <button className="refresh-btn" onClick={refresh} disabled={isRefreshing} title="Refresh">
          <RefreshIcon size="sm" className={isRefreshing ? 'spinning' : ''} />{isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {result && result.errors.length > 0 && (
        <div className="skills-error-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
          <span>{result.errors.length} error{plural(result.errors.length)} during scan</span>
        </div>
      )}

      <div className="skills-content">
        <Section title="Skills" sectionKey="commands" items={result?.itemsBySource.commands ?? []}
          empty="No skills found. Add .md files to ~/.claude/commands/" help="~/.claude/commands/" />
        <Section title="Agents" sectionKey="agents" items={result?.itemsBySource.agents ?? []}
          empty="No agents found. Add .md files to ~/.claude/agents/" help="~/.claude/agents/" />
        <Section title="Plugins" sectionKey="plugins" items={result?.itemsBySource.plugins ?? []}
          empty="No plugins found. Install plugins via Claude Code." help="~/.claude/plugins/" />
      </div>

      {result && <div className="skills-footer"><span className="last-scanned">Last scanned: {new Date(result.lastScanned).toLocaleString()}</span></div>}
    </div>
  )
}

export default SkillsPage
