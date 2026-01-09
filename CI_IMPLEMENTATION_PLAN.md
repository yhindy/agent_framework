# CI with Intelligent Test Selection - Implementation Plan

## Overview

This plan outlines the implementation of a Continuous Integration (CI) system with intelligent test selection for the agent_framework monorepo. The goal is to create a fast, reliable CI pipeline that runs only the tests affected by code changes while maintaining quality gates.

## Current State

### Existing Infrastructure
- **Monorepo Structure**: 2 packages (gui, minions) using npm workspaces
- **Test Framework**: Vitest with 22 test files (19 GUI + 3 Minions)
- **Test Types**: Unit tests and integration tests (.integration.test.ts)
- **Build System**: electron-vite for GUI, standard npm for Minions
- **No CI/CD**: No existing GitHub Actions or other CI configuration

### Test Distribution
- **GUI Package**: 19 tests
  - Main process tests: 16 files (services, IPC handlers, session management)
  - Renderer tests: 3 files (hooks, utilities)
- **Minions Package**: 3 tests (file operations, setup, worktree)

## Intelligent Test Selection Strategy

### Approach: Change-Based Test Selection

The intelligent test selection system will analyze changed files and determine which tests need to run based on:

1. **Direct File Changes**: If a source file changes, run its co-located tests
2. **Dependency Analysis**: Run tests for files that import the changed file
3. **Package-Level Changes**: If package.json or config files change, run all tests in that package
4. **Root-Level Changes**: If root workspace files change, run all tests
5. **Always-Run Tests**: Integration tests run on main/master branch and PRs to main

### Implementation Methods

#### Method 1: Git Diff Analysis (Primary Method)
- Use `git diff` to identify changed files between current commit and base branch
- Parse import statements to build dependency graph
- Select tests based on change impact

#### Method 2: Vitest's Built-in Changed Mode (Fallback)
- Vitest supports `--changed` flag that runs tests related to changed files
- Requires Git integration
- Simpler but less granular control

#### Method 3: Hybrid Approach (Recommended)
- Use Git diff for coarse-grained selection (package level)
- Use Vitest --changed for fine-grained selection within packages
- Override with full test run on main branch, release branches, or when CI files change

### Test Selection Rules

```yaml
Rule Priority Matrix:
1. Full Test Run (Highest Priority)
   - Changes to CI configuration files (.github/workflows/*)
   - Changes to test configuration (vitest.config.ts, tsconfig.json)
   - Changes to root package.json or package-lock.json
   - Push to main/master branch
   - Manual workflow dispatch with full_run=true

2. Package-Level Selection
   - Changes to gui/** → Run all GUI tests
   - Changes to minions/** → Run all Minions tests
   - Changes to both → Run all tests

3. File-Level Intelligent Selection
   - Changed file: src/services/AgentService.ts
     → Run: src/services/__tests__/AgentService*.test.ts
   - Changed file: src/utils/branchUtils.ts
     → Run: src/utils/__tests__/branchUtils.test.ts
   - Use Vitest --changed for dependency detection

4. Integration Tests
   - Always run *.integration.test.ts files on PR to main
   - Optional on feature branch commits (for speed)

5. Safety Fallback
   - If test selection fails, run all tests
   - If selection results in 0 tests but files changed, run all tests
```

## GitHub Actions Workflow Architecture

### Workflow Files Structure

```
.github/
├── workflows/
│   ├── ci.yml                    # Main CI workflow (PR and push)
│   ├── test-selection.yml        # Reusable test selection workflow
│   ├── release.yml               # Release workflow (future)
│   └── nightly.yml               # Nightly full test run (optional)
├── actions/
│   └── intelligent-test-selector/
│       ├── action.yml            # Custom action for test selection
│       └── selector.js           # Selection logic
└── scripts/
    └── analyze-changes.js        # Change analysis script
```

### Main CI Workflow (ci.yml)

```yaml
name: CI

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master, 'feature/**']
  workflow_dispatch:
    inputs:
      full_run:
        description: 'Run all tests'
        required: false
        default: false
        type: boolean

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # Job 1: Determine what to test
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      run_all_tests: ${{ steps.detect.outputs.run_all_tests }}
      test_gui: ${{ steps.detect.outputs.test_gui }}
      test_minions: ${{ steps.detect.outputs.test_minions }}
      gui_test_pattern: ${{ steps.detect.outputs.gui_test_pattern }}
      minions_test_pattern: ${{ steps.detect.outputs.minions_test_pattern }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for diff analysis

      - name: Detect changes and select tests
        id: detect
        run: |
          # Logic to analyze changes and output test selection
          # (Detailed in Implementation section)

  # Job 2: Lint and Type Check
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check GUI
        run: npm run typecheck -w gui

      - name: Lint (if configured)
        run: npm run lint --if-present

  # Job 3: Test GUI
  test-gui:
    needs: detect-changes
    if: needs.detect-changes.outputs.test_gui == 'true'
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules
        run: npm run rebuild -w gui

      - name: Run GUI tests (intelligent selection)
        if: needs.detect-changes.outputs.run_all_tests != 'true'
        run: |
          cd gui
          npx vitest run ${{ needs.detect-changes.outputs.gui_test_pattern }}

      - name: Run GUI tests (all)
        if: needs.detect-changes.outputs.run_all_tests == 'true'
        run: npm run test -w gui

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./gui/coverage/coverage-final.json
          flags: gui-${{ matrix.os }}

  # Job 4: Test Minions
  test-minions:
    needs: detect-changes
    if: needs.detect-changes.outputs.test_minions == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Minions tests (intelligent selection)
        if: needs.detect-changes.outputs.run_all_tests != 'true'
        run: |
          cd minions
          npx vitest run ${{ needs.detect-changes.outputs.minions_test_pattern }}

      - name: Run Minions tests (all)
        if: needs.detect-changes.outputs.run_all_tests == 'true'
        run: npm run test -w minions

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./minions/coverage/coverage-final.json
          flags: minions

  # Job 5: Build GUI (smoke test)
  build-gui:
    needs: [test-gui, test-minions]
    if: always() && (needs.test-gui.result == 'success' || needs.test-gui.result == 'skipped') && (needs.test-minions.result == 'success' || needs.test-minions.result == 'skipped')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build GUI
        run: npm run build -w gui

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: gui-build
          path: gui/dist/
          retention-days: 7
```

## Change Detection Script

### analyze-changes.js (Located in .github/scripts/)

```javascript
#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getChangedFiles() {
  // Get base ref (target branch for PR, or previous commit for push)
  const baseRef = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'HEAD^';

  // Get changed files
  const diffOutput = execSync(`git diff --name-only ${baseRef} HEAD`, {
    encoding: 'utf-8'
  });

  return diffOutput.split('\n').filter(Boolean);
}

function analyzeChanges(changedFiles) {
  const result = {
    run_all_tests: false,
    test_gui: false,
    test_minions: false,
    gui_test_pattern: '',
    minions_test_pattern: ''
  };

  // Rules for full test run
  const fullRunTriggers = [
    /^\.github\/workflows\//,
    /^package\.json$/,
    /^package-lock\.json$/,
    /vitest\.config\.ts$/,
    /tsconfig\.json$/,
    /electron\.vite\.config\.ts$/
  ];

  for (const file of changedFiles) {
    // Check for full run triggers
    if (fullRunTriggers.some(pattern => pattern.test(file))) {
      result.run_all_tests = true;
      result.test_gui = true;
      result.test_minions = true;
      return result;
    }

    // Package-level detection
    if (file.startsWith('gui/')) {
      result.test_gui = true;
    }
    if (file.startsWith('minions/')) {
      result.test_minions = true;
    }
  }

  // On main branch or PR to main, always run all tests
  const branch = process.env.GITHUB_REF_NAME;
  const baseBranch = process.env.GITHUB_BASE_REF;
  if (branch === 'main' || branch === 'master' || baseBranch === 'main' || baseBranch === 'master') {
    result.run_all_tests = true;
  }

  // Build test patterns (for fine-grained selection)
  if (result.test_gui && !result.run_all_tests) {
    result.gui_test_pattern = '--changed';
  }
  if (result.test_minions && !result.run_all_tests) {
    result.minions_test_pattern = '--changed';
  }

  return result;
}

function setOutputs(result) {
  for (const [key, value] of Object.entries(result)) {
    console.log(`${key}=${value}`);
    // GitHub Actions output syntax
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  }
}

// Main execution
const changedFiles = getChangedFiles();
console.log('Changed files:', changedFiles);

const result = analyzeChanges(changedFiles);
console.log('Test selection result:', result);

setOutputs(result);
```

## Caching Strategy

### Dependencies Caching
```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'  # Automatically caches npm dependencies
```

### Vitest Cache
```yaml
- name: Cache Vitest
  uses: actions/cache@v4
  with:
    path: |
      gui/node_modules/.vitest
      minions/node_modules/.vitest
    key: vitest-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      vitest-${{ runner.os }}-
```

### Electron Native Modules Cache
```yaml
- name: Cache Electron native modules
  uses: actions/cache@v4
  with:
    path: |
      gui/node_modules/.cache/electron
      gui/node_modules/.cache/electron-builder
    key: electron-${{ runner.os }}-${{ hashFiles('gui/package-lock.json') }}
```

## Test Configuration Updates

### Update GUI vitest.config.ts for Coverage

```typescript
// gui/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/main/**/*.{test,spec}.ts'],
    exclude: ['src/renderer/**/*', 'node_modules'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/**/*.{test,spec}.ts', 'src/main/**/__tests__/**'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60
      }
    }
  }
});
```

### Update GUI vitest.config.renderer.ts for Coverage

```typescript
// gui/vitest.config.renderer.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/renderer/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/renderer/src/test/setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: ['src/renderer/src/**/*.{test,spec}.{ts,tsx}', 'src/renderer/src/**/__tests__/**'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50
      }
    }
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer/src')
    }
  }
});
```

### Update Minions vitest.config.ts for Coverage

```typescript
// minions/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'bin/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70
      }
    }
  }
});
```

## Branch Protection and Quality Gates

### Recommended GitHub Branch Protection Rules

```yaml
Branch: main (or master)
Settings:
  - Require pull request before merging: ✓
  - Require approvals: 1
  - Dismiss stale reviews: ✓
  - Require review from Code Owners: ✓ (if CODEOWNERS file exists)
  - Require status checks to pass: ✓
    Required checks:
      - lint
      - test-gui (ubuntu-latest)
      - test-gui (macos-latest)
      - test-gui (windows-latest)
      - test-minions
      - build-gui
  - Require branches to be up to date: ✓
  - Require linear history: ✓ (optional, depends on workflow preference)
  - Include administrators: ✓
  - Allow force pushes: ✗
  - Allow deletions: ✗
```

### Status Check Configuration

```yaml
# .github/workflows/ci.yml
# Add to each job:
jobs:
  test-gui:
    # ... existing config
    timeout-minutes: 20  # Prevent hanging tests

  test-minions:
    # ... existing config
    timeout-minutes: 10
```

## Performance Optimization

### Estimated Time Savings

**Current State (if all tests run every time):**
- GUI tests: ~5-10 minutes (16 main + 3 renderer tests)
- Minions tests: ~2-3 minutes (3 tests with some integration tests)
- Total: ~7-13 minutes per CI run

**With Intelligent Test Selection:**
- Small changes (1-2 files): ~1-3 minutes (only affected tests)
- Medium changes (package-level): ~5-8 minutes (one package)
- Large changes or main branch: ~7-13 minutes (all tests)

**Expected Savings:**
- Feature branch commits: 50-70% faster
- PR iterations: 30-50% faster
- Main branch: No change (full run for safety)

### Parallel Execution Strategy

```yaml
# Run GUI tests across 3 OS simultaneously
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
  fail-fast: false  # Continue other OS tests if one fails

# Run GUI and Minions tests in parallel (different jobs)
jobs:
  test-gui:     # Job 1
  test-minions: # Job 2 (runs simultaneously)
```

### Test Sharding (Future Enhancement)

For very large test suites, consider sharding:

```yaml
strategy:
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx vitest run --shard=${{ matrix.shard }}/4
```

## Monitoring and Reporting

### Test Results Reporting

```yaml
# Add to each test job
- name: Test Summary
  if: always()
  uses: test-summary/action@v2
  with:
    paths: |
      gui/test-results.xml
      minions/test-results.xml
```

### Coverage Reporting

```yaml
# Add Codecov integration
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v4
  with:
    token: ${{ secrets.CODECOV_TOKEN }}
    files: ./coverage/coverage-final.json
    flags: gui-${{ matrix.os }}
    fail_ci_if_error: false  # Don't fail CI on coverage upload issues
```

### Performance Tracking

```yaml
# Add to detect-changes job
- name: Report test selection
  run: |
    echo "### Test Selection Results 🧪" >> $GITHUB_STEP_SUMMARY
    echo "- Run all tests: ${{ steps.detect.outputs.run_all_tests }}" >> $GITHUB_STEP_SUMMARY
    echo "- Test GUI: ${{ steps.detect.outputs.test_gui }}" >> $GITHUB_STEP_SUMMARY
    echo "- Test Minions: ${{ steps.detect.outputs.test_minions }}" >> $GITHUB_STEP_SUMMARY
    echo "- Changed files: $(git diff --name-only HEAD^ HEAD | wc -l)" >> $GITHUB_STEP_SUMMARY
```

## Automated Testing Strategy

### Test Automation Framework

#### 1. Unit Testing
**Current State:**
- 22 unit tests using Vitest
- Co-located in `__tests__/` directories
- Mocking external dependencies (fs, child_process, Electron API)

**Automation Enhancements:**
- **Coverage Requirements**: Enforce minimum coverage thresholds in CI
  - GUI Main Process: 60% coverage
  - GUI Renderer: 50% coverage
  - Minions: 70% coverage
- **Coverage Reporting**: Automatic coverage reports in PRs via Codecov
- **Mutation Testing**: Consider adding mutation testing to validate test quality
  - Tool: Stryker Mutator
  - Run weekly or on-demand
- **Test Generation**: Consider AI-powered test generation for uncovered paths
  - Tool: GitHub Copilot, TestPilot, or similar

#### 2. Integration Testing
**Current State:**
- 3 integration tests (PRPolling, TerminalService, setup, worktree)
- Use real file system operations
- Test full workflows

**Automation Strategy:**
- **Always run on PRs to main**: Ensure integration tests run before merging
- **Dedicated integration test job**: Separate from unit tests for clarity
- **Docker environment**: Consider containerized test environment for consistency
- **Test data management**: Seed test data in setup, clean up in teardown
- **Extended timeout**: Integration tests get longer timeout (30 minutes)

#### 3. End-to-End (E2E) Testing
**Current State:**
- Manual testing only (documented in TESTING.md)
- 10 manual test scenarios

**Proposed E2E Automation:**

**Tool Selection**: Playwright for Electron
- Playwright supports Electron applications
- Cross-platform support (Windows, macOS, Linux)
- Built-in test runner and assertions
- Screenshot and video recording on failure

**E2E Test Suite Structure:**
```
gui/e2e/
├── fixtures/
│   ├── projects.ts          # Test project fixtures
│   └── missions.ts          # Test mission fixtures
├── tests/
│   ├── project-selection.spec.ts
│   ├── missions-dashboard.spec.ts
│   ├── sidebar-navigation.spec.ts
│   ├── terminal-integration.spec.ts
│   ├── signal-detection.spec.ts
│   ├── file-watching.spec.ts
│   ├── cursor-integration.spec.ts
│   ├── test-workflow.spec.ts
│   ├── stop-minion.spec.ts
│   └── terminal-resize.spec.ts
├── playwright.config.ts
└── README.md
```

**E2E CI Integration:**
```yaml
# Add to ci.yml
e2e-tests:
  needs: [build-gui]
  runs-on: ${{ matrix.os }}
  strategy:
    matrix:
      os: [ubuntu-latest, macos-latest, windows-latest]
  steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Install Playwright
      run: npx playwright install --with-deps

    - name: Download build artifacts
      uses: actions/download-artifact@v4
      with:
        name: gui-build
        path: gui/dist/

    - name: Run E2E tests
      run: npm run test:e2e -w gui

    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: e2e-results-${{ matrix.os }}
        path: |
          gui/e2e/test-results/
          gui/e2e/screenshots/
          gui/e2e/videos/
        retention-days: 7
```

**E2E Test Execution Strategy:**
- **Scheduled runs**: Run full E2E suite nightly or on main branch
- **PR smoke tests**: Run critical E2E tests on PRs (project selection, missions dashboard)
- **Manual trigger**: Allow manual workflow dispatch for full E2E run
- **Visual regression**: Consider adding visual regression testing (Percy, Chromatic)

#### 4. Performance Testing
**Current State:**
- No automated performance testing

**Proposed Performance Testing:**

**Metrics to Track:**
- App startup time
- Terminal rendering performance
- File watcher responsiveness
- Memory usage over time
- CPU usage during operations

**Tools:**
- **Lighthouse CI**: For renderer performance metrics
- **Custom benchmarks**: Using Vitest's benchmark mode
- **Memory profiling**: Using Chrome DevTools Protocol

**Performance CI Integration:**
```yaml
performance-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Run performance benchmarks
      run: npm run test:perf -w gui

    - name: Store benchmark results
      uses: benchmark-action/github-action-benchmark@v1
      with:
        tool: 'benchmarkjs'
        output-file-path: gui/benchmark-results.json
        github-token: ${{ secrets.GITHUB_TOKEN }}
        auto-push: true
        alert-threshold: '150%'  # Alert if performance degrades by 50%
        comment-on-alert: true
```

**Benchmark Test Structure:**
```typescript
// gui/src/main/services/__tests__/performance.bench.ts
import { bench, describe } from 'vitest';
import { AgentService } from '../AgentService';

describe('AgentService Performance', () => {
  bench('createAgent', async () => {
    const service = new AgentService();
    await service.createAgent({...config});
  });

  bench('listAgents', async () => {
    const service = new AgentService();
    await service.listAgents();
  });
});
```

#### 5. Smoke Testing
**Purpose**: Quick validation that critical functionality works

**Smoke Test Suite:**
- App launches successfully
- Main window renders
- Terminal can be created
- Project can be selected
- Basic IPC communication works

**CI Integration:**
- Run on every commit
- Fast execution (<2 minutes)
- Fail fast on critical issues

```yaml
smoke-tests:
  runs-on: ubuntu-latest
  steps:
    - name: Run smoke tests
      run: npm run test:smoke -w gui
      timeout-minutes: 5
```

#### 6. Regression Testing
**Strategy**: Maintain test suite that covers all bug fixes

**Implementation:**
- When a bug is fixed, add a test that would have caught it
- Tag tests with issue numbers: `it('should fix #123', ...)`
- Run regression suite on every PR
- Consider using test case management tool (TestRail, Zephyr)

#### 7. Security Testing
**Automated Security Scans:**

```yaml
security-scan:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Run npm audit
      run: npm audit --audit-level=moderate
      continue-on-error: true

    - name: Run Snyk security scan
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      with:
        args: --severity-threshold=high

    - name: Run CodeQL analysis
      uses: github/codeql-action/analyze@v3
```

**Security Test Coverage:**
- Dependency vulnerabilities (npm audit, Snyk)
- Code vulnerabilities (CodeQL, Semgrep)
- Secret scanning (GitHub secret scanning, TruffleHog)
- License compliance (FOSSA, LicenseFinder)

#### 8. Accessibility Testing
**Automated A11y Testing:**

```typescript
// gui/src/renderer/src/__tests__/accessibility.test.tsx
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import App from '../App';

expect.extend(toHaveNoViolations);

describe('Accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(<App />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

**Tools:**
- jest-axe or vitest-axe
- pa11y for automated scanning
- Lighthouse CI for accessibility audits

#### 9. Test Data Management
**Strategy:**
- **Fixtures**: Reusable test data in JSON/TypeScript files
- **Factories**: Test data builders for complex objects
- **Seeders**: Populate test database/storage
- **Cleanup**: Automatic cleanup after tests

**Implementation:**
```typescript
// gui/src/main/services/__tests__/fixtures/projects.ts
export const testProjects = {
  validProject: {
    id: 'test-project-1',
    name: 'Test Project',
    path: '/tmp/test-project',
    gitUrl: 'https://github.com/test/repo.git'
  },
  // ... more fixtures
};

// Usage in tests
import { testProjects } from './fixtures/projects';

it('should handle valid project', () => {
  const result = validateProject(testProjects.validProject);
  expect(result.valid).toBe(true);
});
```

#### 10. Test Maintenance Automation
**Strategies:**
- **Automatic test discovery**: Vitest auto-discovers tests
- **Unused test detection**: Find tests that no longer test existing code
- **Test duplication detection**: Identify similar tests
- **Test smell detection**: ESLint rules for test quality
- **Automatic test updates**: Use codemods for API changes

**ESLint Rules for Tests:**
```json
{
  "overrides": [
    {
      "files": ["**/__tests__/**", "**/*.test.ts"],
      "rules": {
        "jest/no-disabled-tests": "warn",
        "jest/no-focused-tests": "error",
        "jest/no-identical-title": "error",
        "jest/valid-expect": "error"
      }
    }
  ]
}
```

### Test Automation Metrics

**Track these metrics in CI:**
- Test count (total, by type, by package)
- Test execution time (per test, per suite, total)
- Test flakiness rate
- Coverage percentage (lines, branches, functions)
- Failed test rate
- Mean time to recovery (MTTR) for failed tests

**Metrics Dashboard:**
- Use GitHub Actions artifacts to store metrics
- Visualize in GitHub Pages or external dashboard
- Alert on metric degradation

### Test Automation Best Practices

1. **Fast Feedback**: Run fastest tests first (unit → integration → E2E)
2. **Isolated Tests**: Each test should be independent
3. **Deterministic**: Tests should produce same results every time
4. **Maintainable**: Tests should be easy to understand and update
5. **Comprehensive**: Cover happy paths, edge cases, and error scenarios
6. **Descriptive**: Test names should clearly describe what they test
7. **DRY**: Reuse test utilities and fixtures
8. **Fail Fast**: Stop test run on first failure (optional)
9. **Parallelization**: Run tests in parallel when possible
10. **Continuous Improvement**: Regularly review and improve test suite

## Implementation Checklist

### Phase 1: Basic CI Setup (Priority: High)
- [ ] Create `.github/workflows/ci.yml` with basic test execution
- [ ] Add lint job with TypeScript type checking
- [ ] Add test jobs for GUI and Minions packages
- [ ] Configure dependency caching (npm cache)
- [ ] Add build job to validate compilation
- [ ] Test workflow on feature branch
- [ ] Verify all jobs pass

### Phase 2: Intelligent Test Selection (Priority: High)
- [ ] Create `.github/scripts/analyze-changes.js` script
- [ ] Implement change detection logic
- [ ] Add `detect-changes` job to CI workflow
- [ ] Update test jobs to use intelligent selection
- [ ] Add fallback to full test run on errors
- [ ] Test with various change scenarios:
  - [ ] Single file change in GUI
  - [ ] Single file change in Minions
  - [ ] Config file change (should trigger full run)
  - [ ] CI file change (should trigger full run)
  - [ ] Multiple package changes
- [ ] Validate time savings on feature branches

### Phase 3: Coverage and Reporting (Priority: Medium)
- [ ] Add coverage configuration to all Vitest configs
- [ ] Install coverage dependencies (`@vitest/coverage-v8`)
- [ ] Configure coverage thresholds:
  - [ ] GUI main: 60%
  - [ ] GUI renderer: 50%
  - [ ] Minions: 70%
- [ ] Set up Codecov account and token
- [ ] Add coverage upload to CI workflow
- [ ] Add coverage badges to README
- [ ] Configure coverage reporting in PRs

### Phase 4: Cross-Platform Testing (Priority: Medium)
- [ ] Update GUI test job to use matrix strategy (ubuntu, macos, windows)
- [ ] Test native module rebuild on all platforms
- [ ] Verify electron-builder works on all platforms
- [ ] Add platform-specific test exclusions if needed
- [ ] Monitor for platform-specific failures

### Phase 5: Branch Protection (Priority: High)
- [ ] Enable branch protection on main/master
- [ ] Require status checks to pass before merging
- [ ] Configure required checks (all test jobs)
- [ ] Require pull request reviews
- [ ] Test protection rules with a test PR

### Phase 6: Performance Optimization (Priority: Low)
- [ ] Add Vitest cache to workflow
- [ ] Add Electron native modules cache
- [ ] Measure baseline CI execution time
- [ ] Optimize slow tests or mark as integration tests
- [ ] Consider test sharding if needed
- [ ] Monitor cache hit rates

### Phase 7: Enhanced Reporting (Priority: Low)
- [ ] Add test summary action
- [ ] Add GitHub step summaries for test selection
- [ ] Configure test result annotations
- [ ] Add performance tracking
- [ ] Set up notifications for CI failures (Slack, email)

### Phase 8: E2E Testing Automation (Priority: Medium)
- [ ] Install Playwright and configure for Electron
- [ ] Create E2E test structure (`gui/e2e/`)
- [ ] Convert manual tests to automated E2E tests:
  - [ ] Test 1: Project Selection
  - [ ] Test 2: Missions Dashboard
  - [ ] Test 3: Sidebar and Navigation
  - [ ] Test 4: Terminal Integration
  - [ ] Test 5: Signal Detection
  - [ ] Test 6: File Watching
  - [ ] Test 7: Cursor IDE Integration
  - [ ] Test 8: Test Script Workflow
  - [ ] Test 9: Stop Minion
  - [ ] Test 10: Terminal Resize
- [ ] Add E2E job to CI workflow (nightly or on-demand)
- [ ] Configure screenshot/video capture on failure
- [ ] Add visual regression testing (optional)

### Phase 9: Advanced Testing (Priority: Low)
- [ ] Add performance benchmarks
- [ ] Set up benchmark tracking in CI
- [ ] Add security scanning (npm audit, Snyk, CodeQL)
- [ ] Add accessibility testing (jest-axe)
- [ ] Configure mutation testing (optional)
- [ ] Add license compliance scanning (optional)

### Phase 10: Maintenance and Monitoring (Ongoing)
- [ ] Create test metrics dashboard
- [ ] Set up alerts for flaky tests
- [ ] Schedule weekly test suite review
- [ ] Document test automation practices in CONTRIBUTING.md
- [ ] Train team on test automation tools
- [ ] Establish test writing guidelines
- [ ] Monitor and optimize CI costs

## Success Metrics

### Immediate (Phase 1-2)
- ✅ CI workflow runs on every PR and push
- ✅ All existing tests pass in CI
- ✅ Test selection works correctly for different change types
- ✅ CI run time reduced by 30-50% on feature branches

### Short-term (Phase 3-5)
- ✅ Coverage thresholds enforced
- ✅ Branch protection prevents failing code from merging
- ✅ CI passes on all platforms (Ubuntu, macOS, Windows)
- ✅ Coverage reports visible in PRs

### Medium-term (Phase 6-8)
- ✅ CI run time optimized with caching
- ✅ E2E tests cover all critical user workflows
- ✅ Test automation reduces manual testing by 80%
- ✅ Automated E2E tests run nightly

### Long-term (Phase 9-10)
- ✅ Performance benchmarks track app performance over time
- ✅ Security vulnerabilities caught automatically
- ✅ Test suite is maintainable and well-documented
- ✅ Team confidence in automated testing is high
- ✅ CI costs are optimized and predictable

## Risks and Mitigations

### Risk 1: Flaky Tests
**Description**: Tests that randomly fail due to timing issues, race conditions, or environment differences.

**Mitigation:**
- Use proper async/await patterns
- Add explicit waits instead of arbitrary timeouts
- Retry flaky tests automatically (Vitest retries: 3)
- Quarantine consistently flaky tests
- Monitor flakiness rate and fix root causes

### Risk 2: Slow CI Execution
**Description**: CI runs take too long, slowing down development.

**Mitigation:**
- Intelligent test selection reduces test count
- Parallel job execution (GUI, Minions, multiple OS)
- Aggressive caching (dependencies, Vitest cache, native modules)
- Skip E2E tests on feature branches (run nightly instead)
- Use faster runners if needed (GitHub paid runners)

### Risk 3: False Positives from Test Selection
**Description**: Intelligent selection might miss tests that should run.

**Mitigation:**
- Always run full test suite on main branch
- Always run integration tests on PRs to main
- Fallback to full run if selection logic fails
- Regularly validate selection accuracy
- Allow manual trigger of full test run

### Risk 4: Platform-Specific Failures
**Description**: Tests pass on one OS but fail on others (especially Electron native modules).

**Mitigation:**
- Test on all three platforms (Ubuntu, macOS, Windows)
- Use electron-rebuild to ensure native modules work
- Document platform-specific issues
- Consider platform-specific test exclusions
- Monitor platform-specific failure rates

### Risk 5: Coverage Regression
**Description**: Coverage drops as new code is added without tests.

**Mitigation:**
- Enforce coverage thresholds in CI
- Block PRs that decrease coverage significantly
- Add coverage reports to PRs for visibility
- Encourage test-driven development (TDD)
- Regular coverage review meetings

### Risk 6: Test Maintenance Burden
**Description**: Test suite becomes difficult to maintain as it grows.

**Mitigation:**
- Follow test automation best practices
- Use fixtures and factories for test data
- Avoid test duplication
- Regular test suite refactoring
- Good test documentation
- ESLint rules for test quality

### Risk 7: CI Cost
**Description**: Running CI on multiple platforms and jobs increases GitHub Actions minutes.

**Mitigation:**
- Intelligent test selection reduces minutes used
- Use public repository (free unlimited minutes)
- If private, monitor usage and optimize
- Consider self-hosted runners for cost savings
- Skip redundant jobs (e.g., Windows tests only on main)

## Future Enhancements

### Advanced Test Selection
- **Dependency graph analysis**: Build a full dependency graph to select tests more accurately
- **Historical failure analysis**: Prioritize tests that have failed recently
- **Impact analysis**: Estimate risk of changes and adjust test selection
- **ML-based selection**: Use machine learning to predict which tests should run

### Enhanced E2E Testing
- **Visual regression testing**: Detect unintended UI changes (Percy, Chromatic)
- **Cross-browser testing**: Test renderer in different browsers (if applicable)
- **Mobile testing**: Test on mobile if app has mobile version
- **Load testing**: Simulate high load scenarios
- **Chaos engineering**: Introduce failures to test resilience

### Advanced Monitoring
- **Test analytics dashboard**: Visualize test trends over time
- **Flakiness detection**: Automatically detect and report flaky tests
- **Performance tracking**: Track CI performance metrics
- **Cost analysis**: Monitor and optimize GitHub Actions costs
- **Test recommendations**: Suggest which tests to write based on coverage gaps

### Developer Experience
- **Local pre-commit hooks**: Run linting and tests before commit (Husky)
- **Git hooks for test selection**: Run only affected tests locally
- **Test debugging tools**: Better debugging experience for failed tests
- **Test generation**: AI-powered test generation for new code
- **Interactive test runner**: UI for running and debugging tests

### Integration Enhancements
- **Deploy previews**: Deploy PR builds for manual testing (Vercel, Netlify)
- **Changelog generation**: Auto-generate changelog from commits
- **Release automation**: Automate versioning and release notes
- **Slack/Discord notifications**: Notify team of CI status
- **Issue linking**: Automatically link PRs to related issues

## Rollback Plan

If CI causes issues, follow this rollback procedure:

### Step 1: Disable Branch Protection
- Go to GitHub repo Settings → Branches
- Edit branch protection rule for main/master
- Uncheck "Require status checks to pass"
- Save changes

### Step 2: Disable Workflow
- Go to `.github/workflows/ci.yml`
- Add `if: false` to the workflow:
  ```yaml
  on:
    pull_request:
      branches: [main, master]

  jobs:
    test:
      if: false  # Disable workflow
  ```

### Step 3: Revert CI Changes
- If issues persist, revert the PR that added CI:
  ```bash
  git revert <commit-hash>
  git push origin main
  ```

### Step 4: Communicate
- Notify team that CI is disabled
- Investigate root cause of issues
- Fix issues in a new PR
- Re-enable CI once fixed

## Documentation Updates

### Files to Create/Update

1. **CONTRIBUTING.md**: Add section on CI and testing
   - How to run tests locally
   - How to interpret CI results
   - How to fix common CI failures

2. **README.md**: Add CI status badges
   ```markdown
   ![CI Status](https://github.com/yhindy/agent_framework/workflows/CI/badge.svg)
   ![Coverage](https://codecov.io/gh/yhindy/agent_framework/branch/main/graph/badge.svg)
   ```

3. **TESTING.md**: Update with automated testing info
   - Link to CI workflow
   - Explain intelligent test selection
   - Document E2E test suite
   - Add troubleshooting section for CI

4. **.github/PULL_REQUEST_TEMPLATE.md**: Add checklist
   ```markdown
   - [ ] Tests pass locally
   - [ ] Added tests for new functionality
   - [ ] CI checks pass
   - [ ] Coverage thresholds met
   ```

## Conclusion

This plan provides a comprehensive roadmap for implementing CI with intelligent test selection. The phased approach allows for incremental implementation and validation, reducing risk and ensuring each component works correctly before moving to the next.

The intelligent test selection system will significantly reduce CI execution time on feature branches while maintaining full test coverage on the main branch. Combined with comprehensive automated testing (unit, integration, E2E, performance, security), the CI system will ensure code quality and catch issues early in the development process.

Key benefits:
- **Faster feedback**: Reduced CI time means faster iterations
- **Higher quality**: Automated tests catch bugs before they reach production
- **Confidence**: Comprehensive test coverage gives confidence in changes
- **Efficiency**: Intelligent selection optimizes resource usage
- **Maintainability**: Well-structured CI system is easy to maintain and extend

The implementation should proceed in phases, starting with basic CI setup and gradually adding more sophisticated features. Each phase should be tested thoroughly before moving to the next, and metrics should be tracked to validate improvements.
