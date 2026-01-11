#!/usr/bin/env node

/**
 * Suggests which tests to run based on changed files
 * Usage: node .github/scripts/suggest-tests.js
 *
 * Outputs test commands based on git diff
 */

const { execSync } = require('child_process');

function getChangedFiles() {
  try {
    const diffOutput = execSync('git diff --name-only HEAD', {
      encoding: 'utf-8'
    });
    return diffOutput.split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting changed files:', error.message);
    return [];
  }
}

function suggestTests(changedFiles) {
  if (changedFiles.length === 0) {
    console.log('No changed files detected. You may want to run:');
    console.log('  npm test');
    return;
  }

  const guiChanges = changedFiles.some(f => f.startsWith('gui/'));
  const minionsChanges = changedFiles.some(f => f.startsWith('minions/'));
  const configChanges = changedFiles.some(f =>
    /vitest\.config\.ts$/.test(f) ||
    /package\.json$/.test(f) ||
    /tsconfig\.json$/.test(f)
  );

  console.log('Changed files:', changedFiles.length);
  console.log('');

  if (configChanges) {
    console.log('⚠️  Configuration files changed - recommend full test suite:');
    console.log('  npm test');
    return;
  }

  console.log('💡 Recommended test commands (selective):');
  console.log('');

  if (guiChanges && minionsChanges) {
    console.log('  npm run test:changed');
    console.log('');
    console.log('Or run separately:');
    console.log('  cd gui && npm run test:changed');
    console.log('  cd minions && npm run test:changed');
  } else if (guiChanges) {
    console.log('  cd gui && npm run test:changed');
    console.log('');
    console.log('Or specific files:');
    const guiFiles = changedFiles
      .filter(f => f.startsWith('gui/src/'))
      .slice(0, 3);
    guiFiles.forEach(f => {
      console.log(`  cd gui && npm run test:related ${f.replace('gui/', '')}`);
    });
  } else if (minionsChanges) {
    console.log('  cd minions && npm run test:changed');
  } else {
    console.log('  npm run test:changed  # (safe default)');
  }

  console.log('');
  console.log('To run all tests:');
  console.log('  npm test');
}

const changedFiles = getChangedFiles();
suggestTests(changedFiles);
