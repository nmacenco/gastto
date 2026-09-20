import { createHash } from 'node:crypto';
import { open, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import type { Logger } from 'pino';
import { z } from 'zod';
import { EvaluateSemanticRouterRelease } from '../../application/use-cases/evaluation/EvaluateSemanticRouterRelease';
import {
  EvidenceKindSchema,
  ImplementationEvidenceSchema,
  ProposalEvaluationEvidenceSchema,
  ReleaseEvidenceManifestSchema,
  ReleaseThresholdInputSchema,
  RuntimeEvidenceSchema,
  SemanticRouterRolloutRecordSchema,
  type ReleaseEvidenceManifest,
} from '../../application/use-cases/evaluation/release-contracts';
import { createLogger } from '../../infrastructure/logger';

const artifactOptions = {
  implementation: 'implementation',
  'offline-development': 'offline_development',
  'offline-held-out': 'offline_held_out',
  'live-held-out': 'live_held_out',
  'shadow-runtime': 'shadow_runtime',
  'controlled-rollout-runtime': 'controlled_rollout_runtime',
  'rollback-record': 'rollback_record',
} as const;

type ArtifactOption = keyof typeof artifactOptions;
type EvidenceKind = (typeof artifactOptions)[ArtifactOption];

export function parseReleaseEvaluationArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      thresholds: { type: 'string' },
      manifest: { type: 'string' },
      output: { type: 'string' },
      implementation: { type: 'string' },
      'offline-development': { type: 'string' },
      'offline-held-out': { type: 'string' },
      'live-held-out': { type: 'string' },
      'shadow-runtime': { type: 'string' },
      'controlled-rollout-runtime': { type: 'string' },
      'rollback-record': { type: 'string' },
    },
  });
  return z
    .object({
      thresholds: z.string().min(1),
      manifest: z.string().min(1),
      output: z.string().min(1),
      implementation: z.string().min(1).optional(),
      'offline-development': z.string().min(1).optional(),
      'offline-held-out': z.string().min(1).optional(),
      'live-held-out': z.string().min(1).optional(),
      'shadow-runtime': z.string().min(1).optional(),
      'controlled-rollout-runtime': z.string().min(1).optional(),
      'rollback-record': z.string().min(1).optional(),
    })
    .strict()
    .parse(values);
}

async function readArtifact(path: string): Promise<{ value: unknown; sha256: string }> {
  const resolved = await realpath(path);
  const forbidden = (candidate: string) =>
    /^(?:\.env(?:\.|$)|credentials(?:\.|$)|secrets?(?:\.|$))/i.test(basename(candidate));
  if (
    extname(path) !== '.json' ||
    extname(resolved) !== '.json' ||
    forbidden(path) ||
    forbidden(resolved)
  )
    throw new Error('INVALID_ARTIFACT_PATH');
  const info = await stat(resolved);
  if (!info.isFile() || info.size > 20_000_000) throw new Error('INVALID_ARTIFACT_SIZE');
  const bytes = await readFile(resolved);
  return {
    value: JSON.parse(bytes.toString('utf8')) as unknown,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function manifestEntry(manifest: ReleaseEvidenceManifest, kind: EvidenceKind) {
  return manifest.artifacts.find((artifact) => artifact.kind === kind);
}

function parseEvidence(kind: EvidenceKind, value: unknown) {
  switch (kind) {
    case 'implementation':
      return ImplementationEvidenceSchema.parse(value);
    case 'offline_development':
    case 'offline_held_out':
    case 'live_held_out':
      return ProposalEvaluationEvidenceSchema.parse(value);
    case 'shadow_runtime':
    case 'controlled_rollout_runtime':
      return RuntimeEvidenceSchema.parse(value);
    case 'rollback_record':
      return SemanticRouterRolloutRecordSchema.parse(value);
  }
}

export async function runReleaseEvaluationCli(
  args: string[],
  logger: Pick<Logger, 'error'>,
): Promise<number> {
  let outputFile: Awaited<ReturnType<typeof open>> | undefined;
  let outputPath: string | undefined;
  let written = false;
  try {
    const options = parseReleaseEvaluationArgs(args);
    if (extname(options.output) !== '.json') throw new Error('INVALID_REPORT_PATH');
    outputFile = await open(options.output, 'wx', 0o600);
    outputPath = options.output;
    const [thresholdFile, manifestFile] = await Promise.all([
      readArtifact(options.thresholds),
      readArtifact(options.manifest),
    ]);
    const thresholds = ReleaseThresholdInputSchema.parse(thresholdFile.value);
    const manifest = ReleaseEvidenceManifestSchema.parse(manifestFile.value);
    const evidence: Parameters<EvaluateSemanticRouterRelease['execute']>[0]['evidence'] = {};
    const evidenceDigests: Record<string, string> = {};
    const suppliedKinds = new Set<EvidenceKind>();
    for (const [option, kind] of Object.entries(artifactOptions) as [
      ArtifactOption,
      EvidenceKind,
    ][]) {
      const path = options[option];
      if (!path) continue;
      EvidenceKindSchema.parse(kind);
      suppliedKinds.add(kind);
      const entry = manifestEntry(manifest, kind);
      if (!entry || basename(path) !== basename(entry.file))
        throw new Error('MANIFEST_FILE_MISMATCH');
      const artifact = await readArtifact(path);
      if (artifact.sha256 !== entry.sha256) throw new Error('ARTIFACT_DIGEST_MISMATCH');
      const parsed = parseEvidence(kind, artifact.value);
      evidenceDigests[kind] = artifact.sha256;
      if (kind === 'implementation') evidence.implementation = parsed as never;
      else if (kind === 'offline_development') evidence.offlineDevelopment = parsed as never;
      else if (kind === 'offline_held_out') evidence.offlineHeldOut = parsed as never;
      else if (kind === 'live_held_out') evidence.liveHeldOut = parsed as never;
      else if (kind === 'shadow_runtime') evidence.shadowRuntime = parsed as never;
      else if (kind === 'controlled_rollout_runtime')
        evidence.controlledRolloutRuntime = parsed as never;
      else evidence.rollbackRecord = parsed as never;
    }
    if (manifest.artifacts.some((artifact) => !suppliedKinds.has(artifact.kind)))
      throw new Error('MANIFEST_ARTIFACT_NOT_SUPPLIED');
    const report = new EvaluateSemanticRouterRelease().execute({
      manifest,
      thresholds,
      evidence,
      evidenceDigests,
    });
    await outputFile.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    written = true;
    if (report.decision === 'approved_for_next_stage') return 0;
    return report.gates.some((item) => item.status === 'failed') || report.decision === 'rollback'
      ? 1
      : 2;
  } catch {
    logger.error({
      msg: 'Semantic release evaluation could not complete',
      endpoint: 'evaluateSemanticRouterRelease',
      code: 'RELEASE_EVALUATION_FAILED',
    });
    return 2;
  } finally {
    await outputFile?.close().catch(() => {});
    if (outputPath && !written) await unlink(outputPath).catch(() => {});
  }
}

if (require.main === module) {
  void runReleaseEvaluationCli(process.argv.slice(2), createLogger()).then((code) => {
    process.exitCode = code;
  });
}
