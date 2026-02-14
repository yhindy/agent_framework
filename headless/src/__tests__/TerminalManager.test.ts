import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TerminalManager } from '../TerminalManager'

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn()
}))

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true)
}))

import { execSync, execFileSync } from 'child_process'

describe('TerminalManager', () => {
  let tm: TerminalManager

  beforeEach(() => {
    vi.clearAllMocks()
    tm = new TerminalManager()
  })

  describe('getTmuxSessionName', () => {
    it('should create valid session names', () => {
      expect(tm.getTmuxSessionName('agent-1')).toBe('minion-agent-1')
      expect(tm.getTmuxSessionName('my-project-5')).toBe('minion-my-project-5')
    })

    it('should sanitize special characters', () => {
      expect(tm.getTmuxSessionName('agent/with:special.chars')).toBe('minion-agent_with_special_chars')
      expect(tm.getTmuxSessionName('evil;rm -rf /')).toBe('minion-evil_rm_-rf__')
    })
  })

  describe('isTmuxAvailable', () => {
    it('should return true when tmux is installed', () => {
      (execSync as any).mockReturnValue('/usr/bin/tmux\n')
      expect(tm.isTmuxAvailable()).toBe(true)
    })

    it('should return false when tmux is not installed', () => {
      (execSync as any).mockImplementation(() => { throw new Error('not found') })
      // Reset cached value
      tm = new TerminalManager()
      expect(tm.isTmuxAvailable()).toBe(false)
    })

    it('should cache the result', () => {
      (execSync as any).mockReturnValue('/usr/bin/tmux\n')
      tm.isTmuxAvailable()
      tm.isTmuxAvailable()
      expect(execSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('tmuxSessionExists', () => {
    it('should return true for existing sessions', () => {
      (execSync as any).mockReturnValue('/usr/bin/tmux\n') // for isTmuxAvailable
      ;(execFileSync as any).mockReturnValue('')
      expect(tm.tmuxSessionExists('minion-agent-1')).toBe(true)
    })

    it('should return false for non-existing sessions', () => {
      (execSync as any).mockReturnValue('/usr/bin/tmux\n')
      ;(execFileSync as any).mockImplementation(() => { throw new Error('no session') })
      expect(tm.tmuxSessionExists('minion-nonexistent')).toBe(false)
    })
  })

  describe('killTmuxSession', () => {
    it('should kill session silently', () => {
      (execFileSync as any).mockReturnValue('')
      tm.killTmuxSession('agent-1')
      expect(execFileSync).toHaveBeenCalledWith(
        'tmux',
        ['kill-session', '-t', 'minion-agent-1'],
        expect.any(Object)
      )
    })

    it('should not throw if session does not exist', () => {
      (execFileSync as any).mockImplementation(() => { throw new Error('no session') })
      expect(() => tm.killTmuxSession('agent-1')).not.toThrow()
    })
  })

  describe('stopAgent', () => {
    it('should kill tmux session and remove from running set', () => {
      (execFileSync as any).mockReturnValue('')
      tm.stopAgent('agent-1')
      expect(tm.getRunningAgents()).not.toContain('agent-1')
    })
  })

  describe('cleanup', () => {
    it('should clear running agents', () => {
      (execFileSync as any).mockReturnValue('')
      tm.cleanup()
      expect(tm.getRunningAgents()).toHaveLength(0)
    })
  })
})
