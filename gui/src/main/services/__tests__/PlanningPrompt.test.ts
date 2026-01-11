import { describe, it, expect } from 'vitest'

// Helper function to construct planning prompt - mirrors TerminalService.getClaudeArgs() logic
function buildPlanningPrompt(taskPrompt: string, agentInfo: { isSuperMinion?: boolean; minionBudget?: number }): string {
  const isSuperMinion = agentInfo?.isSuperMinion === true
  const minionBudget = agentInfo?.minionBudget || 5

  if (isSuperMinion) {
    return `You have a budget of ${minionBudget} child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${taskPrompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
  } else {
    return `Create a plan for: ${taskPrompt}\n\nPlease add to your plan a section on automated testing.`
  }
}

// Common test data
const TEST_PROMPT = 'Implement user authentication'
const DEFAULT_BUDGET = 5

describe('Planning Prompt', () => {
  it('should include budget in planning prompt for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true, minionBudget: 3 })

    expect(planPrompt).toContain('budget of 3')
    expect(planPrompt).toContain(TEST_PROMPT)
  })

  it('should use default budget if not provided', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain(`budget of ${DEFAULT_BUDGET}`)
  })

  it('should not include budget for regular planning mode', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: false })

    expect(planPrompt).toBe(`Create a plan for: ${TEST_PROMPT}\n\nPlease add to your plan a section on automated testing.`)
    expect(planPrompt).not.toContain('acceptance criteria')
  })

  it('should handle various budget values', () => {
    const budgetValues = [1, 2, 3, 5, 10]

    budgetValues.forEach(budget => {
      const planPrompt = buildPlanningPrompt('Test task', { isSuperMinion: true, minionBudget: budget })
      expect(planPrompt).toContain(`budget of ${budget}`)
    })
  })
})

describe('Acceptance Criteria in Planning Prompt', () => {
  const ACCEPTANCE_CRITERIA_KEYWORDS = [
    'acceptance criteria',
    'AskUserQuestion',
    'WAIT for explicit approval',
    'BEFORE creating any implementation plan'
  ]

  it('should include acceptance criteria instructions for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true, minionBudget: 3 })

    ACCEPTANCE_CRITERIA_KEYWORDS.forEach(keyword => {
      expect(planPrompt).toContain(keyword)
    })
  })

  it('should NOT include acceptance criteria instructions for regular planning mode', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: false })

    expect(planPrompt).not.toContain('acceptance criteria')
    expect(planPrompt).not.toContain('AskUserQuestion')
  })

  it('should include instruction to reference criteria throughout execution', () => {
    const planPrompt = buildPlanningPrompt('Build feature X', { isSuperMinion: true, minionBudget: 5 })

    expect(planPrompt).toContain('Reference your acceptance criteria throughout execution')
  })
})
