import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../../evals/semantic-router/manifest.json';
import { EvaluationDatasetSchema } from '../../application/use-cases/evaluation/contracts';

describe('semantic corpus provenance', () => {
  it('pins frozen labels and independent response artifacts; corrections require a reviewed manifest/version update', async () => {
    const root = resolve(__dirname, '../../../evals/semantic-router');
    const corpus = await readFile(resolve(root, 'corpus.json'));
    const responses = await readFile(resolve(root, 'corpus-responses.json'));
    expect(createHash('sha256').update(corpus).digest('hex')).toBe(manifest.corpusSha256);
    expect(createHash('sha256').update(responses).digest('hex')).toBe(manifest.responsesSha256);
    const data = EvaluationDatasetSchema.parse(JSON.parse(corpus.toString()) as unknown);
    expect(data.version).toBe(manifest.corpusVersion);
    expect(data.provenance?.labelVersion).toBe(manifest.labelVersion);
    expect(manifest.liveEvaluations).toEqual([]);
  });
});
