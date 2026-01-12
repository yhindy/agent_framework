import { describe, it, expect } from 'vitest'
import type { AgentInfo, Assignment } from '../types/ProjectConfig'

/**
 * Tests for GUI type definitions to ensure they accept 'codex' as a valid tool type.
 * Note: The GUI uses string type for tool field (not the stricter AgentTool union from minions),
 * which allows for flexibility and compatibility with all tool types including 'codex'.
 */
describe('GUI Type Compatibility', () => {
  describe('AgentInfo tool field', () => {
    it('should accept AgentInfo with tool: codex', () => {
      const agentInfo: AgentInfo = {
        id: 'test-id',
        agentId: 'agent-1',
        branch: 'feature/test',
        project: '/path/to/project',
        feature: 'Test Feature',
        status: 'active',
        tool: 'codex',
        mode: 'planning',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivity: '2024-01-01T00:00:00Z'
      }
      expect(agentInfo.tool).toBe('codex')
    })

    it('should accept AgentInfo with tool: codex and model', () => {
      const agentInfo: AgentInfo = {
        id: 'test-id',
        agentId: 'agent-1',
        branch: 'feature/test',
        project: '/path/to/project',
        feature: 'Test Feature',
        status: 'active',
        tool: 'codex',
        model: 'gpt-4',
        mode: 'planning',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivity: '2024-01-01T00:00:00Z'
      }
      expect(agentInfo.tool).toBe('codex')
      expect(agentInfo.model).toBe('gpt-4')
    })

    it('should accept all valid tool types including codex', () => {
      // All valid tool types: claude, cursor, cursor-cli, codex
      const tools = ['claude', 'cursor', 'cursor-cli', 'codex']

      tools.forEach(tool => {
        const agentInfo: AgentInfo = {
          id: 'test-id',
          agentId: 'agent-1',
          branch: 'feature/test',
          project: '/path/to/project',
          feature: 'Test Feature',
          status: 'active',
          tool: tool,
          mode: 'planning',
          createdAt: '2024-01-01T00:00:00Z',
          lastActivity: '2024-01-01T00:00:00Z'
        }
        expect(agentInfo.tool).toBe(tool)
      })
    })
  })

  describe('Assignment tool field (deprecated)', () => {
    it('should accept Assignment with tool: codex', () => {
      const assignment: Assignment = {
        id: 'test-id',
        agentId: 'agent-1',
        feature: 'Test Feature',
        status: 'active',
        tool: 'codex',
        mode: 'planning'
      }
      expect(assignment.tool).toBe('codex')
    })

    it('should accept Assignment with tool: codex and model', () => {
      const assignment: Assignment = {
        id: 'test-id',
        agentId: 'agent-1',
        feature: 'Test Feature',
        status: 'active',
        tool: 'codex',
        model: 'gpt-4',
        mode: 'planning'
      }
      expect(assignment.tool).toBe('codex')
      expect(assignment.model).toBe('gpt-4')
    })
  })

  describe('Tool type as string', () => {
    it('should handle codex as a string value', () => {
      const tool: string = 'codex'
      expect(tool).toBe('codex')
    })

    it('should handle all tool values as strings', () => {
      const tools: string[] = ['claude', 'cursor', 'cursor-cli', 'codex']
      expect(tools).toEqual(['claude', 'cursor', 'cursor-cli', 'codex'])
    })
  })
})
