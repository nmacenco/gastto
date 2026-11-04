import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const testcontainersRequire = createRequire(
  realpathSync(join(project, 'node_modules/testcontainers/package.json')),
);
const archiverPath = testcontainersRequire.resolve('archiver');
const archiverRequire = createRequire(archiverPath);

test('Testcontainers archive dependencies preserve glob exclusions and nested file contents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gastto-archive-'));
  try {
    mkdirSync(join(dir, 'nested'));
    mkdirSync(join(dir, 'skip'));
    for (const file of ['root.txt', 'nested/child.txt', 'skip/private.txt', '.hidden.txt']) {
      writeFileSync(join(dir, file), `fixture:${file}`);
    }
    const expected = ['nested/child.txt', 'root.txt'];
    const { file } = archiverRequire('archiver-utils');
    assert.deepEqual(file.expand({ cwd: dir }, ['**/*.txt', '!skip/**']).sort(), expected);

    const archive = testcontainersRequire('archiver')('tar');
    const extract = archiverRequire('tar-stream').extract();
    const contents = {};
    extract.on('entry', (header, stream, next) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        if (header.type === 'file') contents[header.name] = Buffer.concat(chunks).toString();
        next();
      });
      stream.on('error', (error) => extract.destroy(error));
    });
    const extraction = pipeline(archive, extract);
    archive.glob('**/*.txt', { cwd: dir, ignore: ['skip/**'], dot: false });
    await archive.finalize();
    await extraction;
    assert.deepEqual(Object.keys(contents).sort(), expected);
    for (const file of expected) assert.equal(contents[file], `fixture:${file}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Drizzle legacy loader still transforms executable TypeScript with patched esbuild', async () => {
  const kitRequire = createRequire(
    realpathSync(join(project, 'node_modules/drizzle-kit/package.json')),
  );
  const loaderRequire = createRequire(kitRequire.resolve('@esbuild-kit/esm-loader'));
  const { transform, transformSync } = loaderRequire('@esbuild-kit/core-utils');
  const code = 'export const amount: number = 42;';
  const sync = transformSync(code, '/synthetic/security-smoke.ts');
  const context = { module: { exports: {} }, exports: {} };
  runInNewContext(sync.code, context);
  assert.equal(context.module.exports.amount, 42);
  const asyncResult = await transform(code, '/synthetic/security-smoke-async.ts');
  const imported = await import(
    `data:text/javascript;base64,${Buffer.from(asyncResult.code).toString('base64')}`
  );
  assert.equal(imported.amount, 42);
});
