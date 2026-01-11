import { describe, it, expect } from 'vitest'

// Helper function to construct planning prompt - mirrors TerminalService.getClaudeArgs() logic
function buildPlanningPrompt(taskPrompt: string, agentInfo: { isSuperMinion?: boolean }): string {
  const isSuperMinion = agentInfo?.isSuperMinion === true

  if (isSuperMinion) {
    return `BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${taskPrompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.

You can spawn as many child agents as needed to complete the task quickly. Maximize parallelism by breaking work into independent subtasks that can run concurrently.`
  } else {
    return `Create a plan for: ${taskPrompt}\n\nPlease add to your plan a section on automated testing.`
  }
}

// Common test data
const TEST_PROMPT = 'Implement user authentication'

describe('Planning Prompt', () => {
  it('should include parallelism encouragement for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain('spawn as many child agents as needed')
    expect(planPrompt).toContain('Maximize parallelism')
    expect(planPrompt).toContain(TEST_PROMPT)
  })

  it('should not include parallelism encouragement for regular planning mode', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: false })

    expect(planPrompt).toBe(`Create a plan for: ${TEST_PROMPT}\n\nPlease add to your plan a section on automated testing.`)
    expect(planPrompt).not.toContain('acceptance criteria')
    expect(planPrompt).not.toContain('child agents')
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
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

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
    const planPrompt = buildPlanningPrompt('Build feature X', { isSuperMinion: true })

    expect(planPrompt).toContain('Reference your acceptance criteria throughout execution')
  })
})
