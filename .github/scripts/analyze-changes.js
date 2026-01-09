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
 * Analyze changed files and determine test selection strategy
 */
function analyzeChanges(changedFiles) {
  const result = {
    run_all_tests: 'false',
    test_gui: 'false',
    test_minions: 'false',
    gui_test_pattern: '',
    minions_test_pattern: ''
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
    console.log('  → Running ALL tests (full test suite)');
  } else {
    if (result.test_gui === 'true') {
      console.log(`  → Running GUI tests with pattern: ${result.gui_test_pattern || 'all'}`);
    }
    if (result.test_minions === 'true') {
      console.log(`  → Running Minions tests with pattern: ${result.minions_test_pattern || 'all'}`);
    }
    if (result.test_gui === 'false' && result.test_minions === 'false') {
      console.log('  → No tests selected (no relevant changes detected)');
    }
  }
}

// Run main function
main();
