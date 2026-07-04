#!/usr/bin/env node
/**
 * PostToolUse Hook: Auto-format JS/TS files after edits
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs after Edit tool use. If the edited file is a JS/TS file,
 * auto-detects the project formatter (Biome or Prettier) by looking
 * for config files, then formats accordingly.
 * Fails silently if no formatter is found or installed.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MAX_STDIN = 1024 * 1024; // 1MB limit
let data = '';
process.stdin.setEncoding('utf8');

console.log('[Hook:Format] Waiting for input...');

process.stdin.on('data', (chunk) => {
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

function detectFormatter(projectRoot) {
  const prettierConfigs = [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    '.prettierrc.toml',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
  ];
  for (const cfg of prettierConfigs) {
    if (fs.existsSync(path.join(projectRoot, cfg))) return 'prettier';
  }

  return null;
}

function getFormatterCommand(formatter, filePath) {
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  if (formatter === 'biome') {
    return { bin: npxBin, args: ['@biomejs/biome', 'format', '--write', filePath] };
  }
  if (formatter === 'prettier') {
    return { bin: npxBin, args: ['prettier', '--write', filePath] };
  }
  return null;
}

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_input?.file_path;

    if (filePath && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
      console.error('[Hook:Format] Executing on:', path.basename(filePath));
      try {
        const resolvedPath = path.resolve(filePath);
        const projectRoot = findProjectRoot(path.dirname(resolvedPath));
        const formatter = detectFormatter(projectRoot);

        if (!formatter) {
          console.error('[Hook:Format] No formatter detected (Biome/Prettier)');
        } else {
          console.error('[Hook:Format] Using formatter:', formatter);
          const relativePath = path.relative(projectRoot, path.resolve(filePath));
          const cmd = getFormatterCommand(formatter, relativePath);

          if (cmd) {
            execFileSync(cmd.bin, cmd.args, {
              cwd: projectRoot,
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 15000,
            });
            console.error('[Hook:Format] ✓ Formatted successfully');
          }
        }
      } catch (err) {
        console.error('[Hook:Format] ✗ Failed:', err.message);
      }
    }
  } catch {
    // Invalid input — pass through
  }

  process.stdout.write(data);
  process.exit(0);
});
