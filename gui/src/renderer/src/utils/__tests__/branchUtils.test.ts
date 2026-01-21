import { describe, it, expect } from 'vitest'
import { extractBranchName } from '../branchUtils'

describe('branchUtils', () => {
  describe('extractBranchName', () => {
    it('extracts descriptive part from standard format: feature/project-id/branch-name', () => {
      const result = extractBranchName('feature/test-project/add-dark-mode')
      expect(result).toBe('add-dark-mode')
    })

    it('handles nested paths: feature/project-id/ui/button-fix', () => {
      const result = extractBranchName('feature/test-project/ui/button-improvements')
      expect(result).toBe('ui/button-improvements')
    })

    it('handles deeply nested paths with multiple segments', () => {
      const result = extractBranchName('feature/project-id/ui/components/button/hover-state')
      expect(result).toBe('ui/components/button/hover-state')
    })

    it('returns full branch name for non-standard format (single segment)', () => {
      const result = extractBranchName('main')
      expect(result).toBe('main')
    })

    it('extracts branch name from new format (two segments): feature/branch-name', () => {
      const result = extractBranchName('feature/branch-name')
      expect(result).toBe('branch-name')
    })

    it('returns null when branch is undefined', () => {
      const result = extractBranchName(undefined)
      expect(result).toBeNull()
    })

    it('returns null when branch is null', () => {
      const result = extractBranchName(null as any)
      expect(result).toBeNull()
    })

    it('returns null when branch is empty string', () => {
      const result = extractBranchName('')
      expect(result).toBeNull()
    })

    it('handles branch names with special characters in descriptive part', () => {
      const result = extractBranchName('feature/project-123/user-auth-with-2fa')
      expect(result).toBe('user-auth-with-2fa')
    })

    it('handles branch names with slashes in descriptive part', () => {
      const result = extractBranchName('feature/my-project/feature/subfolder/task')
      expect(result).toBe('feature/subfolder/task')
    })

    it('trims empty string result to null', () => {
      // Edge case: what if all parts after the first two are empty?
      // This shouldn't happen in practice, but let's be safe
      const result = extractBranchName('feature/project/')
      expect(result).toBe('')
    })
  })
})
