import { readFile, stat, open, unlink, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import OpenAI, { type ClientOptions } from 'openai';
import {
  OpenAISemanticRouterAdapter,
  OpenAIRouterSettingsSchema,
} from '../../infrastructure/adapters/llm/OpenAISemanticRouterAdapter';
import type { Logger } from 'pino';
import { z } from 'zod';
import { EvaluationDatasetSchema } from '../../application/use-cases/evaluation/contracts';
import {
  EvaluateSemanticRouter,
  caseKind,
} from '../../application/use-cases/evaluation/EvaluateSemanticRouter';
import { observeLexicalBaseline } from '../../application/use-cases/evaluation/observeLexicalBaseline';
import {
  OfflineResponsesSchema,
  OfflineSemanticRouterAdapter,
} from '../../infrastructure/adapters/llm/OfflineSemanticRouterAdapter';
import { createLogger } from '../../infrastructure/logger';

const root = resolve(__dirname, '../../..');
const positiveInt = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().max(1000));
export function parseEvaluationArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      mode: { type: 'string', default: 'offline' },
      dataset: { type: 'string' },
      responses: { type: 'string' },
      split: { type: 'string', default: 'development' },
      'max-cases': { type: 'string' },
      output: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'max-output-tokens': { type: 'string' },
    },
  });
  const parsed = z
    .object({
      mode: z.enum(['offline', 'live']),
      dataset: z.string().min(1).optional(),
      responses: z.string().min(1).optional(),
      split: z.enum(['development', 'held_out']),
      'max-cases': positiveInt.optional(),
      output: z.string().min(1).optional(),
      provider: z.literal('openai').optional(),
      model: OpenAIRouterSettingsSchema.shape.model.optional(),
      'timeout-ms': z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number)
        .pipe(OpenAIRouterSettingsSchema.shape.timeoutMs)
        .optional(),
      'max-output-tokens': z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number)
        .pipe(OpenAIRouterSettingsSchema.shape.maxOutputTokens)
        .optional(),
    })
    .strict()
    .parse(values);
  // Custom corpora require explicit, independent protocol responses.
  if (parsed.mode === 'live') {
    if (
      !parsed.provider ||
      !parsed.model ||
      !parsed['max-cases'] ||
      !parsed['timeout-ms'] ||
      !parsed['max-output-tokens'] ||
      parsed.responses
    )
      throw new Error('EXPLICIT_LIVE_SETTINGS_REQUIRED');
  } else if (parsed.provider || parsed.model || parsed['timeout-ms'] || parsed['max-output-tokens'])
    throw new Error('INCOMPATIBLE_OPTIONS');
  if (
    parsed.mode === 'offline' &&
    (parsed.dataset === undefined) !== (parsed.responses === undefined)
  )
    throw new Error('DATASET_RESPONSES_PAIR_REQUIRED');
  return parsed;
}

async function readJson(file: string): Promise<unknown> {
  const resolved = await realpath(file);
  const forbiddenName = (path: string) =>
    /^(\.env(?:\.|$)|credentials(?:\.|$)|secrets?(?:\.|$))/i.test(basename(path));
  if (
    extname(file) !== '.json' ||
    extname(resolved) !== '.json' ||
    forbiddenName(file) ||
    forbiddenName(resolved)
  )
    throw new Error('INVALID_DATA_FILE');
  const info = await stat(resolved);
  if (!info.isFile() || info.size > 2_000_000) throw new Error('DATA_FILE_TOO_LARGE');
  return JSON.parse(await readFile(resolved, 'utf8')) as unknown;
}

export async function runEvaluationCli(
  args: string[],
  logger: Pick<Logger, 'error'>,
  emit: (text: string) => void,
  dependencies: {
    environment?: Record<string, string | undefined>;
    fetch?: ClientOptions['fetch'];
  } = {},
): Promise<number> {
  let outputFile: Awaited<ReturnType<typeof open>> | undefined;
  let outputPath: string | undefined;
  let written = false;
  try {
    const options = parseEvaluationArgs(args);
    const dataset = EvaluationDatasetSchema.parse(
      await readJson(options.dataset ?? resolve(root, 'evals/semantic-router/development.json')),
    );
    const responses =
      options.mode === 'offline'
        ? OfflineResponsesSchema.parse(
            await readJson(
              options.responses ?? resolve(root, 'evals/semantic-router/offline-responses.json'),
            ),
          )
        : null;
    const splitCases = dataset.cases.filter((c) => c.split === options.split);
    const eligible = splitCases.filter(
      (c) => options.mode === 'offline' || caseKind(c) === 'language',
    );
    const selected = eligible.slice(0, options['max-cases']);
    if (!selected.length) throw new Error('EMPTY_SELECTION');
    if (options.output !== undefined) {
      if (extname(options.output) !== '.json') throw new Error('INVALID_REPORT_PATH');
      outputFile = await open(options.output, 'wx', 0o600);
      outputPath = options.output;
    }
    const settings =
      options.mode === 'live'
        ? OpenAIRouterSettingsSchema.parse({
            model: options.model,
            timeoutMs: options['timeout-ms'],
            maxOutputTokens: options['max-output-tokens'],
          })
        : null;
    let router;
    if (settings) {
      const apiKey = (dependencies.environment ?? process.env).OPENAI_API_KEY;
      if (!apiKey?.trim()) throw new Error('MISSING_CREDENTIAL');
      const client = new OpenAI({
        apiKey,
        baseURL: 'https://api.openai.com/v1',
        maxRetries: 0,
        timeout: settings.timeoutMs,
        ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
      });
      router = new OpenAISemanticRouterAdapter(
        (body, requestOptions) => client.chat.completions.create(body, requestOptions),
        settings,
      );
    } else router = new OfflineSemanticRouterAdapter(responses!);
    const hash = createHash('sha256');
    for (const file of [
      'src/domain/value-objects/FreeTextIntent.ts',
      'src/application/utils/intents.ts',
      'src/application/use-cases/conversation/RouteIncomingMessage.ts',
      'src/application/use-cases/expense/ResolveExpenseReviewReplyUseCase.ts',
    ]) {
      hash.update(await readFile(resolve(root, file)));
    }
    const report = await new EvaluateSemanticRouter().execute({
      dataset: { ...dataset, cases: selected },
      artifactDigests: {
        dataset: createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
        responses: responses
          ? createHash('sha256').update(JSON.stringify(responses)).digest('hex')
          : null,
      },
      selection: {
        split: options.split,
        available: splitCases.length,
        excludedProtocol:
          options.mode === 'live' ? splitCases.filter((c) => caseKind(c) === 'protocol').length : 0,
        excludedDeterministic:
          options.mode === 'live'
            ? splitCases.filter((c) => caseKind(c) === 'deterministic_only').length
            : 0,
        omittedByLimit: eligible.length - selected.length,
      },
      router,
      mode: options.mode,
      executionSettings: settings
        ? { ...settings, maxCases: options['max-cases']!, concurrency: 1, maxRetries: 0 }
        : null,
      baselineObserver: observeLexicalBaseline,
      sourceVersion: hash.digest('hex'),
    });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (outputFile) {
      await outputFile.writeFile(serialized);
      written = true;
    } else emit(serialized);
    return !report.complete ? 2 : report.passed ? 0 : 1;
  } catch {
    logger.error({
      msg: 'Semantic evaluation could not complete',
      endpoint: 'evaluateSemanticRouter',
      code: 'EVALUATION_FAILED',
    });
    return 2;
  } finally {
    await outputFile?.close().catch(() => {});
    if (outputPath && !written) await unlink(outputPath).catch(() => {});
  }
}

if (require.main === module) {
  void runEvaluationCli(process.argv.slice(2), createLogger(), (text) => {
    process.stdout.write(text);
  }).then((code) => {
    process.exitCode = code;
  });
}
