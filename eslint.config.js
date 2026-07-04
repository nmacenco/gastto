// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── Base: recommended rules + type-aware rules ──────────────────────────
  ...tseslint.configs.recommendedTypeChecked,

  // ── Parser config (required for type-aware rules) ───────────────────────
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Project-specific rule overrides ─────────────────────────────────────
  {
    files: ['src/**/*.ts'],
    rules: {
      // --- TypeScript ---
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off', // inferred is fine
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error', // critical for async/await correctness
      '@typescript-eslint/no-misused-promises': 'error',

      // --- General JS ---
      'no-console': ['warn', { allow: ['warn', 'error'] }], // use Pino instead
      eqeqeq: ['error', 'always'],
    },
  },

  // ── Ignore patterns ──────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.config.js',
      '*.config.mjs',
      'ai/**',
      'drizzle.config.ts',
    ],
  },
);
