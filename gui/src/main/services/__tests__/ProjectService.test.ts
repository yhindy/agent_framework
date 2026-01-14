import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProjectService } from '../ProjectService'
import Store from 'electron-store'
import * as fs from 'fs'
import { MinionsConfigService } from '../MinionsConfigService'

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

vi.mock('../MinionsConfigService', () => ({
  MinionsConfigService: vi.fn().mockImplementation(() => ({
    hasConfig: vi.fn(),
    hasLegacyConfig: vi.fn(),
    initializeMinionsFolder: vi.fn(),
    updateGitignore: vi.fn(),
    getDefaultConfig: vi.fn(),
    writeConfig: vi.fn(),
  }))
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

  it('addProject adds a project and sets it as current if first', async () => {
    const projectPath = '/path/to/project1'

    const project = await projectService.addProject(projectPath)

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

  it('installFrameworkLegacy updates project files', async () => {
    const projectPath = '/path/to/myrepo'

    // Mock fs for installFrameworkLegacy
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

    await projectService.installFrameworkLegacy(projectPath)

    // Verify config.sh was updated
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.sh'),
      expect.stringContaining('PROJECT_NAME="myrepo"')
    )
  })

  it('installFrameworkLegacy updates config.json with correct project name', async () => {
    const projectPath = '/path/to/newproject'

    // Mock fs for installFrameworkLegacy
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.includes('config.json')) {
        return JSON.stringify({
          project: { name: 'agent_framework', defaultBaseBranch: 'main' },
          setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
          assignments: [],
          testEnvironments: []
        })
      }
      if (path.includes('config.sh')) {
        return 'PROJECT_NAME="default"'
      }
      if (path.includes('.gitignore')) {
        return ''
      }
      return ''
    })

    await projectService.installFrameworkLegacy(projectPath)

    // Find the config.json write call
    const writeFileCalls = vi.mocked(fs.writeFileSync).mock.calls
    const configJsonCall = writeFileCalls.find(call =>
      typeof call[0] === 'string' && call[0].includes('config.json')
    )

    expect(configJsonCall).toBeDefined()
    expect(configJsonCall![1]).toContain('"name": "newproject"')
  })

  it('installFrameworkLegacy creates unique base agent ID based on project name from config.json', async () => {
    const projectPath = '/path/to/uniqueproject'

    // Track the config.json content after it's written
    let writtenConfigJson: any = null

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.includes('config.json')) {
        // Return the written config if available, otherwise the original template
        if (writtenConfigJson) {
          return JSON.stringify(writtenConfigJson)
        }
        return JSON.stringify({
          project: { name: 'agent_framework', defaultBaseBranch: 'main' },
          setup: { filesToCopy: [], postSetupCommands: [], requiredFiles: [], preflightCommands: [] },
          assignments: [],
          testEnvironments: []
        })
      }
      if (path.includes('config.sh')) {
        return 'PROJECT_NAME="default"'
      }
      return ''
    })

    vi.mocked(fs.writeFileSync).mockImplementation((path: any, content: any) => {
      if (typeof path === 'string' && path.includes('config.json')) {
        writtenConfigJson = JSON.parse(content)
      }
    })

    await projectService.installFrameworkLegacy(projectPath)

    // Verify config.json was updated with unique project name
    expect(writtenConfigJson).toBeDefined()
    expect(writtenConfigJson.project.name).toBe('uniqueproject')
    expect(writtenConfigJson.project.name).not.toBe('agent_framework')
  })
})

describe('ProjectService Project Format Detection', () => {
  let projectService: ProjectService
  let mockStore: any
  let mockMinionsConfigService: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup store mock with state
    const storeState: Record<string, any> = {}
    mockStore = {
      get: vi.fn((key, defaultValue) => storeState[key] ?? defaultValue),
      set: vi.fn((key, value) => { storeState[key] = value }),
    }
    vi.mocked(Store).mockImplementation(() => mockStore)

    // Setup MinionsConfigService mock
    mockMinionsConfigService = {
      hasConfig: vi.fn(),
      hasLegacyConfig: vi.fn(),
      initializeMinionsFolder: vi.fn(),
      updateGitignore: vi.fn(),
      getDefaultConfig: vi.fn(),
      writeConfig: vi.fn(),
    }
    vi.mocked(MinionsConfigService).mockImplementation(() => mockMinionsConfigService)

    // Default fs mock - project path exists
    vi.mocked(fs.existsSync).mockReturnValue(true)

    projectService = new ProjectService()
  })

  describe('getProjectFormat', () => {
    it('returns "new" when minions.json exists', () => {
      mockMinionsConfigService.hasConfig.mockReturnValue(true)
      mockMinionsConfigService.hasLegacyConfig.mockReturnValue(false)

      const format = projectService.getProjectFormat('/path/to/project')

      expect(format).toBe('new')
      expect(mockMinionsConfigService.hasConfig).toHaveBeenCalledWith('/path/to/project')
    })

    it('returns "legacy" when minions/config.json exists but no minions.json', () => {
      mockMinionsConfigService.hasConfig.mockReturnValue(false)
      mockMinionsConfigService.hasLegacyConfig.mockReturnValue(true)

      const format = projectService.getProjectFormat('/path/to/project')

      expect(format).toBe('legacy')
    })

    it('returns "none" when neither config exists', () => {
      mockMinionsConfigService.hasConfig.mockReturnValue(false)
      mockMinionsConfigService.hasLegacyConfig.mockReturnValue(false)

      const format = projectService.getProjectFormat('/path/to/project')

      expect(format).toBe('none')
    })

    it('returns "new" when both configs exist (prefers new format)', () => {
      mockMinionsConfigService.hasConfig.mockReturnValue(true)
      mockMinionsConfigService.hasLegacyConfig.mockReturnValue(true)

      const format = projectService.getProjectFormat('/path/to/project')

      expect(format).toBe('new')
    })
  })

  describe('addProject needsInstall detection', () => {
    it('sets needsInstall to false when minions.json exists (new format)', async () => {
      mockMinionsConfigService.hasConfig.mockReturnValue(true)
      mockMinionsConfigService.hasLegacyConfig.mockReturnValue(false)

      const project = await projectService.addProject('/path/to/project')

      expect(project.needsInstall).toBe(false)
    })

    it('sets needsInstall to false when minions/config.json exists (legacy format)', async () => {
      mockMinionsConfigService.hasConfig.mockReturnValue(false)
      mockMinionsConfigService.hasLegacyConfig.mockReturnValue(true)

      const project = await projectService.addProject('/path/to/project')

      expect(project.needsInstall).toBe(false)
    })

    it('sets needsInstall to true when neither config exists', async () => {
      mockMinionsConfigService.hasConfig.mockReturnValue(false)
      mockMinionsConfigService.hasLegacyConfig.mockReturnValue(false)

      const project = await projectService.addProject('/path/to/project')

      expect(project.needsInstall).toBe(true)
    })
  })

  describe('initializeMinionsFolder', () => {
    it('delegates to MinionsConfigService.initializeMinionsFolder', () => {
      projectService.initializeMinionsFolder('/path/to/project')

      expect(mockMinionsConfigService.initializeMinionsFolder).toHaveBeenCalledWith('/path/to/project')
    })
  })

  describe('installFramework (minimal structure)', () => {
    it('creates minions.json and initializes .minions/ folder', async () => {
      const projectPath = '/path/to/newproject'
      const mockConfig = {
        version: '2.0',
        project: { name: 'newproject', defaultBaseBranch: 'main' },
        setup: { filesToCopy: [], postSetupCommands: [] }
      }

      mockMinionsConfigService.getDefaultConfig.mockReturnValue(mockConfig)

      await projectService.installFramework(projectPath)

      // Should get default config
      expect(mockMinionsConfigService.getDefaultConfig).toHaveBeenCalledWith(projectPath)

      // Should write the config
      expect(mockMinionsConfigService.writeConfig).toHaveBeenCalledWith(projectPath, mockConfig)

      // Should initialize .minions/ folder
      expect(mockMinionsConfigService.initializeMinionsFolder).toHaveBeenCalledWith(projectPath)

      // Should update .gitignore
      expect(mockMinionsConfigService.updateGitignore).toHaveBeenCalledWith(projectPath)
    })
  })
})

