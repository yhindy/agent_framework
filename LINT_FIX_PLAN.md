# Lint Fix Plan

## Objective
Fix all TypeScript typecheck errors in the GUI workspace to ensure the CI lint job passes.

## Current State Analysis

### Error Summary
Total typecheck errors: **169 errors** across multiple files

### Error Categories (by frequency)

1. **Vitest/Testing Library Issues (108 errors)**
   - 39× `Cannot find name 'expect'`
   - 21× `Cannot use namespace 'jest' as a value`
   - 20× `Cannot find name 'it'`
   - 10× `Module "@testing-library/react" has no exported member 'screen'`
   - 8× `Module "@testing-library/react" has no exported member 'fireEvent'`
   - 5× `Cannot find name 'describe'`
   - 5× `Module "@testing-library/react" has no exported member 'waitFor'`
   - 2× `Cannot find name 'beforeEach'`
   - 2× `Cannot find name 'afterEach'`

2. **Unused Variables (12 errors)**
   - 2× `'fs' is declared but its value is never read`
   - 2× `'path' is declared but its value is never read`
   - 2× `'projectPath' is declared but its value is never read`
   - 2× `'existsSync' is declared but its value is never read`
   - 2× `'commandId' is declared but its value is never read`
   - 2× `'beforeEach' is declared but its value is never read`

3. **Type Safety Issues (12 errors)**
   - 4× `'entry.message' is possibly 'undefined'`
   - 2× `Not all code paths return a value`
   - 2× `Property 'uiState' does not exist on type 'AgentSession'`
   - 2× `Property 'saveUIState' does not exist`
   - 2× `Property 'includes' does not exist on type 'never'`

4. **Module Resolution Issues (2 errors)**
   - 2× `Cannot find module '../../main/services/types/ProjectConfig'`

## Root Causes

### 1. Vitest Configuration Issue
The `vitest.config.ts` has `globals: true`, but TypeScript doesn't know about these globals during typecheck. The test files are being type-checked but don't have proper type definitions for vitest globals.

**Solution**: Add vitest types to tsconfig.json

### 2. Testing Library Version Mismatch
The project uses `@testing-library/react` v16.3.1, but the imports suggest usage of older APIs. In newer versions:
- Named exports changed (screen, fireEvent, waitFor are now imported differently)

**Solution**: Update imports to match the installed version

### 3. Jest vs Vitest
Code references `jest` namespace but the project uses Vitest. The `jest` namespace should not be used with Vitest.

**Solution**: Replace `jest.fn()` with `vi.fn()` and import `vi` from 'vitest'

### 4. TypeScript Configuration
The main `tsconfig.json` extends `@electron-toolkit/tsconfig` but doesn't include vitest types.

**Solution**: Add vitest/globals to types array

## Implementation Plan

### Phase 1: Fix TypeScript Configuration
**Files to modify**: `gui/tsconfig.json`

1. Add vitest types to compiler options
2. Ensure test files are properly included

**Changes needed**:
```json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.json",
  "include": [
    "electron.vite.config.*",
    "src/**/*",
    "electron/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "baseUrl": ".",
    "types": ["vitest/globals"],
    "paths": {
      "@renderer/*": ["src/renderer/src/*"],
      "@/*": ["src/renderer/src/*"]
    }
  }
}
```

### Phase 2: Fix Testing Library Imports
**Affected files**:
- `src/renderer/src/components/__tests__/*.test.tsx` (multiple files)

**Current problematic imports**:
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
```

**Correct import pattern for v16+**:
```typescript
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
```

Note: In @testing-library/react v16+:
- `screen` is still available as a named export
- `fireEvent` is still available but prefer `userEvent`
- `waitFor` needs to be imported from '@testing-library/dom' or use the one from react

**Action**: Verify actual exports and fix imports

### Phase 3: Replace Jest with Vitest
**Affected files**: All test files using `jest.fn()`, `jest.mock()`, etc.

**Find and replace**:
- `jest.fn()` → `vi.fn()`
- `jest.spyOn()` → `vi.spyOn()`
- `jest.mock()` → `vi.mock()`
- `jest.clearAllMocks()` → `vi.clearAllMocks()`
- `jest.advanceTimersByTime()` → `vi.advanceTimersByTime()`
- `jest.useFakeTimers()` → `vi.useFakeTimers()`
- `jest.useRealTimers()` → `vi.useRealTimers()`

**Add imports**: `import { vi } from 'vitest'` to all affected files

### Phase 4: Remove Unused Imports
**Affected files**:
- `src/main/services/__tests__/AgentService.test.ts`
- `src/main/services/__tests__/AgentService.uistate.test.ts`

**Actions**:
1. Remove unused `fs` import
2. Remove unused `path` import
3. Remove unused `existsSync` import
4. Remove unused variables like `projectPath`, `commandId`, `beforeEach`

### Phase 5: Fix Type Safety Issues

#### 5.1 Fix "possibly undefined" errors
**Pattern**: `entry.message is possibly 'undefined'`

**Solution**: Add null checks or use optional chaining
```typescript
// Before
const msg = entry.message
// After
const msg = entry.message ?? ''
// or
if (entry.message) { ... }
```

#### 5.2 Fix "Not all code paths return a value"
**Action**: Review functions and ensure all code paths have return statements

#### 5.3 Fix missing properties
- `Property 'uiState' does not exist on type 'AgentSession'`
- `Property 'saveUIState' does not exist`

**Action**: Review type definitions and either add missing properties or fix the usage

#### 5.4 Fix "includes on never"
**Pattern**: `Property 'includes' does not exist on type 'never'`

**Solution**: Fix type narrowing/inference issues by adding proper type annotations

### Phase 6: Fix Module Resolution
**Error**: `Cannot find module '../../main/services/types/ProjectConfig'`

**Action**: Verify the path exists or update the import path

### Phase 7: Validation
1. Run `npm run typecheck` in gui workspace
2. Verify 0 errors
3. Run tests: `npm run test -w gui`
4. Verify all tests pass
5. Push to branch and check CI lint job

## Files Expected to Change

### Configuration Files
- `gui/tsconfig.json` - Add vitest types

### Test Files (Main Process)
- `src/main/services/__tests__/AgentService.test.ts`
- `src/main/services/__tests__/AgentService.uistate.test.ts`

### Test Files (Renderer Process)
- `src/renderer/src/components/__tests__/*.test.tsx` (multiple)
- `src/renderer/src/utils/__tests__/*.test.ts` (multiple)
- `src/renderer/src/store/__tests__/*.test.ts` (multiple)

### Source Files (if type errors exist)
- Any file with "possibly undefined" or "missing return" errors

## Success Criteria
1. ✅ `npm run typecheck` exits with code 0
2. ✅ `npm run test -w gui` passes all tests
3. ✅ CI lint job shows green checkmark
4. ✅ No new errors introduced

## Automated Testing Section

### Current Test Infrastructure

#### Test Framework
- **Framework**: Vitest v1.0.0
- **Location**: Root workspace and both gui/minions workspaces
- **Configuration**:
  - Main process tests: `gui/vitest.config.ts`
  - Renderer process tests: `gui/vitest.config.renderer.ts`

#### Test Coverage
- **Provider**: Vitest v8 coverage provider
- **Reporters**: text, json, html, lcov
- **Thresholds**: 60% for lines, functions, branches, statements
- **Codecov Integration**: ✅ Enabled in CI

#### Test Organization
1. **GUI Tests** (`gui/src/`)
   - Main process tests: `src/main/**/__tests__/*.test.ts`
   - Renderer tests: `src/renderer/**/__tests__/*.test.tsx`
   - Environment: node (main), jsdom (renderer)

2. **Minions Tests** (`minions/`)
   - Unit tests for CLI framework
   - Environment: node

#### CI Test Execution
The CI implements **intelligent test selection**:
- Analyzes changed files via `.github/scripts/analyze-changes.js`
- Runs only affected tests unless:
  - Config files changed
  - Shared dependencies modified
  - Manual "full_run" triggered
- **Parallel execution**: GUI tests on macOS, Minions on Linux

### Test Verification Plan

#### Pre-Lint-Fix Testing
Before making any changes:
1. ✅ Dependencies installed (`npm ci`)
2. ⏳ Baseline test run to identify pre-existing failures
   - Run: `npm run test -w gui -- --run`
   - Run: `npm run test -w minions -- --run`
   - Document any existing failures

#### During Lint Fixes
For each category of fixes:
1. **After TypeScript config changes**:
   - Run full test suite to ensure no breakage

2. **After Testing Library import fixes**:
   - Run renderer tests specifically
   - Verify UI component tests still pass

3. **After Jest→Vitest migration**:
   - Run all tests using affected mock functions
   - Verify mock behavior matches expectations

4. **After removing unused imports**:
   - Quick typecheck validation
   - Targeted test run for affected files

5. **After type safety fixes**:
   - Full test suite run
   - Verify no runtime errors introduced

#### Post-Lint-Fix Testing
After all fixes complete:
1. **Local validation**:
   ```bash
   npm run typecheck          # Should exit 0
   npm run test -w gui -- --run --coverage
   npm run test -w minions -- --run --coverage
   ```

2. **Coverage verification**:
   - Ensure coverage thresholds still met (60%)
   - Check that fixes didn't remove test coverage
   - Review coverage report in `gui/coverage/`

3. **CI simulation**:
   ```bash
   # Simulate CI environment
   npm ci
   npm run typecheck -w gui
   npm run test -w gui -- --run --coverage
   npm run build -w gui
   ```

4. **Integration checks**:
   - Build succeeds: `npm run build -w gui`
   - App launches: `npm run dev -w gui` (smoke test)

#### Test Failure Response
If tests fail during fixes:
1. **Categorize the failure**:
   - Type error (expected during transition)
   - Mock behavior changed (fix mock usage)
   - Test assertion failed (investigate logic change)
   - Test import failed (fix import path)

2. **Fix strategy**:
   - For vitest globals: Ensure `globals: true` in config
   - For mock issues: Verify `vi.fn()` usage
   - For import issues: Check @testing-library exports
   - For type issues: Add proper type annotations

3. **Validation**:
   - Re-run failing test in isolation
   - Run related test suite
   - Run full suite before proceeding

### Continuous Validation
- After each file modification, run related tests
- Keep test output visible for immediate feedback
- Don't batch fixes without testing
- Mark todos as "in_progress" while fixing, "completed" only after tests pass

### CI Integration
The CI workflow will automatically:
1. **Detect changes**: Run change analysis
2. **Run lint**: Execute typecheck
3. **Run tests**: Execute selected test suites
4. **Upload coverage**: Send to Codecov
5. **Build**: Verify build succeeds

**Success means**: All CI jobs green, including:
- ✅ `lint` job (typecheck)
- ✅ `test-gui` job (if GUI changed)
- ✅ `test-minions` job (if minions changed)
- ✅ `build-gui` job

### Test Documentation
Tests serve as:
- **Regression prevention**: Ensure fixes don't break functionality
- **Type safety validation**: Verify TypeScript types match runtime
- **API contract verification**: Ensure electron IPC contracts maintained
- **UI behavior validation**: Confirm component interactions work

**Important**: The goal is to fix lint errors WITHOUT changing test behavior or coverage. Tests should pass with the same assertions before and after fixes.

## Risk Assessment

### Low Risk Changes
- Adding vitest types to tsconfig
- Removing unused imports
- Replacing jest→vi (straightforward mapping)

### Medium Risk Changes
- Fixing @testing-library imports (need to verify exports)
- Fixing "possibly undefined" errors (could change logic)

### High Risk Changes
- Fixing missing properties on types (might indicate design issues)
- Fixing module resolution (might reveal architectural problems)

## Rollback Strategy
If issues arise:
1. All changes on feature branch `feature/agent_framework-nt2zkef/fix-lint`
2. Can revert individual commits
3. Can abandon branch and start fresh with lessons learned

## Estimated Impact
- **Files modified**: ~30-40 test files + 1 config file + potential source files
- **Complexity**: Medium (mostly mechanical changes, some type investigation)
- **Breaking changes**: None (fixes should be backward compatible)
