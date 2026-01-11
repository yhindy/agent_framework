import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Super Minion Rules File', () => {
  let rulesContent: string

  beforeAll(() => {
    const rulesPath = join(__dirname, '../../../../resources/minions/rules/super-minion-rules.md')
    rulesContent = readFileSync(rulesPath, 'utf-8')
  })

  it('should contain AskUserQuestion instruction for acceptance criteria', () => {
    expect(rulesContent).toContain('AskUserQuestion')
    expect(rulesContent).toMatch(/acceptance criteria/i)
  })

  it('should contain STOP/WAIT instruction before implementation', () => {
    expect(rulesContent).toMatch(/STOP|WAIT/i)
    expect(rulesContent).toContain('BEFORE')
  })

  it('should contain instructions to reference criteria during execution', () => {
    expect(rulesContent).toContain('Referencing Criteria During Execution')
    expect(rulesContent).toMatch(/Reference.*criterion|criterion.*Reference/i)
  })

  it('should contain verification requirement at completion', () => {
    expect(rulesContent).toContain('Completion')
    expect(rulesContent).toMatch(/verify|satisfied|met/i)
  })

  it('should contain explicit approval requirement', () => {
    expect(rulesContent).toMatch(/explicit.*approval|approval.*explicit|confirmation/i)
  })

  it('should have CRITICAL section about acceptance criteria workflow', () => {
    expect(rulesContent).toContain('CRITICAL: Acceptance Criteria Workflow')
    expect(rulesContent).toContain('STOP! Before ANY implementation')
  })

  it('should have MANDATORY Phase 1 section', () => {
    expect(rulesContent).toContain('Phase 1: Acceptance Criteria (MANDATORY)')
    expect(rulesContent).toContain('BLOCKING REQUIREMENT')
  })

  it('should instruct not to spawn Task subagents before approval', () => {
    expect(rulesContent).toContain('DO NOT spawn any Task subagents')
    expect(rulesContent).toMatch(/until criteria are approved|before.*approval/i)
  })

  it('should include example of referencing criteria when spawning subagents', () => {
    expect(rulesContent).toContain('This task addresses Criterion')
    expect(rulesContent).toMatch(/Criterion #\d+/i)
  })

  it('should require listing each criterion at completion', () => {
    expect(rulesContent).toContain('List each agreed criterion')
    expect(rulesContent).toContain('State how it was satisfied')
  })

  it('should require asking clarifying questions BEFORE proposing criteria', () => {
    expect(rulesContent).toContain('Ask clarifying questions FIRST')
    expect(rulesContent).toContain('NEVER include open questions IN the acceptance criteria')
    expect(rulesContent).toContain('ASK questions first, THEN propose concrete criteria')
  })

  it('should prohibit ambiguity and conditionals in acceptance criteria', () => {
    expect(rulesContent).toContain('No questions, no ambiguity')
    expect(rulesContent).toContain('concrete and testable')
  })
})
