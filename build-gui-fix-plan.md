# Plan: Fix build-gui CI Test Failure

> **⚠️ Note**: This document represents the initial plan. During implementation, we discovered the root cause was different than originally diagnosed. The **actual solution** was much simpler: add `electron` to root `package.json` devDependencies. See the "Actual Implementation" section at the end for what was actually done.

## Problem Statement

The `build-gui` job in CI is failing with the error:
```
Error: Cannot find module 'electron/package.json'
```

This occurs because `electron-vite` needs to find the `electron` package to determine the Electron major version during the build process. The issue is that `electron` is a dev dependency in the `gui` workspace, and the current CI configuration (`npm ci` at root level) may not be installing workspace dev dependencies correctly on the Ubuntu runner.

## Root Cause Analysis

1. **Workspace dependency resolution**: The root `package.json` has workspaces `["gui", "minions"]`
2. **Electron location**: `electron` is in `gui/devDependencies` (line 35 of gui/package.json)
3. **Build requirement**: `electron-vite build` needs to resolve `electron/package.json` to get the major version
4. **CI failure point**: The `build-gui` job runs `npm ci` at root, then `npm run build -w gui`
5. **Missing step**: Unlike `test-gui` which rebuilds native modules, `build-gui` doesn't ensure workspace dependencies are installed

## Acceptance Criteria

- [ ] The `build-gui` CI job successfully completes on ubuntu-latest runner
- [ ] The build command `npm run build -w gui` produces all three bundles (main, preload, renderer)
- [ ] Build artifacts are uploaded successfully to GitHub Actions artifacts
- [ ] No regression in other CI jobs (lint, test-gui, test-minions)
- [ ] Build time remains reasonable (< 5 minutes for build step)
- [ ] Solution works consistently across all branches and PR contexts

---

## Implementation Plan

### Phase 1: Fix the Immediate Issue (Priority: CRITICAL)

**Task 1.1: Update build-gui job to install workspace dependencies**

Modify `.github/workflows/ci.yml` to ensure workspace dependencies are installed before building:

**Option A (Recommended)**: Add explicit workspace install
```yaml
- name: Install dependencies
  run: npm ci

- name: Install workspace dependencies  # NEW STEP
  run: npm ci -w gui
```

**Option B (Alternative)**: Use `--include-workspace-root` flag
```yaml
- name: Install dependencies
  run: npm ci --include-workspace-root
```

**Decision**: Choose Option A for explicitness and consistency with test-gui job pattern.

**Files to modify**:
- `.github/workflows/ci.yml` (lines 187-191)

**Expected outcome**: `electron` package will be available in `gui/node_modules/electron/`, allowing `electron-vite` to resolve `electron/package.json`

---

### Phase 2: Add Verification and Robustness

**Task 2.1: Add pre-build verification step**

Add a step to verify that critical dependencies are available before building:

```yaml
- name: Verify build dependencies
  run: |
    echo "Checking for electron package..."
    if [ ! -f "gui/node_modules/electron/package.json" ]; then
      echo "::error::electron package not found in gui/node_modules"
      exit 1
    fi
    echo "✓ electron package found"
```

**Task 2.2: Add build output verification**

Verify that all expected build artifacts are created:

```yaml
- name: Verify build output
  run: |
    echo "Checking build artifacts..."
    test -f gui/out/main/index.js || (echo "::error::main bundle missing" && exit 1)
    test -f gui/out/preload/index.js || (echo "::error::preload bundle missing" && exit 1)
    test -f gui/out/renderer/index.html || (echo "::error::renderer bundle missing" && exit 1)
    echo "✓ All build artifacts present"
```

---

### Phase 3: Optimization and Consistency

**Task 3.1: Add npm caching to build-gui job**

For consistency with other jobs and faster CI runs, add caching:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'  # Already present, good!
```

**Task 3.2: Consider adding timeout**

Add explicit timeout to prevent hanging builds:

```yaml
build-gui:
  timeout-minutes: 10  # Add this line
  needs: [lint, test-gui, test-minions]
```

**Rationale**: test-gui has 20min, test-minions has 10min, build should be faster than tests.

---

### Phase 4: Documentation and Testing Strategy

**Task 4.1: Update CLAUDE.md**

Document the build-gui job fix in the troubleshooting section:

```markdown
## Troubleshooting

### Build-GUI CI Failure (electron package not found)
If build-gui fails with "Cannot find module 'electron/package.json'":
- Ensure workspace dependencies are installed: `npm ci -w gui`
- Verify electron is in gui/node_modules: `ls gui/node_modules/electron/`
- Check that npm workspaces are configured correctly in root package.json
```

**Task 4.2: Add CI/CD documentation section**

Enhance the CI/CD Pipeline section in CLAUDE.md:

```markdown
## CI/CD Pipeline Details

### build-gui Job
- **Purpose**: Smoke test the production build
- **Runner**: ubuntu-latest (Linux/x64)
- **Timeout**: 10 minutes
- **Dependencies**: Requires lint, test-gui, test-minions to pass or be skipped
- **Key steps**:
  1. Install root dependencies: `npm ci`
  2. Install workspace dependencies: `npm ci -w gui`
  3. Verify electron package available
  4. Build: `npm run build -w gui`
  5. Verify artifacts created
  6. Upload artifacts (7-day retention)
```

---

## Automated Testing Section

### Current Testing Strategy

**Test Coverage by Job**:

1. **detect-changes** (ubuntu-latest)
   - Analyzes git diff to determine which tests to run
   - Uses `.github/scripts/analyze-changes.js`
   - Outputs: test selection flags and file patterns
   - **No direct tests** (analysis job)

2. **lint** (ubuntu-latest)
   - Type checking: `npm run typecheck -w gui`
   - Linting: `npm run lint --if-present`
   - **Validates**: TypeScript type safety, code style
   - **Coverage**: 100% of TypeScript files

3. **test-gui** (macos-latest, 20min timeout)
   - Unit tests: `npm run test -w gui -- --run --coverage`
   - **Framework**: Vitest with jsdom
   - **Coverage targets**: 60% (lines, functions, branches, statements)
   - **Test location**: `gui/src/main/services/__tests__/*.test.ts`
   - **Mocking**: Uses `vi.mock()` for external dependencies
   - **Special requirements**: Rebuilds node-pty native module
   - **Intelligent selection**: Runs subset of tests based on changed files

4. **test-minions** (ubuntu-latest, 10min timeout)
   - Unit tests: `npm run test -w minions -- --run --coverage`
   - **Framework**: Vitest
   - **Coverage targets**: 70% lines/functions, 60% branches
   - **Test location**: `minions/__tests__/*.test.ts`
   - **Intelligent selection**: Runs subset based on changes

5. **build-gui** (ubuntu-latest, no timeout currently)
   - **Current state**: Smoke test (build succeeds)
   - **No explicit tests**: Only verifies build completes
   - **Missing validation**: No verification of build output quality

---

### Testing Gaps and Improvements

#### Gap 1: Build Output Validation
**Current**: build-gui only checks that the build command exits successfully
**Missing**:
- No validation that bundles contain expected exports
- No size regression checks
- No validation that bundled dependencies are correct

**Proposed improvement**:
```yaml
- name: Test build output
  run: |
    cd gui
    # Check bundle sizes (prevent bloat)
    MAX_MAIN_SIZE=200000  # 200KB
    MAIN_SIZE=$(stat -c%s out/main/index.js)
    if [ $MAIN_SIZE -gt $MAX_MAIN_SIZE ]; then
      echo "::warning::Main bundle size ($MAIN_SIZE) exceeds $MAX_MAIN_SIZE"
    fi

    # Verify critical exports exist
    grep -q "electronApp" out/main/index.js || (echo "::error::Missing electronApp export" && exit 1)
```

#### Gap 2: Integration Testing
**Current**: Only unit tests exist
**Missing**:
- No end-to-end tests for agent lifecycle
- No tests for IPC communication between main and renderer
- No tests for terminal integration

**Proposed improvement**: Add E2E test job using Playwright or Spectron
```yaml
test-e2e:
  runs-on: macos-latest
  steps:
    - name: Run E2E tests
      run: npm run test:e2e -w gui
```

Would require adding to `gui/package.json`:
```json
"scripts": {
  "test:e2e": "playwright test"
}
```

#### Gap 3: Cross-Platform Build Testing
**Current**: build-gui only tests on ubuntu-latest
**Missing**:
- No validation that build works on macOS (where test-gui runs)
- No validation that build works on Windows
- Electron apps are platform-specific

**Proposed improvement**: Add matrix builds
```yaml
build-gui:
  strategy:
    matrix:
      os: [ubuntu-latest, macos-latest, windows-latest]
  runs-on: ${{ matrix.os }}
```

**Trade-off**: 3x CI time, but ensures cross-platform compatibility

#### Gap 4: Performance Regression Testing
**Current**: No performance benchmarks
**Missing**:
- No tracking of build time over commits
- No tracking of test execution time
- No memory usage monitoring

**Proposed improvement**: Add benchmark reporting
```yaml
- name: Report build time
  run: |
    echo "### Build Performance 📊" >> $GITHUB_STEP_SUMMARY
    echo "Build time: ${BUILD_TIME}s" >> $GITHUB_STEP_SUMMARY
```

#### Gap 5: Visual Regression Testing
**Current**: No UI visual validation
**Missing**:
- No screenshot comparison for renderer components
- UI changes could break without detection

**Proposed improvement**: Add visual regression tests using Percy or Chromatic
```yaml
- name: Visual regression tests
  run: npx percy exec -- npm run test:visual -w gui
```

#### Gap 6: Dependency Security Scanning
**Current**: No automated security checks
**Missing**:
- No scanning for vulnerable dependencies
- No license compliance checking

**Proposed improvement**: Add security scanning job
```yaml
security-scan:
  runs-on: ubuntu-latest
  steps:
    - name: Run npm audit
      run: npm audit --audit-level=high

    - name: Check for known vulnerabilities
      uses: snyk/actions/node@master
      env:
        SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

---

### Recommended Testing Roadmap

**Phase 1 (Immediate - Part of this PR)**:
- ✅ Fix build-gui job (install workspace deps)
- ✅ Add build output verification
- ✅ Add build artifact size checks
- ✅ Add explicit timeout to build-gui

**Phase 2 (Short-term - Next sprint)**:
- Add E2E tests for critical user flows
- Add cross-platform build validation (at least macOS + Linux)
- Add performance benchmarking

**Phase 3 (Medium-term - Within 2 sprints)**:
- Add visual regression testing for renderer components
- Add security scanning job
- Improve test coverage to 80%+ for critical services

**Phase 4 (Long-term - Future)**:
- Add integration tests for IPC layer
- Add stress tests for multi-agent scenarios
- Add automated accessibility testing

---

### Test Maintenance Guidelines

1. **Keep tests fast**:
   - Unit tests should run in < 10s locally
   - Full GUI test suite should complete in < 2min
   - Use mocking aggressively for slow operations

2. **Keep tests isolated**:
   - Each test should be runnable independently
   - Clear mocks in `beforeEach`
   - No shared state between tests

3. **Keep tests deterministic**:
   - No reliance on timing (use vi.advanceTimersByTime)
   - No reliance on external services
   - Mock all file system operations

4. **Keep test coverage meaningful**:
   - Focus on business logic, not trivial getters
   - Test error paths, not just happy paths
   - Test edge cases and boundary conditions

5. **Update tests with code changes**:
   - Failing tests indicate breaking changes
   - Never skip tests to "fix" CI
   - Fix root cause, don't delete tests

---

## Risk Assessment

### Low Risk:
- Adding workspace install step (identical to test-gui pattern)
- Adding verification steps (fail-fast on issues)
- Adding timeout (prevents hanging)

### Medium Risk:
- None identified

### High Risk:
- None identified

### Rollback Plan:
If the fix causes issues, revert the CI workflow change. The build works locally, so the risk is minimal.

---

## Success Metrics

- [ ] build-gui job passes on CI for 5 consecutive runs
- [ ] Build time remains under 5 minutes
- [ ] No increase in CI costs (same number of steps, minimal time increase)
- [ ] Zero regressions in other CI jobs

---

## Implementation Order

1. **Implement Task 1.1**: Fix workspace dependency installation (CRITICAL)
2. **Implement Task 2.2**: Add build output verification (HIGH)
3. **Implement Task 3.2**: Add timeout (MEDIUM)
4. **Implement Task 2.1**: Add pre-build verification (MEDIUM)
5. **Implement Task 4.1**: Update CLAUDE.md troubleshooting (LOW)
6. **Implement Task 4.2**: Enhance CI/CD documentation (LOW)
7. **Implement Task 3.1**: Already done (cache: 'npm' is present)

---

## Testing This Plan

### Local verification:
```bash
# Simulate CI environment
rm -rf node_modules gui/node_modules
npm ci
npm ci -w gui
npm run build -w gui
ls -lh gui/out/main/index.js gui/out/preload/index.js gui/out/renderer/index.html
```

### CI verification:
1. Push changes to a test branch
2. Watch CI run at https://github.com/yhindy/agent_framework/actions
3. Verify build-gui job passes
4. Verify artifacts are uploaded
5. Download artifacts and inspect contents

---

## Estimated Effort

- **Implementation**: 30 minutes
- **Testing**: 15 minutes (1 CI run)
- **Documentation**: 15 minutes
- **Total**: ~1 hour

---

## Dependencies

- None (can be implemented immediately)

---

## Follow-up Tasks (Post-Fix)

1. Consider adding build-gui to PR required checks
2. Monitor build times over next week
3. Evaluate if cross-platform builds are needed
4. Consider adding E2E tests (see Automated Testing Section)

---

## Actual Implementation (What We Actually Did)

### Root Cause Discovery

During implementation, a debugger agent discovered the **actual root cause** was different from the initial diagnosis:

**Real Problem**: 
- `electron-vite` is installed at root level (hoisted by npm workspaces)
- `electron` was only in `gui/devDependencies`, so installed in `gui/node_modules/`
- When `electron-vite` calls `require.resolve('electron/package.json')`, Node's module resolution starts from where electron-vite is located (root)
- Node couldn't find electron because it wasn't in root `node_modules/`

**Why Initial Testing Passed Locally**:
- The `ELECTRON_MAJOR_VER` environment variable persisted in the shell from a previous build
- When set, electron-vite skips the `require.resolve()` call entirely
- This masked the underlying module resolution issue

### Actual Solution

**Simple and Clean**: Add `electron` to root `package.json` devDependencies

```json
{
  "devDependencies": {
    "@vitest/coverage-v8": "^3.2.4",
    "electron": "^28.2.3",  // Added this
    "vitest": "^3.2.4"
  }
}
```

This ensures:
1. npm installs electron at root level where electron-vite can find it
2. Node's module resolution works correctly
3. No workarounds or extra CI steps needed

### Files Actually Changed

1. **`package.json`**: Added electron to root devDependencies
2. **`package-lock.json`**: Updated with proper dependency tree
3. **`.github/workflows/ci.yml`**: Kept simple (just `npm ci`, no workarounds)
4. **`CLAUDE.md`**: 
   - Added "Dependency Management" section with clear conventions
   - Updated CI/CD Pipeline documentation to reflect simplified workflow
   - Updated troubleshooting guide

### Key Learnings

1. **Dependency Placement Matters**: Build tools at root need their dependencies at root too
2. **Environment Variables Can Mask Bugs**: Always test in a clean environment
3. **Simpler is Better**: The workaround (adding `npm ci -w gui`) was unnecessary complexity
4. **Document Conventions**: Established clear rules for where to place dependencies in a monorepo

### Final CI Results

✅ All checks passed on PR #60:
- detect-changes: SUCCESS
- lint: SUCCESS  
- test-gui: SUCCESS
- test-minions: SUCCESS
- **build-gui: SUCCESS** ← Fixed!

Build time: ~1 second for all three bundles

### Dependency Convention (Documented)

**Root `package.json`** → Build/test tools used across workspaces
- Examples: `electron`, `electron-vite`, `vitest`, `@vitest/coverage-v8`

**Workspace `package.json`** → Runtime-only dependencies
- Examples: `node-pty`, `electron-store`, `react`, `zustand`

**Key Rule**: If a root-level build tool needs to `require()` or `import` a package, that package must be in root devDependencies.

This prevents Node module resolution issues caused by npm workspace hoisting behavior.
