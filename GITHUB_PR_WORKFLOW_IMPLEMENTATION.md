# GitHub PR Workflow Implementation - Complete

## Overview

Successfully replaced the "merge agent" workflow with a GitHub PR-based workflow. Agents now create pull requests that humans can review and merge through GitHub's UI.

## Changes Made

### 1. AgentService.ts (`gui/src/main/services/AgentService.ts`)

**Added:**
- `checkDependencies()` - Verifies `gh` CLI installation and authentication
- `createPullRequest()` - Creates PRs with smart body generation from spec files
- `checkPullRequestStatus()` - Checks if PR is OPEN, MERGED, or CLOSED
- Updated `Assignment` interface with `prUrl` and `prStatus` fields

**Removed:**
- `initiateMerge()` - Old merge agent spawning logic
- `buildMergePrompt()` - Merge prompt generation
- `createMergeSpec()` - Merge spec file creation
- `completeMerge()` - Merge completion handling

**Net Change:** ~215 lines removed, ~95 lines added (120 lines saved)

### 2. Main Process IPC Handlers (`gui/src/main/index.ts`)

**Added:**
- `assignments:createPR` - Creates pull request
- `assignments:checkPR` - Checks PR status
- `dependencies:check` - Checks for `gh` CLI

**Removed:**
- `assignments:merge` - Old merge agent handler

### 3. Preload API (`gui/src/preload/index.ts`)

**Updated:**
- Replaced `initiateMerge()` with `createPullRequest()` and `checkPullRequestStatus()`
- Added `checkDependencies()`

### 4. Dashboard Component (`gui/src/renderer/src/components/Dashboard.tsx`)

**Major UI Changes:**

**State Management:**
- Removed: `mergingAssignments`, `showMergeConfirm`, `mergeTool`
- Added: `creatingPRFor`, `checkingPRFor`, `showPRConfirm`, `ghAvailable`, `ghError`

**New Status Flow:**
- `in_progress` → `completed` → `pr_open` → `merged` → (archived)

**Dashboard Columns:**
- Removed: "merging"
- Added: "pr_open", "merged"

**Assignment Card Actions:**
- **Completed**: "Create Pull Request" button (disabled if `gh` CLI unavailable)
- **PR Open**: "Check PR Status" button + link to PR on GitHub
- **Merged**: "Archive & Cleanup" button

**Modals:**
- Replaced complex merge confirmation modal with simple PR confirmation
- No tool selection needed (removed merge agent tool dropdown)

### 5. AgentView Component (`gui/src/renderer/src/components/AgentView.tsx`)

**Updated:**
- Fixed "Mark Complete" button visibility to exclude `pr_open` and `merged` statuses

### 6. Files Removed

- `scripts/agents/merge.sh` - No longer needed

## How It Works

### Creating a PR

1. User completes an assignment and clicks "Mark Complete"
2. Status changes to `completed`
3. User clicks "Create Pull Request"
4. System:
   - Pushes branch to origin
   - Reads spec file for PR body (falls back to prompt)
   - Runs `gh pr create --title "..." --body "..." --base master`
   - Updates assignment with PR URL
   - Opens PR in browser

### Checking PR Status

1. User clicks "Check PR Status" on a `pr_open` assignment
2. System runs `gh pr view <number> --json state,mergedAt`
3. Updates assignment status:
   - `MERGED` → status = `merged`
   - `CLOSED` → status = `closed`
   - `OPEN` → remains `pr_open`

### Cleanup

1. When PR is merged, user clicks "Archive & Cleanup"
2. System runs `teardownAgent()` to remove worktree
3. Assignment is archived and agent becomes available

## Prerequisites

Users must have:
- GitHub remote configured
- `gh` CLI installed: `brew install gh`
- `gh` authenticated: `gh auth login`

The Dashboard shows a warning if `gh` is not available.

## Testing Checklist

### Manual Testing Steps

1. **Dependency Check:**
   - Open Dashboard, verify no warning if `gh` is installed
   - Uninstall `gh`, verify warning appears

2. **Create PR Flow:**
   - Complete an assignment
   - Click "Create Pull Request"
   - Verify PR is created on GitHub
   - Verify browser opens to PR URL
   - Verify assignment moves to "pr_open" column

3. **Check PR Status:**
   - Click "Check PR Status" on a PR
   - Verify correct status is detected
   - Merge PR on GitHub
   - Click "Check PR Status" again
   - Verify assignment moves to "merged" column

4. **Cleanup:**
   - Click "Archive & Cleanup" on merged assignment
   - Verify worktree is removed
   - Verify assignment is archived
   - Verify agent becomes available

5. **Edge Cases:**
   - Try creating PR when branch already pushed
   - Try creating PR when PR already exists
   - Try with missing spec file (should use prompt)

## Code Quality

- ✅ No linter errors
- ✅ Build completes successfully
- ✅ All old merge code removed
- ✅ TypeScript types updated correctly
- ✅ No references to old `initiateMerge` API

## Benefits Over Old Workflow

| Aspect | Before (Merge Agent) | After (GitHub PR) |
|--------|---------------------|-------------------|
| **Complexity** | ~200 lines of merge logic | ~30 lines PR creation |
| **Agent Slots** | 2 (worker + merge agent) | 1 (worker only) |
| **Human Review** | After merge | Before merge |
| **Conflict Resolution** | AI (risky) | Human in GitHub UI |
| **CI Integration** | Manual | Native GitHub Actions |
| **Rollback** | Manual git revert | GitHub revert button |
| **Visibility** | Terminal output | GitHub PR UI |

## Migration Notes

Existing assignments with "merging" status will need manual cleanup after updating to this version. The status is no longer recognized by the Dashboard.

Old merge spec files in `docs/agents/assignments/*-merge-spec.md` can be deleted - they're no longer used.

