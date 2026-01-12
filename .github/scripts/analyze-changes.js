#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Get list of changed files between base ref and current HEAD
 */
function getChangedFiles() {
  try {
    // For pull requests, compare against the base branch
    // For push events, compare against the previous commit
    let baseRef = 'HEAD^';

    if (process.env.GITHUB_BASE_REF) {
      // This is a pull request
      baseRef = `origin/${process.env.GITHUB_BASE_REF}`;
    } else if (process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_EVENT_BEFORE) {
      // This is a push event
      baseRef = process.env.GITHUB_EVENT_BEFORE;
    }

    console.log(`Comparing against base: ${baseRef}`);

    const diffOutput = execSync(`git diff --name-only ${baseRef} HEAD`, {
      encoding: 'utf-8'
    });

    return diffOutput.split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting changed files:', error.message);
    console.log('Falling back to comparing against HEAD^');

    try {
      const diffOutput = execSync('git diff --name-only HEAD^ HEAD', {
        encoding: 'utf-8'
      });
      return diffOutput.split('\n').filter(Boolean);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError.message);
      return [];
    }
  }
}

/**
 * E2E test mapping: source files → relevant E2E tests
 */
const E2E_TEST_MAP = {
  // Main process entry and IPC
  'gui/src/main/index.ts': ['app-lifecycle.e2e.ts', 'ipc-communication.e2e.ts'],

  // Services
  'gui/src/main/services/TerminalService.ts': ['terminal.e2e.ts'],
  'gui/src/main/services/AgentService.ts': ['user-flows.e2e.ts', 'ipc-communication.e2e.ts'],
  'gui/src/main/services/ProjectService.ts': ['user-flows.e2e.ts', 'ipc-communication.e2e.ts'],

  // Preload (IPC bridge)
  'gui/src/preload/': ['ipc-communication.e2e.ts', 'app-lifecycle.e2e.ts'],

  // Renderer (UI)
  'gui/src/renderer/': ['user-flows.e2e.ts', 'app-lifecycle.e2e.ts'],

  // E2E infrastructure
  'gui/e2e/fixtures.ts': ['all'],
  'gui/e2e/electron-app.ts': ['all'],
  'gui/playwright.config.ts': ['all'],
};

/**
 * Determine which E2E tests to run based on changed files
 */
function getE2ETestsForChanges(changedFiles) {
  const e2eTests = new Set();
  let runAllE2E = false;
  let hasE2ERelevantChanges = false;

  for (const file of changedFiles) {
    // Direct E2E test file changes - run that specific test
    if (file.startsWith('gui/e2e/') && file.endsWith('.e2e.ts')) {
      e2eTests.add(file.replace('gui/e2e/', ''));
      hasE2ERelevantChanges = true;
      continue;
    }

    // Check against mapping
    for (const [pattern, tests] of Object.entries(E2E_TEST_MAP)) {
      if (file.startsWith(pattern) || file === pattern) {
        hasE2ERelevantChanges = true;
        if (tests.includes('all')) {
          runAllE2E = true;
        } else {
          tests.forEach(t => e2eTests.add(t));
        }
      }
    }

    // Any other GUI changes that aren't tests or docs
    if (file.startsWith('gui/src/') && !file.includes('__tests__') && !file.endsWith('.md')) {
      hasE2ERelevantChanges = true;
      // For unmapped files, add app-lifecycle as a baseline
      e2eTests.add('app-lifecycle.e2e.ts');
    }
  }

  return {
    shouldRunE2E: hasE2ERelevantChanges,
    runAllE2E,
    e2eTestFiles: runAllE2E ? [] : Array.from(e2eTests),
  };
}

/**
 * Analyze changed files and determine test selection strategy
 */
function analyzeChanges(changedFiles) {
  const result = {
    run_all_tests: 'false',
    test_gui: 'false',
    test_minions: 'false',
    test_e2e: 'false',
    gui_test_pattern: '',
    minions_test_pattern: '',
    e2e_test_pattern: ''
  };

  if (changedFiles.length === 0) {
    console.log('No changed files detected');
    return result;
  }

  console.log('Changed files:', changedFiles);

  // Rules for full test run - highest priority
  const fullRunTriggers = [
    /^\.github\/workflows\//,           // CI workflow changes
    /^\.github\/scripts\//,              // CI script changes
    /^package\.json$/,                   // Root package.json
    /^package-lock\.json$/,              // Root package-lock.json
    /vitest\.config\.ts$/,               // Vitest config changes
    /tsconfig\.json$/,                   // TypeScript config changes
    /electron\.vite\.config\.ts$/,       // Electron build config
    /electron-builder\.json$/            // Electron builder config
  ];

  // Check if any file matches full run triggers
  for (const file of changedFiles) {
    if (fullRunTriggers.some(pattern => pattern.test(file))) {
      console.log(`Full run triggered by: ${file}`);
      result.run_all_tests = 'true';
      result.test_gui = 'true';
      result.test_minions = 'true';
      result.test_e2e = 'true';
      return result;
    }
  }

  // Check workflow dispatch input for full run
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    try {
      const eventPath = process.env.GITHUB_EVENT_PATH;
      if (eventPath && fs.existsSync(eventPath)) {
        const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
        if (eventData.inputs && eventData.inputs.full_run === 'true') {
          console.log('Full run requested via workflow dispatch');
          result.run_all_tests = 'true';
          result.test_gui = 'true';
          result.test_minions = 'true';
          result.test_e2e = 'true';
          return result;
        }
      }
    } catch (error) {
      console.error('Error reading workflow dispatch inputs:', error.message);
    }
  }

  // Check branch for full run requirement
  const branch = process.env.GITHUB_REF_NAME || '';
  const baseBranch = process.env.GITHUB_BASE_REF || '';

  console.log(`Current branch: ${branch}`);
  console.log(`Base branch: ${baseBranch}`);

  if (branch === 'main' || branch === 'master' || baseBranch === 'main' || baseBranch === 'master') {
    console.log('Full run required for main/master branch');
    result.run_all_tests = 'true';
    result.test_gui = 'true';
    result.test_minions = 'true';
    result.test_e2e = 'true';
    return result;
  }

  // Package-level detection
  let hasGuiChanges = false;
  let hasMinionsChanges = false;

  for (const file of changedFiles) {
    if (file.startsWith('gui/')) {
      hasGuiChanges = true;
    }
    if (file.startsWith('minions/')) {
      hasMinionsChanges = true;
    }
  }

  // Set flags based on which packages changed
  result.test_gui = hasGuiChanges ? 'true' : 'false';
  result.test_minions = hasMinionsChanges ? 'true' : 'false';

  // Use Vitest's --changed flag for intelligent selection within packages
  if (hasGuiChanges) {
    result.gui_test_pattern = '--changed';
    console.log('GUI package changed - using intelligent test selection');
  }
  if (hasMinionsChanges) {
    result.minions_test_pattern = '--changed';
    console.log('Minions package changed - using intelligent test selection');
  }

  // Safety check: if files changed but no packages detected, run all tests
  if (changedFiles.length > 0 && !hasGuiChanges && !hasMinionsChanges) {
    console.log('Changes detected outside known packages - running all tests for safety');
    result.run_all_tests = 'true';
    result.test_gui = 'true';
    result.test_minions = 'true';
    result.test_e2e = 'true';
  }

  // E2E test detection - only if GUI changes detected
  if (hasGuiChanges) {
    const e2eResult = getE2ETestsForChanges(changedFiles);

    if (e2eResult.shouldRunE2E) {
      result.test_e2e = 'true';

      if (e2eResult.runAllE2E) {
        console.log('E2E infrastructure changed - running all E2E tests');
        result.e2e_test_pattern = '';
      } else if (e2eResult.e2eTestFiles.length > 0) {
        // Convert to grep pattern for Playwright
        const pattern = e2eResult.e2eTestFiles.map(f => f.replace('.e2e.ts', '')).join('|');
        result.e2e_test_pattern = `--grep "${pattern}"`;
        console.log(`E2E tests selected: ${e2eResult.e2eTestFiles.join(', ')}`);
      }
    } else {
      console.log('GUI changes detected but no E2E-relevant files - skipping E2E');
    }
  }

  return result;
}

/**
 * Set GitHub Actions outputs
 */
function setOutputs(result) {
  console.log('\n=== Test Selection Result ===');

  for (const [key, value] of Object.entries(result)) {
    console.log(`${key}=${value}`);

    // GitHub Actions output syntax
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  }

  console.log('=============================\n');
}

/**
 * Main execution
 */
function main() {
  console.log('=== Analyzing changes for test selection ===\n');

  const changedFiles = getChangedFiles();
  console.log(`\nFound ${changedFiles.length} changed file(s)\n`);

  const result = analyzeChanges(changedFiles);

  setOutputs(result);

  // Summary
  console.log('Summary:');
  if (result.run_all_tests === 'true') {
    console.log('  → Running ALL tests (full test suite including E2E)');
  } else {
    if (result.test_gui === 'true') {
      console.log(`  → Running GUI tests with pattern: ${result.gui_test_pattern || 'all'}`);
    }
    if (result.test_minions === 'true') {
      console.log(`  → Running Minions tests with pattern: ${result.minions_test_pattern || 'all'}`);
    }
    if (result.test_e2e === 'true') {
      console.log(`  → Running E2E tests with pattern: ${result.e2e_test_pattern || 'all'}`);
    }
    if (result.test_gui === 'false' && result.test_minions === 'false' && result.test_e2e === 'false') {
      console.log('  → No tests selected (no relevant changes detected)');
    }
  }
}

// Run main function
main();
