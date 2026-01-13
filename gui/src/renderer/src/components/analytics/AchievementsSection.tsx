import type { Achievement } from '../../../../shared/types/analytics'
import './AchievementsSection.css'

interface AchievementsSectionProps {
  achievements: Achievement[]
}

function AchievementsSection({ achievements }: AchievementsSectionProps): JSX.Element | null {
  if (!achievements || achievements.length === 0) {
    return null
  }

  // Sort achievements: unlocked first, then by progress (higher first), then locked
  const sortedAchievements = [...achievements].sort((a, b) => {
    const aUnlocked = !!a.unlockedAt
    const bUnlocked = !!b.unlockedAt
    if (aUnlocked && !bUnlocked) return -1
    if (!aUnlocked && bUnlocked) return 1
    // Both same locked state - sort by progress
    const aProgress = a.progress ?? 0
    const bProgress = b.progress ?? 0
    return bProgress - aProgress
  })

  const unlockedCount = achievements.filter((a) => a.unlockedAt).length

  return (
    <section className="achievements-section">
      <h2 className="section-title">
        <span className="section-icon">🏆</span>
        Achievements
        <span className="achievement-count">
          {unlockedCount}/{achievements.length}
        </span>
      </h2>
      <div className="achievements-grid">
        {sortedAchievements.map((achievement) => {
          const isUnlocked = !!achievement.unlockedAt
          const hasProgress = !isUnlocked && achievement.progress !== undefined && achievement.progress > 0

          return (
            <div
              key={achievement.id}
              className={`achievement-card ${isUnlocked ? 'unlocked' : 'locked'}`}
            >
              <div className={`achievement-icon ${isUnlocked ? 'glow' : ''}`}>
                {achievement.icon}
              </div>
              <div className="achievement-content">
                <div className="achievement-title">{achievement.title}</div>
                <div className="achievement-description">{achievement.description}</div>
                {hasProgress && (
                  <div className="achievement-progress-container">
                    <div className="achievement-progress-bar">
                      <div
                        className="achievement-progress-fill"
                        style={{ width: `${achievement.progress}%` }}
                      />
                    </div>
                    <span className="achievement-progress-text">
                      {Math.round(achievement.progress!)}%
                    </span>
                  </div>
                )}
                {isUnlocked && achievement.unlockedAt && (
                  <div className="achievement-unlocked-date">
                    Unlocked {formatDate(achievement.unlockedAt)}
                  </div>
                )}
              </div>
              {isUnlocked && <div className="achievement-checkmark">✓</div>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  } catch {
    return isoDate
  }
}

export default AchievementsSection
