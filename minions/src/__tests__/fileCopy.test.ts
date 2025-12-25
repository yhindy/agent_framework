import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { copyFiles, parseFileCopyEntry, validateFilesToCopy } from '../fileCopy'

describe('File Copy Utility', () => {
  let tmpDir: string
  let repoRoot: string
  let worktreePath: string

  beforeEach(() => {
    // Create temporary directories for testing
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filecopy-test-'))
    repoRoot = path.join(tmpDir, 'repo')
    worktreePath = path.join(tmpDir, 'worktree')

    fs.mkdirSync(repoRoot, { recursive: true })
    fs.mkdirSync(worktreePath, { recursive: true })
  })

  afterEach(() => {
    // Clean up temporary files
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  describe('parseFileCopyEntry', () => {
    it('parses simple path format', () => {
      const result = parseFileCopyEntry('backend/.env')
      expect(result).toEqual({
        source: 'backend/.env',
        destination: 'backend/.env',
      })
    })

    it('parses colon-separated format', () => {
      const result = parseFileCopyEntry('src/config.json:app/config.json')
      expect(result).toEqual({
        source: 'src/config.json',
        destination: 'app/config.json',
      })
    })

    it('throws error on invalid input type', () => {
      expect(() => parseFileCopyEntry(123 as unknown as string)).toThrow(
        'Invalid file copy entry: must be a string'
      )
    })

    it('throws error on invalid colon format', () => {
      expect(() => parseFileCopyEntry('src::dest')).toThrow(
        'Invalid file copy entry'
      )
    })

    it('throws error on missing destination', () => {
      expect(() => parseFileCopyEntry('src:')).toThrow()
    })

    it('throws error on missing source', () => {
      expect(() => parseFileCopyEntry(':dest')).toThrow()
    })
  })

  describe('validateFilesToCopy', () => {
    it('validates correct array of strings', () => {
      const filesToCopy = ['backend/.env', 'frontend/.env.local']
      const result = validateFilesToCopy(filesToCopy)
      expect(result).toEqual(filesToCopy)
    })

    it('validates colon-separated entries', () => {
      const filesToCopy = ['src/config.json:app/config.json']
      expect(() => validateFilesToCopy(filesToCopy)).not.toThrow()
    })

    it('throws on non-array input', () => {
      expect(() => validateFilesToCopy('not-an-array')).toThrow(
        'filesToCopy must be an array'
      )
    })

    it('throws on non-string entries', () => {
      expect(() => validateFilesToCopy(['valid.txt', 123])).toThrow(
        'Each entry in filesToCopy must be a string'
      )
    })

    it('throws on empty path', () => {
      expect(() => validateFilesToCopy([''])).toThrow('File path cannot be empty')
    })

    it('throws on invalid colon format', () => {
      expect(() => validateFilesToCopy(['src:dest:extra'])).toThrow(
        'Invalid format'
      )
    })
  })

  describe('copyFiles', () => {
    it('copies single file with same source and destination', () => {
      const envFile = path.join(repoRoot, 'backend', '.env')
      fs.mkdirSync(path.dirname(envFile), { recursive: true })
      fs.writeFileSync(envFile, 'DATABASE_URL=postgres://localhost')

      const result = copyFiles(['backend/.env'], repoRoot, worktreePath)

      expect(result.success).toBe(true)
      expect(result.copied).toHaveLength(1)
      expect(result.copied[0]).toEqual({
        source: 'backend/.env',
        destination: 'backend/.env',
      })
      expect(result.errors).toHaveLength(0)
      expect(result.skipped).toHaveLength(0)

      const copiedFile = path.join(worktreePath, 'backend', '.env')
      expect(fs.existsSync(copiedFile)).toBe(true)
      expect(fs.readFileSync(copiedFile, 'utf-8')).toBe('DATABASE_URL=postgres://localhost')
    })

    it('copies file with different source and destination', () => {
      const srcFile = path.join(repoRoot, 'src', 'config.json')
      fs.mkdirSync(path.dirname(srcFile), { recursive: true })
      fs.writeFileSync(srcFile, '{"key": "value"}')

      const result = copyFiles(['src/config.json:app/config.json'], repoRoot, worktreePath)

      expect(result.success).toBe(true)
      expect(result.copied).toHaveLength(1)
      expect(result.copied[0]).toEqual({
        source: 'src/config.json',
        destination: 'app/config.json',
      })

      const copiedFile = path.join(worktreePath, 'app', 'config.json')
      expect(fs.existsSync(copiedFile)).toBe(true)
      expect(fs.readFileSync(copiedFile, 'utf-8')).toBe('{"key": "value"}')
    })

    it('copies multiple files', () => {
      // Create multiple source files
      const files = ['backend/.env', 'backend/.env.local', 'frontend/.env.local']
      files.forEach((file) => {
        const fullPath = path.join(repoRoot, file)
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, `content of ${file}`)
      })

      const result = copyFiles(files, repoRoot, worktreePath)

      expect(result.success).toBe(true)
      expect(result.copied).toHaveLength(3)
      expect(result.errors).toHaveLength(0)
      expect(result.skipped).toHaveLength(0)

      files.forEach((file) => {
        const copiedPath = path.join(worktreePath, file)
        expect(fs.existsSync(copiedPath)).toBe(true)
      })
    })

    it('skips missing files with warning', () => {
      // Create backend/.env so it doesn't get skipped
      const envFile = path.join(repoRoot, 'backend', '.env')
      fs.mkdirSync(path.dirname(envFile), { recursive: true })
      fs.writeFileSync(envFile, 'TEST=1')

      const result = copyFiles(
        ['missing/.env', 'backend/.env'],
        repoRoot,
        worktreePath
      )

      expect(result.success).toBe(true)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].source).toBe('missing/.env')
      expect(result.skipped[0].reason).toContain('File not found')
    })

    it('handles error on invalid array', () => {
      const result = copyFiles(null as unknown as string[], repoRoot, worktreePath)

      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toContain('must be an array')
    })

    it('handles invalid file entry format', () => {
      const result = copyFiles(
        ['backend/.env', 'invalid::path'],
        repoRoot,
        worktreePath
      )

      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('creates nested directories as needed', () => {
      const deepFile = path.join(repoRoot, 'a', 'b', 'c', 'config.json')
      fs.mkdirSync(path.dirname(deepFile), { recursive: true })
      fs.writeFileSync(deepFile, '{}')

      const result = copyFiles(['a/b/c/config.json'], repoRoot, worktreePath)

      expect(result.success).toBe(true)
      const copiedFile = path.join(worktreePath, 'a', 'b', 'c', 'config.json')
      expect(fs.existsSync(copiedFile)).toBe(true)
    })

    it('skips directories', () => {
      const dirPath = path.join(repoRoot, 'some-dir')
      fs.mkdirSync(dirPath, { recursive: true })

      const result = copyFiles(['some-dir'], repoRoot, worktreePath)

      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].reason).toContain('not a file')
    })

    it('handles empty filesToCopy array', () => {
      const result = copyFiles([], repoRoot, worktreePath)

      expect(result.success).toBe(true)
      expect(result.copied).toHaveLength(0)
      expect(result.errors).toHaveLength(0)
    })

    it('preserves file content during copy', () => {
      const content = 'API_KEY=secret123\nDATABASE_URL=postgres://localhost:5432/mydb'
      const envFile = path.join(repoRoot, '.env')
      fs.writeFileSync(envFile, content)

      copyFiles(['.env'], repoRoot, worktreePath)

      const copiedContent = fs.readFileSync(path.join(worktreePath, '.env'), 'utf-8')
      expect(copiedContent).toBe(content)
    })
  })
})
