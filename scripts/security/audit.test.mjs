import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { evaluate } from './audit.mjs';
const report = {
  metadata: { vulnerabilities: { high: 1 } },
  advisories: {
    one: {
      github_advisory_id: 'GHSA-test',
      module_name: 'example',
      severity: 'high',
      findings: [{ version: '1.0.0', paths: ['.>example'] }],
    },
  },
};
const exception = {
  id: 'GHSA-test',
  package: 'example',
  version: '1.0.0',
  path: '.>example',
  reason: 'unreachable',
  owner: 'security',
  approval: 'review-1',
  expires: '2030-01-01',
  issue: 'follow-up',
  control: 'disabled',
};
test('blocks findings and permits a precise unexpired exception', () => {
  assert.equal(evaluate(report).rejected.length, 1);
  assert.equal(evaluate(report, [exception], new Date('2026-11-01')).rejected.length, 0);
  assert.equal(evaluate(report, [{ ...exception, path: '.>other' }]).rejected.length, 1);
});
test('fails closed on malformed reports, expired exceptions and inconsistent counts', () => {
  for (const input of [null, {}, { error: 'registry' }, { ...report, advisories: {} }])
    assert.throws(() => evaluate(input));
  assert.throws(() => evaluate(report, [{ ...exception, expires: '2020-01-01' }]));
  assert.throws(() => evaluate(report, [{ ...exception, owner: '' }]));
});
test('accepts an empty valid inventory', () =>
  assert.equal(
    evaluate({ metadata: { vulnerabilities: { high: 0 } }, advisories: {} }).rejected.length,
    0,
  ));

test('CLI fails closed on registry failures, invalid output and inconsistent exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gastto-audit-test-'));
  try {
    const empty = { metadata: { vulnerabilities: { high: 0 } }, advisories: {} };
    for (const allDependencies of [false, true]) {
      const auditArgs = ['audit', ...(allDependencies ? [] : ['--prod']), '--json'];
      for (const [status, output, expected] of [
        [0, JSON.stringify(empty), 0],
        [1, JSON.stringify(report), 1],
        [2, 'registry unavailable', 2],
        [0, '{invalid', 2],
        [1, JSON.stringify(empty), 2],
        [0, JSON.stringify({ metadata: { vulnerabilities: {} }, advisories: {} }), 2],
      ]) {
        writeFileSync(
          join(dir, 'pnpm'),
          `#!/usr/bin/env node\nif (JSON.stringify(process.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(auditArgs))}) throw new Error('Unexpected audit scope');\nprocess.stdout.write(${JSON.stringify(output)}); process.exit(${status});`,
          { mode: 0o700 },
        );
        const result = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('./audit.mjs', import.meta.url)),
            ...(allDependencies ? ['--all'] : []),
          ],
          {
            cwd: dir,
            env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
            encoding: 'utf8',
          },
        );
        assert.equal(result.status, expected, result.stderr);
        const artifact = JSON.parse(
          readFileSync(
            join(dir, allDependencies ? 'security-audit-all.json' : 'security-audit.json'),
            'utf8',
          ),
        );
        if (expected === 2) assert.deepEqual(artifact, { status: 'unavailable' });
        else {
          assert.equal(artifact.findings.length, expected);
          assert.equal(artifact.scope, allDependencies ? 'all' : 'production');
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
