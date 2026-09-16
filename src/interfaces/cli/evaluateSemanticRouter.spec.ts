import type { ClientOptions } from 'openai';
import type { EvaluationReport } from '../../application/use-cases/evaluation/EvaluateSemanticRouter';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSemanticDataset,
  buildRouterCompletion,
  buildOfflineResponses,
} from '../../__tests__/factories/semantic-router';
import { parseEvaluationArgs, runEvaluationCli } from './evaluateSemanticRouter';

describe('semantic evaluator CLI', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'semantic-eval-test-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });
  it.each([
    ['--mode', 'live'],
    ['--unknown'],
    ['extra'],
    ['--max-cases', '0'],
    ['--max-cases', '1.5'],
    ['--model', 'anything'],
    ['--dataset', 'custom.json'],
  ])('rejects incompatible arguments %j', (...args) => {
    expect(() => parseEvaluationArgs(args)).toThrow();
  });
  it('runs offline by default with network disabled', async () => {
    const fetch = vi.fn(() => {
      throw new Error('NETWORK_FORBIDDEN');
    });
    vi.stubGlobal('fetch', fetch);
    const emit = vi.fn(),
      logger = { error: vi.fn() };
    expect(await runEvaluationCli([], logger, emit)).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(emit.mock.calls[0]?.[0]).toContain('protocol_fixture_replay');
  });
  it('writes a report once and refuses overwrite', async () => {
    const output = join(directory, 'report.json'),
      logger = { error: vi.fn() },
      emit = vi.fn();
    expect(await runEvaluationCli(['--output', output], logger, emit)).toBe(0);
    const first = await readFile(output, 'utf8');
    expect(await runEvaluationCli(['--output', output], logger, emit)).toBe(2);
    expect(await readFile(output, 'utf8')).toBe(first);
    expect(emit).not.toHaveBeenCalled();
  });
  it('returns 1 for mismatches, 2 for incomplete runs and safe errors', async () => {
    const dataset = buildSemanticDataset();
    dataset.cases[0]!.acceptedDecisions = [{ action: 'out_of_scope' }];
    const file = join(directory, 'data.json'),
      responses = join(directory, 'responses.json');
    await writeFile(file, JSON.stringify(dataset));
    await writeFile(responses, JSON.stringify(buildOfflineResponses()));
    const args = ['--dataset', file, '--responses', responses];
    const logger = { error: vi.fn() };
    expect(await runEvaluationCli(args, logger, () => {})).toBe(1);
    await writeFile(responses, '{}');
    expect(await runEvaluationCli(args, logger, () => {})).toBe(2);
    await writeFile(file, 'not JSON secret financial text');
    expect(await runEvaluationCli(args, logger, () => {})).toBe(2);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('financial');
  });
  it('rejects empty split selections', async () => {
    expect(await runEvaluationCli(['--split', 'held_out'], { error: vi.fn() }, () => {})).toBe(2);
  });
});

const liveArgs = [
  '--mode',
  'live',
  '--provider',
  'openai',
  '--model',
  'gpt-4o-mini-2024-07-18',
  '--max-cases',
  '1',
  '--timeout-ms',
  '10000',
  '--max-output-tokens',
  '256',
];
describe('live evaluation composition with fake HTTP', () => {
  it('uses the real SDK with a fake transport and no labels in the request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(buildRouterCompletion()), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const emit = vi.fn<(text: string) => void>();
    expect(
      await runEvaluationCli(liveArgs, { error: vi.fn() }, emit, {
        environment: { OPENAI_API_KEY: 'test-only' },
        // SDK v4 types use node-fetch; its consumed Response interface matches native fetch.
        fetch: fetch as unknown as NonNullable<ClientOptions['fetch']>,
      }),
    ).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(fetch.mock.calls[0]![1]?.body).not.toContain('acceptedDecisions');
    const report = JSON.parse(emit.mock.calls[0]![0]) as EvaluationReport;
    expect(report.evidence).toBe('live_provider');
    expect(report.checks.languageFixtureAgreement).toBeNull();
    expect(report.measurements.tokenUsage).toMatchObject({ inputTokens: 100, outputTokens: 10 });
    expect(JSON.stringify(report)).not.toContain('test-only');
  });
  it('does not retry HTTP failures and returns incomplete exit code', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('{"error":{"message":"private data"}}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const emit = vi.fn<(text: string) => void>();
    expect(
      await runEvaluationCli(liveArgs, { error: vi.fn() }, emit, {
        environment: { OPENAI_API_KEY: 'test-only' },
        // SDK v4 types use node-fetch; its consumed Response interface matches native fetch.
        fetch: fetch as unknown as NonNullable<ClientOptions['fetch']>,
      }),
    ).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0]).not.toContain('private');
    expect((JSON.parse(emit.mock.calls[0]![0]) as EvaluationReport).complete).toBe(false);
  });
  it('rejects missing credentials before a call', async () => {
    const fetch = vi.fn();
    expect(
      await runEvaluationCli(liveArgs, { error: vi.fn() }, () => {}, { environment: {}, fetch }),
    ).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['--provider', '--model', '--max-cases', '--timeout-ms', '--max-output-tokens'])(
    'requires explicit %s',
    (option) => {
      const args = [...liveArgs];
      args.splice(args.indexOf(option), 2);
      expect(() => parseEvaluationArgs(args)).toThrow();
    },
  );
});

describe('expanded corpus CLI evidence', () => {
  const corpusArgs = [
    '--dataset',
    'evals/semantic-router/corpus.json',
    '--responses',
    'evals/semantic-router/corpus-responses.json',
  ];
  it.each([
    ['development', 187],
    ['held_out', 33],
  ])('replays %s with versions, coverage and no financial text', async (split, count) => {
    const emit = vi.fn<(text: string) => void>();
    expect(
      await runEvaluationCli([...corpusArgs, '--split', String(split)], { error: vi.fn() }, emit, {
        environment: {},
      }),
    ).toBe(0);
    const report = JSON.parse(emit.mock.calls[0]![0]) as EvaluationReport;
    expect(report.counts.total).toBe(count);
    expect(report.artifactDigests?.dataset).toMatch(/^[a-f0-9]{64}$/);
    expect(report.datasetProvenance?.heldOutStatus).toBe('frozen-before-candidate-evaluation');
    expect(report.coverage.missingEligibleScopes).toEqual([]);
    expect(report.measurements.modelAccuracy).toBeNull();
    expect(report.measurements.taskCompletion).toBeNull();
    expect(report.baseline.notEvaluated).toBeGreaterThan(0);
    for (const value of ['SANTANDER', 'Mercadona', 'rawMessage', 'userReference', '16,55'])
      expect(emit.mock.calls[0]![0]).not.toContain(value);
  });
  it('filters protocol/deterministic cases before the live budget and reports the omissions', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(buildRouterCompletion()), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const emit = vi.fn<(text: string) => void>();
    expect(
      await runEvaluationCli(
        [...liveArgs, '--dataset', 'evals/semantic-router/corpus.json'],
        { error: vi.fn() },
        emit,
        {
          environment: { OPENAI_API_KEY: 'test-only' },
          fetch: fetch as unknown as NonNullable<ClientOptions['fetch']>,
        },
      ),
    ).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((JSON.parse(emit.mock.calls[0]![0]) as EvaluationReport).selection).toEqual({
      split: 'development',
      available: 187,
      excludedProtocol: 113,
      excludedDeterministic: 4,
      omittedByLimit: 69,
    });
  });
  it('refuses existing live output before invoking the SDK', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'semantic-live-existing-'));
    const output = join(directory, 'existing.json');
    try {
      await writeFile(output, 'existing report');
      const fetch = vi.fn();
      expect(
        await runEvaluationCli([...liveArgs, '--output', output], { error: vi.fn() }, () => {}, {
          environment: { OPENAI_API_KEY: 'test-only' },
          fetch,
        }),
      ).toBe(2);
      expect(fetch).not.toHaveBeenCalled();
      expect(await readFile(output, 'utf8')).toBe('existing report');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
