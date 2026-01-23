# Plan: Super Minion Prompt as a Skill

## Overview

Convert the super minion protocol (`super-minion-rules.md`) into a skill format that can be passed to Claude via the skills system, with templated steps and reinforced acceptance criteria stopping.

## Current State

1. **Static rules file**: `minions/rules/super-minion-rules.md` (537 lines)
2. **Dynamic generation**: `WorkflowService.generateRulesMarkdown()` generates workflow-specific rules
3. **Passed to Claude via**: `--system-prompt-file [path]` flag in `TerminalService.getClaudeArgs()`
4. **Skills format**: YAML frontmatter + markdown body with `promptContent`

## Key Challenges

1. **Templating**: The prompt needs dynamic sections that vary per workflow:
   - Workflow steps (from WorkflowConfig)
   - Available agents/skills
   - User's mission/goal

2. **Reinforcing acceptance criteria**: Must STOP and get human approval before proceeding

3. **Skill compatibility**: Skills are currently used as subagent types, not as system prompts

## Proposed Approach

### Phase 1: Create a Templated Super Skill

Create a new skill format that supports template variables:

```markdown
---
name: "Super Minion"
description: "Autonomous orchestrator for complex features using structured workflow"
skillType: "orchestrator"
templateVariables:
  - name: "STEPS"
    description: "Workflow steps to execute"
    required: true
  - name: "AVAILABLE_AGENTS"
    description: "List of available subagent types"
    required: true
  - name: "USER_GOAL"
    description: "The user's mission/task"
    required: true
---

# Super Minion Protocol

You are a **Super Minion** - an autonomous orchestrator...

## Your Mission
{{USER_GOAL}}

## Workflow Steps
{{STEPS}}

## Available Agents
{{AVAILABLE_AGENTS}}

## CRITICAL: Acceptance Criteria Gate

⚠️ **MANDATORY STOP POINT** ⚠️

Before proceeding past Phase 1, you MUST:

1. Propose clear, numbered, testable acceptance criteria
2. Use `AskUserQuestion` to get explicit approval:
   ```
   AskUserQuestion(questions=[{
     "question": "Do you agree with these acceptance criteria?",
     ...
   }])
   ```
3. **WAIT** for "Yes, proceed" response
4. **DO NOT** continue to Phase 2 until criteria are approved

This is a hard gate. Skipping this step is a protocol violation.

... rest of protocol ...
```

### Phase 2: Template Variable Substitution

Modify `TerminalService` or create a new `SkillTemplateService` to:

1. Load the skill file
2. Parse template variables from frontmatter
3. Substitute `{{VAR}}` patterns with actual values
4. Return the rendered markdown

```typescript
interface SkillTemplate {
  name: string
  description: string
  skillType: 'orchestrator' | 'subagent' | 'command'
  templateVariables?: TemplateVariable[]
  promptContent: string  // Raw template
}

interface TemplateVariable {
  name: string
  description: string
  required: boolean
  defaultValue?: string
}

class SkillTemplateService {
  renderSkill(skill: SkillTemplate, variables: Record<string, string>): string {
    let content = skill.promptContent
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    return content
  }
}
```

### Phase 3: Reinforce Acceptance Criteria Stopping

Add multiple reinforcement mechanisms:

1. **Visual emphasis in template**: Use `⚠️`, `**CRITICAL**`, boxes
2. **Explicit gate language**: "MANDATORY STOP POINT", "protocol violation"
3. **Negative instructions**: "DO NOT continue", "NEVER skip"
4. **Phase transition guards**: Each phase starts with "Prerequisite: Phase N-1 completed with approval"

Example reinforcement section:

```markdown
## Phase Transition Protocol

### Before Each Phase Transition

| From | To | Gate Check |
|------|-----|------------|
| Start | Phase 1 | None |
| Phase 1 | Phase 2 | **REQUIRES** explicit "Yes, proceed" from human |
| Phase 2 | Phase 3 | Design document exists |
| Phase 3 | Phase 4 | Reviews complete (APPROVE or addressed) |
| Phase 4 | Phase 5 | All implementation agents complete |

⚠️ **Phase 1 → Phase 2 is the CRITICAL GATE** ⚠️

You MUST receive explicit human approval of acceptance criteria before ANY implementation work.

If you find yourself writing code before criteria are approved, STOP IMMEDIATELY and return to Phase 1.
```

### Phase 4: Integration Points

1. **Skill storage location**:
   - Global: `~/.claude/skills/super-minion/SKILL.md`
   - Or bundled: `gui/resources/minions/skills/super-minion/SKILL.md`

2. **Loading mechanism**:
   - `UnifiedSkillsService` already scans for skills
   - Add new skill type: `'orchestrator'` (distinct from `'command'` or `'agent'`)
   - Orchestrator skills can be used as system prompts, not just subagent types

3. **Usage in TerminalService**:
   ```typescript
   // In getClaudeArgs() or getSuperMinionRulesPath()
   if (isSuperMinion) {
     const skill = await skillService.getOrchestratorSkill('super-minion')
     const rendered = skillTemplateService.renderSkill(skill, {
       STEPS: this.generateStepsMarkdown(workflow),
       AVAILABLE_AGENTS: this.generateAgentsMarkdown(),
       USER_GOAL: prompt
     })
     // Write to temp file and pass via --system-prompt-file
   }
   ```

## File Changes Required

| File | Change |
|------|--------|
| `gui/src/main/services/types/SkillsLibraryTypes.ts` | Add `TemplateVariable` type, `skillType` field |
| `gui/src/main/services/SkillTemplateService.ts` | **NEW** - Template rendering logic |
| `gui/src/main/services/TerminalService.ts` | Use skill template instead of static rules |
| `gui/src/main/services/WorkflowService.ts` | Refactor `generateRulesMarkdown()` to provide template variables |
| `gui/resources/minions/skills/super-minion/SKILL.md` | **NEW** - The templated skill file |

## Benefits

1. **Customizable**: Users can modify the skill or create variants
2. **Discoverable**: Appears in Skills Library UI
3. **Consistent format**: Uses existing skill infrastructure
4. **Reinforced stopping**: Multiple mechanisms to ensure criteria approval
5. **Maintainable**: Single source of truth for super minion behavior

## Open Questions

1. Should orchestrator skills be a separate category in the UI?
2. Should users be able to override the built-in super minion skill with a project-local one?
3. Should template variables be validated at parse time or render time?
4. Should we support nested templates (e.g., `{{#each STEPS}}...{{/each}}`)?

## Next Steps

1. Create the templated SKILL.md file with reinforced acceptance criteria language
2. Add `TemplateVariable` types to SkillsLibraryTypes
3. Create `SkillTemplateService` for variable substitution
4. Modify `TerminalService.getSuperMinionRulesPath()` to use the skill template
5. Test with various workflows to ensure template substitution works correctly
6. Add tests for template rendering edge cases
