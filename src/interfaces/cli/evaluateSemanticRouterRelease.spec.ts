import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseReleaseEvaluationArgs,
  runReleaseEvaluationCli,
} from './evaluateSemanticRouterRelease';

const candidate = {
  provider: 'openai',
  model: 'gpt-4o-mini-2024-07-18',
  promptVersion: 'semantic-openai-v3',
  contractVersion: 'semantic-contract-v2',
  policyVersion: 'semantic-policy-v3',
  datasetVersion: 'semantic-corpus-v6',
  labelVersion: 'semantic-labels-v6',
} as const;

describe('semantic release evaluator CLI', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'semantic-release-eval-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const invalidArguments: [string[]][] = [
    [[]],
    [['--thresholds', 'thresholds.json']],
    [['--unknown', 'value']],
    [['positional']],
  ];
  it.each(invalidArguments)('rejects missing, unknown or positional arguments %j', (args) => {
    expect(() => parseReleaseEvaluationArgs(args)).toThrow();
  });

  it('writes a fail-closed report without bootstrap, dotenv, database, Redis or network', async () => {
    const thresholdsPath = join(directory, 'thresholds.json');
    const manifestPath = join(directory, 'manifest.json');
    const output = join(directory, 'report.json');
    await writeFile(
      thresholdsPath,
      JSON.stringify({
        schemaVersion: 'semantic-release-thresholds-pending-v1',
        status: 'pending_owner_approval',
        candidate,
        missingFields: ['numeric_gates', 'pricing'],
      }),
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 'semantic-release-evidence-manifest-v1',
        releaseId: 'candidate-1',
        sourceVersion: 'source-v1',
        requestedStage: 'shadow',
        candidate,
        artifacts: [],
      }),
    );
    const fetch = vi.fn(() => {
      throw new Error('NETWORK_FORBIDDEN');
    });
    vi.stubGlobal('fetch', fetch);
    const logger = { error: vi.fn() };
    expect(
      await runReleaseEvaluationCli(
        ['--thresholds', thresholdsPath, '--manifest', manifestPath, '--output', output],
        logger,
      ),
    ).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    const report = JSON.parse(await readFile(output, 'utf8')) as {
      decision: string;
      thresholdVersion: string;
    };
    expect(report).toMatchObject({ decision: 'hold', thresholdVersion: 'pending' });
    const original = await readFile(output, 'utf8');
    expect(
      await runReleaseEvaluationCli(
        ['--thresholds', thresholdsPath, '--manifest', manifestPath, '--output', output],
        logger,
      ),
    ).toBe(2);
    expect(await readFile(output, 'utf8')).toBe(original);
  });

  it('verifies artifact filenames and raw SHA-256 digests before evaluation', async () => {
    const thresholdsPath = join(directory, 'thresholds.json');
    const manifestPath = join(directory, 'manifest.json');
    const implementationPath = join(directory, 'implementation.json');
    const output = join(directory, 'report.json');
    const bytes = JSON.stringify({ invalid: 'artifact' });
    await writeFile(implementationPath, bytes);
    await writeFile(
      thresholdsPath,
      JSON.stringify({
        schemaVersion: 'semantic-release-thresholds-pending-v1',
        status: 'pending_owner_approval',
        candidate,
        missingFields: ['pricing'],
      }),
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 'semantic-release-evidence-manifest-v1',
        releaseId: 'candidate-1',
        sourceVersion: 'source-v1',
        requestedStage: 'shadow',
        candidate,
        artifacts: [
          {
            kind: 'implementation',
            file: 'implementation.json',
            sha256: createHash('sha256').update(`${bytes}changed`).digest('hex'),
          },
        ],
      }),
    );
    expect(
      await runReleaseEvaluationCli(
        [
          '--thresholds',
          thresholdsPath,
          '--manifest',
          manifestPath,
          '--implementation',
          implementationPath,
          '--output',
          output,
        ],
        { error: vi.fn() },
      ),
    ).toBe(2);
    await expect(readFile(output)).rejects.toThrow();
  });
});
