// LAYER: Tests / Integration Helpers
// Manages a PostgreSQL test container using testcontainers.
// Starts once per test suite and exposes a connection string for Drizzle.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';

let container: StartedPostgreSqlContainer | null = null;

export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function startDbContainer(): Promise<StartedPostgreSqlContainer> {
  if (container) return container;

  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('gastto_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  return container;
}

export function getConnectionString(): string {
  if (!container) {
    throw new Error('DB container not started. Call startDbContainer() first.');
  }
  return container.getConnectionUri();
}

export async function stopDbContainer(): Promise<void> {
  if (container) {
    await container.stop();
    container = null;
  }
}
