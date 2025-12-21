/**
 * Type definitions for the Minion Orchestrator system.
 * These types are shared between the shell scripts metadata and the GUI application.
 */

export type AgentTool = 'claude' | 'cursor' | 'cursor-cli';
export type AgentMode = 'planning' | 'dev' | 'idle';
export type AssignmentStatus = 'pending' | 'in_progress' | 'review' | 'completed' | 'merging' | 'archived' | 'blocked';

export interface Assignment {
  id: string;
  agentId: string;
  branch: string;
  feature: string;
  status: AssignmentStatus;
  specFile: string;
  tool: AgentTool;
  model?: string;
  mode: AgentMode;
  prompt?: string;
  originalAssignmentId?: string;
}

export interface AgentSession {
  id: string;                    // matches agentId
  assignmentId: string | null;
  worktreePath: string;
  terminalPid: number | null;    // if running
  hasUnread: boolean;
  lastActivity: string;          // ISO timestamp
}

export interface ProjectState {
  path: string;
  name: string;
  agents: Record<string, AgentSession>; // Keyed by Agent ID
}

export interface AppState {
  currentProject: string; // path
  projects: Record<string, ProjectState>;
}

export interface AssignmentsFile {
  assignments: Assignment[];
  availableAgentIds: string[];
}

