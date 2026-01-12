import { describe, it, expect } from 'vitest'

// Helper function to construct planning prompt - mirrors TerminalService.getClaudeArgs() logic
function buildPlanningPrompt(taskPrompt: string, agentInfo: { isSuperMinion?: boolean }): string {
  const isSuperMinion = agentInfo?.isSuperMinion === true

  if (isSuperMinion) {
    return `You are a Super Minion. Follow the 5-PHASE WORKFLOW exactly:

PHASE 1 - ACCEPTANCE CRITERIA (do this first):
1. Explore the codebase to understand context
2. Propose numbered acceptance criteria for this task
3. Use AskUserQuestion to ask the human to approve the criteria
4. WAIT for explicit "Yes, proceed" before moving to Phase 2

PHASE 2 - ENGINEERING DESIGN (MANDATORY - do NOT skip):
1. Spawn a Plan agent to create .engineering-design.md
2. The design must map each criterion to implementation details

PHASE 3 - DESIGN REVIEW (MANDATORY - do NOT skip):
1. Spawn two review agents IN PARALLEL: senior engineer + criteria validator
2. Only proceed to Phase 4 after both reviewers approve

PHASE 4 - IMPLEMENTATION:
1. Spawn implementation agents based on the approved design
2. Use parallel agents for independent components

PHASE 5 - VERIFICATION:
1. Spawn THREE agents IN PARALLEL: code simplifier + test runner + acceptance criteria checker
2. Only declare completion when all three pass

Task: ${taskPrompt}

CRITICAL: Execute phases in order (1→2→3→4→5). NEVER skip the design or review phases. NEVER jump straight to implementation after acceptance criteria.`
  } else {
    return `Create a plan for: ${taskPrompt}\n\nPlease add to your plan a section on automated testing.`
  }
}

// Common test data
const TEST_PROMPT = 'Implement user authentication'

describe('Planning Prompt', () => {
  it('should include 5-phase workflow for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain('5-PHASE WORKFLOW')
    expect(planPrompt).toContain('PHASE 1')
    expect(planPrompt).toContain('PHASE 2')
    expect(planPrompt).toContain('PHASE 3')
    expect(planPrompt).toContain('PHASE 4')
    expect(planPrompt).toContain('PHASE 5')
    expect(planPrompt).toContain(TEST_PROMPT)
  })

  it('should include parallelism instructions for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain('IN PARALLEL')
    expect(planPrompt).toContain('parallel agents')
  })

  it('should not include 5-phase workflow for regular planning mode', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: false })

    expect(planPrompt).toBe(`Create a plan for: ${TEST_PROMPT}\n\nPlease add to your plan a section on automated testing.`)
    expect(planPrompt).not.toContain('PHASE')
    expect(planPrompt).not.toContain('acceptance criteria')
  })
})

describe('Acceptance Criteria in Planning Prompt', () => {
  const ACCEPTANCE_CRITERIA_KEYWORDS = [
    'ACCEPTANCE CRITERIA',
    'AskUserQuestion',
    'WAIT for explicit',
    'PHASE 1'
  ]

  it('should include acceptance criteria instructions for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    ACCEPTANCE_CRITERIA_KEYWORDS.forEach(keyword => {
      expect(planPrompt).toContain(keyword)
    })
  })

  it('should NOT include acceptance criteria instructions for regular planning mode', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: false })

    expect(planPrompt).not.toContain('ACCEPTANCE CRITERIA')
    expect(planPrompt).not.toContain('AskUserQuestion')
  })
})

describe('Engineering Design Phase in Planning Prompt', () => {
  it('should include mandatory engineering design phase for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain('PHASE 2 - ENGINEERING DESIGN')
    expect(planPrompt).toContain('MANDATORY')
    expect(planPrompt).toContain('.engineering-design.md')
    expect(planPrompt).toContain('Plan agent')
  })

  it('should include mandatory design review phase for super minion', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain('PHASE 3 - DESIGN REVIEW')
    expect(planPrompt).toContain('senior engineer')
    expect(planPrompt).toContain('criteria validator')
  })
})

describe('Critical Warning in Planning Prompt', () => {
  it('should include critical warning about not skipping phases', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain('CRITICAL')
    expect(planPrompt).toContain('NEVER skip')
    expect(planPrompt).toContain('1→2→3→4→5')
  })

  it('should warn against jumping straight to implementation', () => {
    const planPrompt = buildPlanningPrompt(TEST_PROMPT, { isSuperMinion: true })

    expect(planPrompt).toContain('NEVER jump straight to implementation')
  })
})
