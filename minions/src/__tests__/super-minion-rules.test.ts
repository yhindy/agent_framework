import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Super Minion Rules', () => {
  const rulesPath = join(__dirname, '../../rules/super-minion-rules.md')
  let rulesContent: string

  beforeAll(() => {
    rulesContent = readFileSync(rulesPath, 'utf-8')
  })

  describe('file structure', () => {
    it('should exist and be readable', () => {
      expect(rulesContent).toBeDefined()
      expect(rulesContent.length).toBeGreaterThan(0)
    })

    it('should have valid markdown structure', () => {
      // Check for main title
      expect(rulesContent).toContain('# Super Minion Protocol')
    })
  })

  describe('5-phase workflow', () => {
    it('should contain Phase 1: Acceptance Criteria', () => {
      expect(rulesContent).toContain('## Phase 1: Acceptance Criteria')
    })

    it('should contain Phase 2: Engineering Design marked as MANDATORY', () => {
      expect(rulesContent).toContain('## Phase 2: Engineering Design (MANDATORY)')
    })

    it('should contain Phase 3: Design Review marked as MANDATORY', () => {
      expect(rulesContent).toContain('## Phase 3: Design Review (MANDATORY)')
    })

    it('should contain Phase 4: Implementation', () => {
      expect(rulesContent).toContain('## Phase 4: Implementation')
    })

    it('should contain Phase 5: Verification', () => {
      expect(rulesContent).toContain('## Phase 5: Verification')
    })
  })

  describe('subagent types', () => {
    it('should reference Plan subagent type', () => {
      expect(rulesContent).toContain('subagent_type="Plan"')
    })

    it('should reference general-purpose subagent type', () => {
      expect(rulesContent).toContain('subagent_type="general-purpose"')
    })

    it('should reference code-simplifier subagent type', () => {
      expect(rulesContent).toContain('subagent_type="code-simplifier"')
    })

    it('should reference debugger subagent type', () => {
      expect(rulesContent).toContain('subagent_type="debugger"')
    })

    it('should reference Explore subagent type', () => {
      expect(rulesContent).toContain('`Explore`')
    })
  })

  describe('key workflow elements', () => {
    it('should have critical warning about not skipping phases', () => {
      expect(rulesContent).toContain('CRITICAL: You MUST execute phases in order')
      expect(rulesContent).toContain('NEVER skip phases')
    })

    it('should have NEXT markers between phases', () => {
      expect(rulesContent).toContain('→ NEXT: Proceed to Phase 2')
      expect(rulesContent).toContain('→ NEXT: Proceed to Phase 3')
      expect(rulesContent).toContain('→ NEXT: Proceed to Phase 4')
    })

    it('should mention AskUserQuestion for human interaction', () => {
      expect(rulesContent).toContain('AskUserQuestion')
    })

    it('should mention Task tool for spawning subagents', () => {
      expect(rulesContent).toContain('Task(')
    })

    it('should mention engineering design document', () => {
      expect(rulesContent).toContain('.engineering-design.md')
    })

    it('should mention TDD approach', () => {
      expect(rulesContent).toContain('TDD')
    })

    it('should mention parallel execution', () => {
      expect(rulesContent).toMatch(/parallel/i)
    })
  })

  describe('review agents', () => {
    it('should include senior engineer review', () => {
      expect(rulesContent).toContain('Senior engineer review')
    })

    it('should include criteria validation', () => {
      expect(rulesContent).toContain('Criteria validation')
    })

    it('should define APPROVE/NEEDS_REVISION/REJECT outputs', () => {
      expect(rulesContent).toContain('APPROVE')
      expect(rulesContent).toContain('NEEDS_REVISION')
      expect(rulesContent).toContain('REJECT')
    })
  })

  describe('verification phase', () => {
    it('should include code simplifier agent', () => {
      expect(rulesContent).toContain('Simplify implementation')
    })

    it('should include test runner agent', () => {
      expect(rulesContent).toContain('Run tests')
    })

    it('should include acceptance criteria checker agent', () => {
      expect(rulesContent).toContain('Verify acceptance criteria')
    })

    it('should include documentation writer agent', () => {
      expect(rulesContent).toContain('Update documentation')
    })

    it('should define UPDATED/NO_CHANGES outputs for documentation', () => {
      expect(rulesContent).toContain('**UPDATED**')
      expect(rulesContent).toContain('**NO_CHANGES**')
    })

    it('should spawn all four verification agents in parallel', () => {
      expect(rulesContent).toContain('spawn all four agents in ONE message')
    })

    it('should define PASS/FAIL outputs', () => {
      expect(rulesContent).toContain('**PASS**')
      expect(rulesContent).toContain('**FAIL**')
    })
  })

  describe('completion requirements', () => {
    it('should mention verifying acceptance criteria', () => {
      expect(rulesContent).toContain('verify EACH acceptance criterion')
    })

    it('should mention running final verification', () => {
      expect(rulesContent).toContain('final verification')
    })
  })

  describe('nested Super Minion spawning', () => {
    it('should contain Spawning Super Minion Subagents section', () => {
      expect(rulesContent).toContain('## Spawning Super Minion Subagents')
    })

    it('should document human approval mode', () => {
      expect(rulesContent).toContain('APPROVAL_AUTHORITY: human')
    })

    it('should document parent approval mode', () => {
      expect(rulesContent).toContain('APPROVAL_AUTHORITY: parent')
    })

    it('should document pre-approved mode', () => {
      expect(rulesContent).toContain('APPROVAL_AUTHORITY: pre-approved')
    })

    it('should document CRITERIA_PROPOSAL return format', () => {
      expect(rulesContent).toContain('CRITERIA_PROPOSAL')
    })

    it('should document nesting limits', () => {
      expect(rulesContent).toContain('Maximum depth')
    })

    it('should document super-minion-config XML tag', () => {
      expect(rulesContent).toContain('<super-minion-config>')
    })

    it('should document exploration context pass-through', () => {
      expect(rulesContent).toContain('exploration_summary')
    })
  })
})
