#!/usr/bin/env node
/**
 * PostToolUse Hook: ESLint check and auto-fix after editing JS/TS files
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs after Edit or Write tool use on JS/TS files. Walks up from the file's
 * directory to find the nearest package.json with eslint, then runs eslint --fix
 * to auto-fix issues and reports any remaining errors.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MAX_STDIN = 1024 * 1024; // 1MB limit
let data = '';
process.stdin.setEncoding('utf8');

console.log('[Hook:Lint] Waiting for input...');

process.stdin.on('data', chunk => {
  if (data.length < MAX_STDIN) {
    const remaining = MAX_STDIN - data.length;
    data += chunk.substring(0, remaining);
  }
});

function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path;

    if (filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      console.error('[Hook:Lint] Executing on:', path.basename(filePath));
      const resolvedPath = path.resolve(filePath);

      if (!fs.existsSync(resolvedPath)) {
        console.error('[Hook:Lint] ✗ File not found');
        process.stdout.write(data);
        process.exit(0);
      }

      const projectRoot = findProjectRoot(path.dirname(resolvedPath));
      console.error('[Hook:Lint] Running eslint --fix...');

      try {
        const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

        // Run eslint with --fix to auto-fix issues
        execFileSync(npxBin, ['eslint', '--fix', resolvedPath], {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000,
        });

        console.error('[Hook:Lint] ✓ No ESLint errors');
      } catch (err) {
        // eslint exits non-zero when there are unfixable errors
        const output = (err.stdout || '') + (err.stderr || '');
        const lines = output.split('\n').filter(line => line.trim());

        if (lines.length > 0) {
          console.error('[Hook:Lint] ⚠ ESLint issues in ' + path.basename(filePath) + ':');
          lines.slice(0, 15).forEach(line => console.error(line));
          if (lines.length > 15) {
            console.error(`... and ${lines.length - 15} more lines`);
          }
        } else {
          console.error('[Hook:Lint] ✓ Auto-fixed successfully');
        }
      }
    }
  } catch {
    // Invalid input — pass through
  }

  process.stdout.write(data);
  process.exit(0);
});
