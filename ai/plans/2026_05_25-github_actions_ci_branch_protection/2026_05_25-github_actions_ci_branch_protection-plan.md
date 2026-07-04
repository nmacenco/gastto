# Goal

Add a GitHub Actions CI workflow that validates lint, typecheck, build, and tests on every pull request and push to `main`/`develop`. Document the branch protection setup so merges are blocked until the CI passes, preventing broken code from reaching deployable branches.

# Context

- Current CI state: No CI workflow exists. Only `.github/workflows/fly-deploy.yml` runs post-merge and deploys unconditionally.
- Recent incident: A Fastify plugin version mismatch (`@fastify/swagger` 9.x requiring Fastify 5 while `fastify@4.29.1` was installed) was merged into `develop` and crashed the Fly.io deployment because there was no pre-merge validation.
- Available quality gates in `package.json`:
  - `pnpm lint`: ESLint on `src/**/*.ts`.
  - `pnpm typecheck`: `tsc --noEmit`.
  - `pnpm build`: `tsup` compilation to `dist/main.js`.
  - `pnpm test`: Vitest run (103 tests, all unit with mocks, no external services needed).
- `vitest.config.ts`: Node environment, no globals, coverage via v8.
- `tsconfig.json`: NodeNext module resolution, strict mode enabled.
- `pnpm-workspace.yaml`: Present; pnpm caching in GitHub Actions requires both `pnpm/action-setup` and `actions/setup-node` with `cache: 'pnpm'`.
- `docs/features/deployment.md`: Operational deployment guide. Will be extended to cover the CI pipeline and branch protection configuration.

# Phases

## Phase 1: GitHub Actions CI workflow

Create `.github/workflows/ci.yml` with a single `quality` job that runs on `pull_request` (to any branch) and `push` to `main`/`develop`. Use `pnpm/action-setup@v4` and `actions/setup-node@v4` with `cache: 'pnpm'` for fast installs. Run lint, typecheck, build, and test in sequence so failures surface early.

- [x] Create `.github/workflows/ci.yml` with the following configuration:
  - Trigger `on: pull_request` (all branches) and `on: push` to `main` and `develop`.
  - Job `quality` running on `ubuntu-latest`.
  - Steps: `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` with `cache: 'pnpm'` and `node-version: '20'`.
  - Run `pnpm install --frozen-lockfile`.
  - Run `pnpm lint`.
  - Run `pnpm typecheck`.
  - Run `pnpm build`.
  - Run `pnpm test`.
- [x] Run `pnpm lint` and `pnpm typecheck` locally to verify the repo is green before pushing the workflow.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Documentation and branch protection guide

Extend `docs/features/deployment.md` with a CI/CD section explaining what the workflow validates and where to see the results. Add a "Branch Protection Setup" subsection with step-by-step instructions to configure required status checks in GitHub Settings for `main` and `develop`.

- [x] Add "Continuous Integration" section to `docs/features/deployment.md` describing:
  - Which workflow runs (`ci.yml`) and on which events.
  - The four gates: lint, typecheck, build, test.
  - How to view check results in the PR interface.
- [x] Add "Branch Protection Setup" section with the following steps:
  1. Go to GitHub repository Settings > Branches.
  2. Add a rule for `main` and `develop` (or use a pattern like `main,develop`).
  3. Enable "Require a pull request before merging".
  4. Enable "Require status checks to pass before merging".
  5. Search for and select the `quality` check from `ci.yml` as required.
  6. (Optional) Enable "Require approvals" and set to 1 reviewer.
- [x] Run `pnpm lint` and `pnpm typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

All phases are complete. Commit the changes and push to a branch to see the CI run on a pull request.
