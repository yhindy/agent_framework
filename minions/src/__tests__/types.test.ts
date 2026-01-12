import { describe, it, expect } from 'vitest'
import type { AgentTool, Assignment } from '../../types'

describe('AgentTool Type', () => {
  describe('type checking', () => {
    it('should accept claude as a valid AgentTool', () => {
      const tool: AgentTool = 'claude'
      expect(tool).toBe('claude')
    })

    it('should accept cursor as a valid AgentTool', () => {
      const tool: AgentTool = 'cursor'
      expect(tool).toBe('cursor')
    })

    it('should accept cursor-cli as a valid AgentTool', () => {
      const tool: AgentTool = 'cursor-cli'
      expect(tool).toBe('cursor-cli')
    })

    it('should accept codex as a valid AgentTool', () => {
      const tool: AgentTool = 'codex'
      expect(tool).toBe('codex')
    })
  })

  describe('Assignment interface with tool field', () => {
    it('should accept Assignment with tool: claude', () => {
      const assignment: Assignment = {
        id: 'test-1',
        agentId: 'agent-1',
        branch: 'feature/test',
        feature: 'Test Feature',
        status: 'pending',
        specFile: 'spec.md',
        tool: 'claude',
        mode: 'planning'
      }
      expect(assignment.tool).toBe('claude')
    })

    it('should accept Assignment with tool: cursor', () => {
      const assignment: Assignment = {
        id: 'test-1',
        agentId: 'agent-1',
        branch: 'feature/test',
        feature: 'Test Feature',
        status: 'pending',
        specFile: 'spec.md',
        tool: 'cursor',
        mode: 'planning'
      }
      expect(assignment.tool).toBe('cursor')
    })

    it('should accept Assignment with tool: cursor-cli', () => {
      const assignment: Assignment = {
        id: 'test-1',
        agentId: 'agent-1',
        branch: 'feature/test',
        feature: 'Test Feature',
        status: 'pending',
        specFile: 'spec.md',
        tool: 'cursor-cli',
        mode: 'planning'
      }
      expect(assignment.tool).toBe('cursor-cli')
    })

    it('should accept Assignment with tool: codex', () => {
      const assignment: Assignment = {
        id: 'test-1',
        agentId: 'agent-1',
        branch: 'feature/test',
        feature: 'Test Feature',
        status: 'pending',
        specFile: 'spec.md',
        tool: 'codex',
        mode: 'planning'
      }
      expect(assignment.tool).toBe('codex')
    })

    it('should accept Assignment with tool: codex and model specified', () => {
      const assignment: Assignment = {
        id: 'test-1',
        agentId: 'agent-1',
        branch: 'feature/test',
        feature: 'Test Feature',
        status: 'pending',
        specFile: 'spec.md',
        tool: 'codex',
        model: 'gpt-4',
        mode: 'planning'
      }
      expect(assignment.tool).toBe('codex')
      expect(assignment.model).toBe('gpt-4')
    })
  })

  describe('runtime type validation', () => {
    it('should validate that codex is in the valid AgentTool union', () => {
      const validTools: AgentTool[] = ['claude', 'cursor', 'cursor-cli', 'codex']

      validTools.forEach(tool => {
        expect(['claude', 'cursor', 'cursor-cli', 'codex']).toContain(tool)
      })
    })

    it('should handle tool type in conditional logic', () => {
      const getToolName = (tool: AgentTool): string => {
        switch (tool) {
          case 'claude':
            return 'Using Claude'
          case 'cursor':
            return 'Using Cursor'
          case 'cursor-cli':
            return 'Using Cursor CLI'
          case 'codex':
            return 'Using OpenAI Codex'
          default:
            // TypeScript should ensure this is exhaustive
            const _exhaustive: never = tool
            return _exhaustive
        }
      }

      expect(getToolName('codex')).toBe('Using OpenAI Codex')
      expect(getToolName('claude')).toBe('Using Claude')
      expect(getToolName('cursor')).toBe('Using Cursor')
      expect(getToolName('cursor-cli')).toBe('Using Cursor CLI')
    })
  })
})
