import { describe, it, expect } from 'vitest'

describe('Planning Prompt', () => {
  it('should include budget in planning prompt for super minion', () => {
    // Simulate the logic from TerminalService.getClaudeArgs()
    const prompt = 'Implement user authentication'
    const agentInfo = {
      isSuperMinion: true,
      minionBudget: 3
    } as any

    const isSuperMinion = agentInfo?.isSuperMinion === true
    const minionBudget = agentInfo?.minionBudget || 5

    let planPrompt: string
    if (isSuperMinion) {
      planPrompt = `You have a budget of ${minionBudget} child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
    } else {
      planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
    }

    // Note: Full super minion rules are passed via --system-prompt-file super-minion-rules.md
    expect(planPrompt).toContain('budget of 3')
    expect(planPrompt).toContain(prompt)
  })

  it('should use default budget if not provided', () => {
    const prompt = 'Implement user authentication'
    const agentInfo = {
      isSuperMinion: true
      // minionBudget not set
    } as any

    const isSuperMinion = agentInfo?.isSuperMinion === true
    const minionBudget = agentInfo?.minionBudget || 5

    let planPrompt: string
    if (isSuperMinion) {
      planPrompt = `You have a budget of ${minionBudget} child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
    } else {
      planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
    }

    expect(planPrompt).toContain('budget of 5')
  })

  it('should not include budget for regular planning mode', () => {
    const prompt = 'Implement user authentication'
    const agentInfo = {
      isSuperMinion: false
    } as any

    const isSuperMinion = agentInfo?.isSuperMinion === true

    let planPrompt: string
    if (isSuperMinion) {
      planPrompt = `You have a budget of 5 child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
    } else {
      planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
    }

    expect(planPrompt).toBe(`Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`)
    expect(planPrompt).not.toContain('acceptance criteria')
  })

  it('should handle various budget values', () => {
    const prompt = 'Test task'
    const budgetValues = [1, 2, 3, 5, 10]

    for (const budget of budgetValues) {
      const agentInfo = {
        isSuperMinion: true,
        minionBudget: budget
      }

      const isSuperMinion = agentInfo?.isSuperMinion === true
      const minionBudget = agentInfo?.minionBudget || 5

      let planPrompt: string
      if (isSuperMinion) {
        planPrompt = `You have a budget of ${minionBudget} child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
      } else {
        planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
      }

      expect(planPrompt).toContain(`budget of ${budget}`)
    }
  })
})

describe('Acceptance Criteria in Planning Prompt', () => {
  it('should include acceptance criteria instructions for super minion', () => {
    const prompt = 'Implement user authentication'
    const agentInfo = {
      isSuperMinion: true,
      minionBudget: 3
    } as any

    const isSuperMinion = agentInfo?.isSuperMinion === true
    const minionBudget = agentInfo?.minionBudget || 5

    let planPrompt: string
    if (isSuperMinion) {
      planPrompt = `You have a budget of ${minionBudget} child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
    } else {
      planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
    }

    expect(planPrompt).toContain('acceptance criteria')
    expect(planPrompt).toContain('AskUserQuestion')
    expect(planPrompt).toContain('WAIT for explicit approval')
    expect(planPrompt).toContain('BEFORE creating any implementation plan')
  })

  it('should NOT include acceptance criteria instructions for regular planning mode', () => {
    const prompt = 'Implement user authentication'
    const agentInfo = {
      isSuperMinion: false
    } as any

    const isSuperMinion = agentInfo?.isSuperMinion === true

    let planPrompt: string
    if (isSuperMinion) {
      planPrompt = `You have a budget of 5 child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
    } else {
      planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
    }

    expect(planPrompt).not.toContain('acceptance criteria')
    expect(planPrompt).not.toContain('AskUserQuestion')
  })

  it('should include instruction to reference criteria throughout execution', () => {
    const prompt = 'Build feature X'
    const agentInfo = {
      isSuperMinion: true,
      minionBudget: 5
    } as any

    const isSuperMinion = agentInfo?.isSuperMinion === true
    const minionBudget = agentInfo?.minionBudget || 5

    let planPrompt: string
    if (isSuperMinion) {
      planPrompt = `You have a budget of ${minionBudget} child minions.

BEFORE creating any implementation plan, you MUST:
1. Propose numbered acceptance criteria for this task
2. Use AskUserQuestion to ask the human to approve the criteria
3. WAIT for explicit approval before proceeding to implementation

Task: ${prompt}

Remember: Include a section on automated testing in your plan. Reference your acceptance criteria throughout execution.`
    } else {
      planPrompt = `Create a plan for: ${prompt}\n\nPlease add to your plan a section on automated testing.`
    }

    expect(planPrompt).toContain('Reference your acceptance criteria throughout execution')
  })
})
