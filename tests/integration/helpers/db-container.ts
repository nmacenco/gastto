// LAYER: Tests / Integration Helpers
// Manages a PostgreSQL test container using testcontainers.
// Each test suite starts its own container to avoid cross-suite interference.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';

export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function startDbContainer(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('gastto_test')
    .withUsername('test')
    .withPassword('test')
    .start();
}

export function getConnectionString(container: StartedPostgreSqlContainer): string {
  return container.getConnectionUri();
}

export async function stopDbContainer(container: StartedPostgreSqlContainer): Promise<void> {
  await container.stop();
}
