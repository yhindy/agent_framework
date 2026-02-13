import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { createLogger } from './logger'
import { AgentManager } from './AgentManager'
import { TerminalManager } from './TerminalManager'
import { ProjectManager } from './ProjectManager'
import { WorkflowManager } from './WorkflowManager'
import { StateManager } from './StateManager'
import { HeadlessServer } from './server'

const log = createLogger('Headless')

function findMinionsPath(): string {
  for (const candidate of [
    join(__dirname, '../../minions'), join(__dirname, '../../../minions'),
    join(process.cwd(), 'minions'), join(process.cwd(), '../minions')
  ]) {
    if (existsSync(join(candidate, 'bin', 'setup.sh'))) return resolve(candidate)
  }
  throw new Error('Could not find minions/ directory with setup.sh. Run from the agent_framework root directory.')
}

function parseArgs(): { port: number; projects: string[] } {
  const args = process.argv.slice(2)
  let port = 19234
  const projects: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[i + 1], 10); i++ }
    else if (args[i] === '--project' && args[i + 1]) { projects.push(resolve(args[i + 1])); i++ }
  }
  return { port, projects }
}

async function main(): Promise<void> {
  const { port, projects } = parseArgs()
  log.info('Starting headless API server...')

  const minionsPath = findMinionsPath()
  log.info(`Using minions path: ${minionsPath}`)

  const projectManager = new ProjectManager()
  const workflowManager = new WorkflowManager()
  const stateManager = new StateManager()
  const agentManager = new AgentManager(minionsPath)
  const terminalManager = new TerminalManager()
  terminalManager.setAgentManager(agentManager)

  for (const p of projects) {
    try {
      await projectManager.addProject(p)
      log.info(`Added project: ${p}`)
      try { await agentManager.ensureBaseBranchAgent(p) } catch (e: any) { log.warn(`Base branch agent: ${e.message}`) }
    } catch (e: any) { log.error(`Failed to add project ${p}: ${e.message}`) }
  }

  const server = new HeadlessServer({ agentManager, terminalManager, projectManager, workflowManager, stateManager }, port)
  const activePort = await server.start()

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`)
    terminalManager.cleanup()
    await server.stop()
    stateManager.save()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  log.info(`Headless API server ready on port ${activePort}`)
  log.info(`Health check: http://127.0.0.1:${activePort}/api/health`)
  if (projects.length === 0) log.info('No projects added. Use POST /api/projects to add a project.')
}

main().catch((e) => { log.error('Fatal error:', e); process.exit(1) })

export { HeadlessServer } from './server'
export { AgentManager } from './AgentManager'
export { TerminalManager } from './TerminalManager'
export { ProjectManager } from './ProjectManager'
export { WorkflowManager } from './WorkflowManager'
export { StateManager } from './StateManager'
export type * from './types'
