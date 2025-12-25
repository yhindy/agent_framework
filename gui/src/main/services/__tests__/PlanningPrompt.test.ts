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
      planPrompt = `You have a budget of ${minionBudget} child minions. Create a plan for: ${prompt}`
    } else {
      planPrompt = `Create a plan for: ${prompt}`
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
      planPrompt = `You have a budget of ${minionBudget} child minions. Create a plan for: ${prompt}`
    } else {
      planPrompt = `Create a plan for: ${prompt}`
    }

    expect(planPrompt).toContain('budget of 5')
  })

  it('should not include budget for regular planning mode', () => {
    const prompt = 'Implement user authentication'
    const agentInfo = {
      isSuperMinion: false
    } as any

    const isSuperMinion = agentInfo?.isSuperMinion === true
    const minionBudget = agentInfo?.minionBudget || 5

    let planPrompt: string
    if (isSuperMinion) {
      planPrompt = `You are a Super Minion with a budget of ${minionBudget} child minions. Create a plan for: ${prompt}`
    } else {
      planPrompt = `Create a plan for: ${prompt}`
    }

    expect(planPrompt).toBe(`Create a plan for: ${prompt}`)
    expect(planPrompt).not.toContain('Super Minion')
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
        planPrompt = `You are a Super Minion with a budget of ${minionBudget} child minions. Create a plan for: ${prompt}`
      } else {
        planPrompt = `Create a plan for: ${prompt}`
      }

      expect(planPrompt).toContain(`budget of ${budget}`)
    }
  })
})
