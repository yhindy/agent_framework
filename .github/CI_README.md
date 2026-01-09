# CI System Documentation

## Overview

This repository uses GitHub Actions for Continuous Integration with intelligent test selection to optimize CI execution time.

## Workflows

### Main CI Workflow (`.github/workflows/ci.yml`)

Runs on:
- Pull requests to `main` or `master`
- Pushes to `main`, `master`, or `feature/**` branches
- Manual workflow dispatch (with optional full test run)

**Jobs:**
1. **detect-changes**: Analyzes changed files and determines which tests to run
2. **lint**: Runs type checking and linting
3. **test-gui**: Runs GUI tests (main process + renderer) on Ubuntu, macOS, and Windows
4. **test-minions**: Runs Minions package tests
5. **build-gui**: Builds the GUI as a smoke test

## Intelligent Test Selection

The CI system uses intelligent test selection to reduce execution time on feature branches while maintaining full coverage on the main branch.

### Selection Rules

1. **Full Test Run** (highest priority):
   - Changes to CI configuration files (`.github/workflows/*`, `.github/scripts/*`)
   - Changes to test configuration (`vitest.config.ts`, `tsconfig.json`)
   - Changes to root `package.json` or `package-lock.json`
   - Push to `main` or `master` branch
   - Pull request targeting `main` or `master` branch
   - Manual workflow dispatch with `full_run=true`

2. **Package-Level Selection**:
   - Changes to `gui/**` → Run all GUI tests
   - Changes to `minions/**` → Run all Minions tests

3. **File-Level Intelligent Selection**:
   - Within a package, uses Vitest's `--changed` flag to run only tests related to changed files
   - Leverages Git history and import dependencies

### Expected Performance

- **Feature branch commits**: 50-70% faster (only affected tests run)
- **Pull requests**: 30-50% faster (intelligent selection + integration tests)
- **Main branch**: Full test suite (no time savings, maximum confidence)

## Running Tests Locally

### Run all tests
```bash
npm test                  # Run all tests in all packages
npm run gui:test         # Run GUI tests only
npm run minions:test     # Run Minions tests only
```

### Run tests with coverage
```bash
cd gui && npm test -- --coverage          # GUI with coverage
cd minions && npm test -- --coverage      # Minions with coverage
```

### Run tests with intelligent selection (changed files only)
```bash
cd gui && npm test -- --changed           # Only tests related to changed files
cd minions && npm test -- --changed
```

### Run specific test file
```bash
cd gui && npm test -- src/main/services/__tests__/AgentService.test.ts
```

## Coverage Requirements

Coverage thresholds are enforced in CI:

- **GUI Main Process**: 60% (lines, functions, branches, statements)
- **GUI Renderer**: 50% (lines, functions, branches, statements)
- **Minions**: 70% lines and functions, 60% branches

These thresholds are configured in the respective `vitest.config.ts` files.

Coverage reports are uploaded to Codecov (if configured) and viewable in PR comments.

## Caching

The CI workflow uses several caching strategies to speed up execution:

1. **npm dependencies**: Cached by `actions/setup-node@v4`
2. **Vitest cache**: Stores Vitest's internal cache between runs
3. **Electron native modules**: (Future) Cache for electron-rebuild

## Cross-Platform Testing

GUI tests run on three platforms:
- **ubuntu-latest**: Linux (fastest, primary platform for coverage)
- **macos-latest**: macOS (for platform-specific issues)
- **windows-latest**: Windows (for platform-specific issues)

Minions tests run on Ubuntu only (Node.js library, platform-agnostic).

## Manual Workflow Dispatch

You can manually trigger the CI workflow from the GitHub Actions tab:

1. Go to Actions → CI workflow
2. Click "Run workflow"
3. Select branch
4. Optionally check "Run all tests" to force full test run
5. Click "Run workflow"

## Troubleshooting

### Tests pass locally but fail in CI

- Check if native modules need rebuilding (GUI package)
- Verify Node.js version matches (20.x)
- Check for platform-specific issues (paths, line endings)
- Review test logs in GitHub Actions

### Coverage threshold failures

- Run tests locally with coverage: `npm test -- --coverage`
- Add tests for uncovered code
- Or adjust thresholds in `vitest.config.ts` (with team approval)

### Intelligent selection selects wrong tests

- The system falls back to full test run when in doubt
- On main/master branch, always runs full suite
- You can manually trigger full run via workflow dispatch

### Tests are slow in CI

- Check if test selection is working (review detect-changes job output)
- Consider marking slow tests as integration tests
- Review caching effectiveness

## Future Enhancements

- **E2E Testing**: Playwright-based E2E tests for critical user workflows
- **Performance Benchmarks**: Track app performance over time
- **Security Scanning**: Automated security vulnerability detection
- **Visual Regression**: Detect unintended UI changes
- **Test Sharding**: Split test suite across multiple runners for very large suites

## Questions?

If you encounter issues with CI or have questions:
1. Check this documentation
2. Review the implementation plan: `CI_IMPLEMENTATION_PLAN.md`
3. Open an issue with the `ci` label
4. Ask in team chat/Slack
