import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function evaluate(report, exceptions = [], now = new Date()) {
  if (
    !report ||
    report.error ||
    !report.advisories ||
    typeof report.advisories !== 'object' ||
    Array.isArray(report.advisories) ||
    !report.metadata?.vulnerabilities ||
    !Array.isArray(exceptions)
  )
    throw new Error('Invalid audit report');
  const counts = Object.values(report.metadata.vulnerabilities);
  if (!counts.length || counts.some((n) => !Number.isInteger(n) || n < 0))
    throw new Error('Invalid counts');
  const findings = Object.values(report.advisories).flatMap((a) => {
    if (!a.github_advisory_id || !a.module_name || !Array.isArray(a.findings))
      throw new Error('Invalid advisory');
    return a.findings.flatMap((f) => {
      if (!f.version || !Array.isArray(f.paths) || !f.paths.length)
        throw new Error('Invalid finding');
      return f.paths.map((path) => ({
        id: a.github_advisory_id,
        package: a.module_name,
        severity: a.severity,
        version: f.version,
        path,
        patched: a.patched_versions,
      }));
    });
  });
  if (counts.reduce((a, b) => a + b, 0) > 0 && !findings.length)
    throw new Error('Incomplete report');
  for (const e of exceptions) {
    if (
      [
        'id',
        'package',
        'version',
        'path',
        'reason',
        'owner',
        'approval',
        'expires',
        'issue',
        'control',
      ].some((k) => typeof e[k] !== 'string' || !e[k].trim()) ||
      !Number.isFinite(Date.parse(e.expires)) ||
      new Date(e.expires) <= now
    )
      throw new Error('Invalid or expired exception');
  }
  return {
    findings,
    rejected: findings.filter(
      (f) =>
        !exceptions.some((e) => ['id', 'package', 'version', 'path'].every((k) => e[k] === f[k])),
    ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allDependencies = process.argv.includes('--all');
  const artifact = allDependencies ? 'security-audit-all.json' : 'security-audit.json';
  try {
    const result = spawnSync('pnpm', ['audit', ...(allDependencies ? [] : ['--prod']), '--json'], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.signal || ![0, 1].includes(result.status))
      throw new Error('Audit unavailable');
    const report = evaluate(
      JSON.parse(result.stdout),
      JSON.parse(readFileSync(new URL('./exceptions.json', import.meta.url), 'utf8')),
    );
    if (result.status === 1 && !report.findings.length) throw new Error('Incomplete audit');
    writeFileSync(
      artifact,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          scope: allDependencies ? 'all' : 'production',
          ...report,
        },
        null,
        2,
      ),
    );
    process.stdout.write(
      `${report.findings.length} dependency paths; ${report.rejected.length} without exception\n`,
    );
    process.exitCode = report.rejected.length ? 1 : 0;
  } catch {
    writeFileSync(artifact, JSON.stringify({ status: 'unavailable' }));
    process.stderr.write('Security audit unavailable or invalid; release blocked\n');
    process.exitCode = 2;
  }
}
