import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ProjectManager } from '../ProjectManager'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ProjectManager', () => {
  let tmpDir: string
  let storePath: string
  let projectDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `test-pm-${Date.now()}-${Math.random().toString(36).substring(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    storePath = join(tmpDir, 'projects.json')
    projectDir = join(tmpDir, 'test-project')
    mkdirSync(projectDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should initialize with empty state', () => {
    const pm = new ProjectManager(storePath)
    expect(pm.getActiveProjects()).toEqual([])
    expect(pm.getCurrentProject()).toBeNull()
  })

  it('should add a project', async () => {
    const pm = new ProjectManager(storePath)
    const project = await pm.addProject(projectDir)

    expect(project.path).toBe(projectDir)
    expect(project.name).toBe('test-project')
    expect(project.needsInstall).toBe(true)
    expect(pm.getActiveProjects()).toHaveLength(1)
    expect(pm.getCurrentProject()?.path).toBe(projectDir)
  })

  it('should detect project with minions.json as not needing install', async () => {
    writeFileSync(join(projectDir, 'minions.json'), JSON.stringify({ version: '2.0', project: { name: 'test' } }))
    const pm = new ProjectManager(storePath)
    const project = await pm.addProject(projectDir)
    expect(project.needsInstall).toBe(false)
  })

  it('should detect project with legacy minions/config.json', async () => {
    mkdirSync(join(projectDir, 'minions'), { recursive: true })
    writeFileSync(join(projectDir, 'minions', 'config.json'), JSON.stringify({ project: { name: 'test' } }))
    const pm = new ProjectManager(storePath)
    const project = await pm.addProject(projectDir)
    expect(project.needsInstall).toBe(false)
  })

  it('should throw for non-existent path', async () => {
    const pm = new ProjectManager(storePath)
    await expect(pm.addProject('/does/not/exist')).rejects.toThrow('does not exist')
  })

  it('should remove a project', async () => {
    const pm = new ProjectManager(storePath)
    await pm.addProject(projectDir)
    expect(pm.getActiveProjects()).toHaveLength(1)

    pm.removeProject(projectDir)
    expect(pm.getActiveProjects()).toHaveLength(0)
    expect(pm.getCurrentProject()).toBeNull()
  })

  it('should persist state across instances', async () => {
    const pm1 = new ProjectManager(storePath)
    await pm1.addProject(projectDir)

    const pm2 = new ProjectManager(storePath)
    expect(pm2.getActiveProjects()).toHaveLength(1)
    expect(pm2.getActiveProjects()[0].path).toBe(projectDir)
  })

  it('should switch projects', async () => {
    const projectDir2 = join(tmpDir, 'test-project-2')
    mkdirSync(projectDir2, { recursive: true })

    const pm = new ProjectManager(storePath)
    await pm.addProject(projectDir)
    await pm.addProject(projectDir2)

    pm.switchProject(projectDir)
    expect(pm.getCurrentProject()?.path).toBe(projectDir)
  })
})
