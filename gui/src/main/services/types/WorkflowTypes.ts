/**
 * Workflow Editor Type Definitions
 *
 * This module defines all TypeScript interfaces for the Workflow Editor feature,
 * including subagent types, workflow steps, parallel execution groups, and
 * project-specific configurations.
 */

/**
 * Defines a subagent type that can be used in workflows.
 * Subagent types represent different agent personalities/configurations
 * optimized for specific tasks like exploration, debugging, or planning.
 */
export interface SubagentType {
  id: string                    // e.g., 'explore', 'general-purpose', 'plan', 'debugger'
  name: string                  // Human-readable name for UI display
  description: string           // What this subagent does
  defaultPromptTemplate: string // Default system prompt template
  icon?: string                 // Optional icon identifier for UI rendering
  capabilities?: string[]       // e.g., ['read-only', 'file-edit', 'test-execution']
}

/**
 * Configuration options for a workflow step.
 * Controls timeout, retry, and failure handling behavior.
 */
export interface WorkflowStepConfig {
  timeout?: number              // Maximum execution time in milliseconds
  retryOnFailure?: boolean      // Whether to retry if step fails
  continueOnFailure?: boolean   // Whether to continue workflow if step fails
}

/**
 * A single step in a workflow (sequential execution).
 * Each step runs a specific subagent type with optional customization.
 */
export interface WorkflowStep {
  id: string                    // Unique identifier for this step
  type: 'step'                  // Discriminator for union type
  name: string                  // Display name for UI
  subagentTypeId: string        // Reference to SubagentType.id
  promptOverride?: string       // Optional custom prompt to override default
  enabled: boolean              // Can be toggled off without removing
  config?: WorkflowStepConfig   // Optional execution configuration
}

/**
 * A group of steps that execute in parallel.
 * All steps within a parallel group start simultaneously and the group
 * completes when all steps finish (or fail based on configuration).
 */
export interface ParallelGroup {
  id: string                    // Unique identifier for this group
  type: 'parallel'              // Discriminator for union type
  steps: WorkflowStep[]         // Steps to execute in parallel
}

/**
 * Union type for workflow items.
 * A workflow consists of a sequence of items, where each item is either
 * a single step or a parallel group of steps.
 */
export type WorkflowItem = WorkflowStep | ParallelGroup

/**
 * Type guard to check if a workflow item is a single step.
 * @param item - The workflow item to check
 * @returns True if the item is a WorkflowStep
 */
export function isWorkflowStep(item: WorkflowItem): item is WorkflowStep {
  return item.type === 'step'
}

/**
 * Type guard to check if a workflow item is a parallel group.
 * @param item - The workflow item to check
 * @returns True if the item is a ParallelGroup
 */
export function isParallelGroup(item: WorkflowItem): item is ParallelGroup {
  return item.type === 'parallel'
}

/**
 * A complete workflow configuration.
 * Represents a named, versioned sequence of workflow items that can be
 * executed by the orchestrator.
 */
export interface WorkflowConfig {
  id: string                    // Unique identifier for this workflow
  name: string                  // Display name for UI
  description?: string          // Optional description of what this workflow does
  items: WorkflowItem[]         // Ordered list of steps and parallel groups
  isDefault?: boolean           // Whether this is the default workflow
  isTemplate?: boolean          // Whether this is a template (read-only)
  createdAt: string             // ISO timestamp of creation
  updatedAt: string             // ISO timestamp of last update
  version: number               // Version number for optimistic locking
  lockedBy?: string             // User ID if workflow is being edited
  lockedAt?: string             // ISO timestamp of when lock was acquired
}

/**
 * Root configuration with all subagent types and workflows.
 * This represents the global workflow system configuration that applies
 * across all projects unless overridden.
 */
export interface WorkflowSystemConfig {
  subagentTypes: SubagentType[] // All available subagent types
  workflows: WorkflowConfig[]   // All defined workflows
  defaultWorkflowId: string     // ID of the default workflow to use
  version: number               // Schema version for migrations
}

/**
 * Project-specific workflow configuration.
 * Allows projects to customize which workflow is active, define custom
 * workflows, and override subagent type settings for their specific needs.
 */
export interface ProjectWorkflowConfig {
  activeWorkflowId: string      // ID of the currently active workflow
  customWorkflows: WorkflowConfig[]  // Project-specific workflow definitions
  overrides?: {                 // Optional per-subagent customizations
    [subagentTypeId: string]: Partial<SubagentType>
  }
}
