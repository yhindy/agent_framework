import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ArchivedAgent } from '../../../../main/services/types/ProjectConfig'
import { ClockIcon, RefreshIcon } from '../icons'
import { useSnackbar } from '../../contexts/SnackbarContext'
import './ArchivePage.css'

// Extended type to include project info
interface ArchiveWithProject extends ArchivedAgent {
  projectPath: string
  projectName: string
}

export function ArchivePage(): JSX.Element {
  const [archives, setArchives] = useState<ArchiveWithProject[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const navigate = useNavigate()
  const { addSnackbar } = useSnackbar()

  const loadArchives = async () => {
    setLoading(true)
    try {
      // Get all active (open) projects and fetch archives from each
      const activeProjects = await window.electronAPI.getActiveProjects()
      const allArchives: ArchiveWithProject[] = []

      for (const project of activeProjects) {
        try {
          const projectArchives = await window.electronAPI.listArchivedAgents(project.path)
          // Add project info to each archive
          for (const archive of projectArchives) {
            allArchives.push({
              ...archive,
              projectPath: project.path,
              projectName: project.name || project.path.split('/').pop() || 'Unknown'
            })
          }
        } catch (error) {
          console.warn(`Failed to load archives for ${project.path}:`, error)
        }
      }

      // Sort by archivedAt descending
      allArchives.sort((a, b) =>
        new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
      )

      setArchives(allArchives)
    } catch (error) {
      console.error('Failed to load archives:', error)
      addSnackbar({ title: 'Error', messages: ['Failed to load archives'] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadArchives()
  }, [])

  const handleRestore = async (archive: ArchiveWithProject) => {
    setRestoring(archive.archiveId)
    try {
      const agent = await window.electronAPI.restoreArchivedAgent(
        archive.projectPath,
        archive.archiveId
      )
      addSnackbar({ title: 'Success', messages: [`Agent restored as ${agent.agentId}`] })
      navigate(`/workspace/agent/${agent.agentId}`)
    } catch (error) {
      console.error('Failed to restore agent:', error)
      addSnackbar({ title: 'Error', messages: [`Failed to restore agent: ${error}`] })
    } finally {
      setRestoring(null)
    }
  }

  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'var(--color-success)'
      case 'failed':
      case 'blocked':
        return 'var(--color-error)'
      case 'pr-open':
        return 'var(--color-purple)'
      case 'pr-merged':
      case 'merged':
        return 'var(--color-info)'
      default:
        return 'var(--text-muted)'
    }
  }

  const formatDate = (isoDate: string): string => {
    const date = new Date(isoDate)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }

  if (loading) {
    return (
      <div className="archive-page">
        <div className="archive-header">
          <h1>
            <ClockIcon size="lg" />
            Archive
          </h1>
        </div>
        <div className="archive-content">
          <div className="archive-loading">Loading archives...</div>
        </div>
      </div>
    )
  }

  if (archives.length === 0) {
    return (
      <div className="archive-page">
        <div className="archive-header">
          <h1>
            <ClockIcon size="lg" />
            Archive
          </h1>
        </div>
        <div className="archive-content">
          <div className="archive-empty">
            <ClockIcon size="xl" className="icon--muted" />
            <p>No archived agents yet</p>
            <span className="archive-empty-hint">
              When you clean up completed agents, their history will appear here
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="archive-page">
      <div className="archive-header">
        <h1>
          <ClockIcon size="lg" />
          Archive
        </h1>
        <button className="archive-refresh-btn" onClick={loadArchives} title="Refresh">
          <RefreshIcon size="sm" />
        </button>
      </div>
      <div className="archive-content">
        <div className="archive-list">
          {archives.map((archive) => (
            <div
              key={archive.archiveId}
              className="archive-item"
              style={{ borderLeftColor: getStatusColor(archive.finalStatus) }}
            >
              <div className="archive-item-main">
                <div className="archive-item-header">
                  <span className="archive-item-project">{archive.projectName}</span>
                  {archive.branch && (
                    <span className="archive-item-branch">{archive.branch}</span>
                  )}
                  <span
                    className="archive-status-badge"
                    style={{ color: getStatusColor(archive.finalStatus) }}
                  >
                    {archive.finalStatus}
                  </span>
                </div>
                <div className="archive-item-meta">
                  <span className="archive-meta-tool">
                    {archive.tool} {archive.model && `• ${archive.model}`}
                  </span>
                  <span className="archive-meta-date">
                    {formatDate(archive.archivedAt)}
                  </span>
                  {archive.totalCostUsd !== undefined && (
                    <span className="archive-meta-cost">${archive.totalCostUsd.toFixed(2)}</span>
                  )}
                </div>
              </div>
              <button
                className="archive-restore-btn"
                onClick={() => handleRestore(archive)}
                disabled={restoring === archive.archiveId}
              >
                {restoring === archive.archiveId ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
