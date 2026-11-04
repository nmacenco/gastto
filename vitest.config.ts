import { defineConfig, configDefaults } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    hookTimeout: 120_000,
    maxWorkers: 4,
    globals: false,
    exclude: [...configDefaults.exclude, 'scripts/security/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.spec.ts', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, './src/domain'),
      '@application': path.resolve(__dirname, './src/application'),
      '@infrastructure': path.resolve(__dirname, './src/infrastructure'),
      '@interfaces': path.resolve(__dirname, './src/interfaces'),
      '@config': path.resolve(__dirname, './src/config'),
    },
  },
});
