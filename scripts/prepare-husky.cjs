#!/usr/bin/env node
const { existsSync } = require('fs');
const { execSync } = require('child_process');

try {
  if (existsSync('.git')) {
    // Run husky setup only when inside a git repo
    execSync('npx --yes husky', { stdio: 'inherit' });
  } else {
    console.log('Skipping Husky prepare step: .git not found');
  }
} catch (err) {
  // Do not fail installs because of husky issues
  console.warn('Husky prepare step failed (non-fatal):', err?.message || err);
}
