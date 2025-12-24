import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ProjectService, ProjectState } from '../ProjectService'
import Store from 'electron-store'
import * as fs from 'fs'

// Mock dependencies
vi.mock('electron-store', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    }))
  }
})

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  cpSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn().mockReturnValue('/tmp'),
  }
}))

describe('ProjectService Multi-Repo', () => {
  let projectService: ProjectService
  let mockStore: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup store mock with state
    const storeState: Record<string, any> = {}
    mockStore = {
      get: vi.fn((key, defaultValue) => storeState[key] ?? defaultValue),
      set: vi.fn((key, value) => { storeState[key] = value }),
    }
    vi.mocked(Store).mockImplementation(() => mockStore)
    
    // Setup fs mock
    vi.mocked(fs.existsSync).mockReturnValue(true)
    
    projectService = new ProjectService()
  })

  it('initializes with empty state if no stored projects', () => {
    expect(projectService.getActiveProjects()).toEqual([])
    expect(projectService.getCurrentProject()).toBeNull()
  })

  it('addProject adds a project and sets it as current if first', () => {
    const projectPath = '/path/to/project1'
    
    const project = projectService.addProject(projectPath)
    
    expect(project.path).toBe(projectPath)
    expect(projectService.getActiveProjects()).toHaveLength(1)
    expect(projectService.getCurrentProject()?.path).toBe(projectPath)
    
    // Should persist to store
    expect(mockStore.set).toHaveBeenCalledWith('activeProjects', expect.any(Array))
  })

  it('addProject does not duplicate existing projects', () => {
    const projectPath = '/path/to/project1'
    
    projectService.addProject(projectPath)
    projectService.addProject(projectPath)
    
    expect(projectService.getActiveProjects()).toHaveLength(1)
  })

  it('addProject switches to new project by default', () => {
    const project1 = '/path/to/project1'
    const project2 = '/path/to/project2'
    
    projectService.addProject(project1)
    projectService.addProject(project2)
    
    expect(projectService.getCurrentProject()?.path).toBe(project2)
  })

  it('switchProject changes the current active project', () => {
    const project1 = '/path/to/project1'
    const project2 = '/path/to/project2'
    
    projectService.addProject(project1)
    projectService.addProject(project2)
    
    // Currently on project2
    expect(projectService.getCurrentProject()?.path).toBe(project2)
    
    // Switch to project1
    projectService.switchProject(project1)
    expect(projectService.getCurrentProject()?.path).toBe(project1)
  })

  it('removeProject removes project and updates active list', () => {
    const project1 = '/path/to/project1'
    const project2 = '/path/to/project2'
    
    projectService.addProject(project1)
    projectService.addProject(project2)
    
    // Remove project1
    projectService.removeProject(project1)
    
    const active = projectService.getActiveProjects()
    expect(active).toHaveLength(1)
    expect(active[0].path).toBe(project2)
  })

  it('removeProject switches to another project if current is removed', () => {
    const project1 = '/path/to/project1'
    const project2 = '/path/to/project2'
    
    projectService.addProject(project1)
    projectService.addProject(project2)
    
    // Currently on project2. Remove it.
    projectService.removeProject(project2)
    
    expect(projectService.getCurrentProject()?.path).toBe(project1)
  })

  it('removeProject sets current to null if last project removed', () => {
    const project1 = '/path/to/project1'
    
    projectService.addProject(project1)
    projectService.removeProject(project1)
    
    expect(projectService.getCurrentProject()).toBeNull()
  })

  it('validates paths on startup', () => {
    // Setup initial state
    const validState = [
      { path: '/valid/path', name: 'valid' },
      { path: '/invalid/path', name: 'invalid' }
    ]
    
    // We need to access the closure state from the beforeEach
    // But since we can't easily access the 'storeState' variable from here,
    // let's just use the mockStore.set/get that was set up in beforeEach
    // and pre-populate it.
    
    // However, the beforeEach sets up a new storeState closure for every test.
    // So if we just call the default implementation (which uses that closure), it works.
    // We just need to pre-populate it.
    
    // Actually, we can't write to the closure directly.
    // Let's re-implement the mock for this specific test to have its own state.
    
    let localState: any = {
      activeProjects: validState
    }
    
    mockStore.get.mockImplementation((key: string, defaultValue: any) => localState[key] ?? defaultValue)
    mockStore.set.mockImplementation((key: string, value: any) => { localState[key] = value })

    // Mock fs to only find the valid path
    vi.mocked(fs.existsSync).mockImplementation((path) => path === '/valid/path')

    // Re-initialize service
    projectService = new ProjectService()

    const active = projectService.getActiveProjects()
    expect(active).toHaveLength(1)
    expect(active[0].path).toBe('/valid/path')
  })

  it('installFramework updates project files', async () => {
    const projectPath = '/path/to/myrepo'
    
    // Mock fs for installFramework
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.includes('assignments.json')) {
        return JSON.stringify({ assignments: [] })
      }
      if (path.includes('config.sh')) {
        return 'PROJECT_NAME="default"'
      }
      return ''
    })
    
    await projectService.installFramework(projectPath)
    
    // Verify config.sh was updated
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.sh'),
      expect.stringContaining('PROJECT_NAME="myrepo"')
    )
  })
})

