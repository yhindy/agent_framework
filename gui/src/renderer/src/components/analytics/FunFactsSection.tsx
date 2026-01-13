import type { FunFact } from '../../../../shared/types/analytics'
import './FunFactsSection.css'

interface FunFactsSectionProps {
  facts: FunFact[]
}

const FACT_COLORS = [
  { bg: 'rgba(78, 201, 176, 0.12)', border: 'rgba(78, 201, 176, 0.3)', accent: '#4ec9b0' },
  { bg: 'rgba(156, 220, 254, 0.12)', border: 'rgba(156, 220, 254, 0.3)', accent: '#9cdcfe' },
  { bg: 'rgba(220, 220, 170, 0.12)', border: 'rgba(220, 220, 170, 0.3)', accent: '#dcdcaa' },
  { bg: 'rgba(206, 145, 120, 0.12)', border: 'rgba(206, 145, 120, 0.3)', accent: '#ce9178' },
  { bg: 'rgba(197, 134, 192, 0.12)', border: 'rgba(197, 134, 192, 0.3)', accent: '#c586c0' },
  { bg: 'rgba(86, 156, 214, 0.12)', border: 'rgba(86, 156, 214, 0.3)', accent: '#569cd6' }
]

function FunFactsSection({ facts }: FunFactsSectionProps): JSX.Element | null {
  if (!facts || facts.length === 0) {
    return null
  }

  return (
    <section className="fun-facts-section">
      <h2 className="section-title">
        <span className="section-icon">✨</span>
        Fun Facts
      </h2>
      <div className="fun-facts-grid">
        {facts.map((fact, index) => {
          const colors = FACT_COLORS[index % FACT_COLORS.length]
          return (
            <div
              key={fact.id}
              className="fun-fact-card"
              style={{
                background: colors.bg,
                borderColor: colors.border
              }}
            >
              <div className="fun-fact-icon" style={{ color: colors.accent }}>
                {fact.icon}
              </div>
              <div className="fun-fact-content">
                <div className="fun-fact-title">{fact.title}</div>
                <div className="fun-fact-value" style={{ color: colors.accent }}>
                  {fact.value}
                </div>
                {fact.description && (
                  <div className="fun-fact-description">{fact.description}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default FunFactsSection
