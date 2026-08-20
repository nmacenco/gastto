# Goal

Align the Fly.io deployment and shutdown lifecycle with the running BullMQ workers, while preserving deployments only after changes reach protected `develop` or `main` branches through merged pull requests. Keep one persistent Machine per environment, including recovery from zero Machines, until monitoring establishes a need for additional capacity.

# Context

- [fly.develop.toml](../../../fly.develop.toml): Development Fly.io app configuration for `gastto-develop`; it currently enables automatic stopping while disabling automatic starting.
- [fly.toml](../../../fly.toml): Production Fly.io app configuration with the same lifecycle settings.
- [.github/workflows/fly-deploy.yml](../../../.github/workflows/fly-deploy.yml): Deploys `develop` to `gastto-develop` and `main` to `gastto` on `push`; the trigger mapping must remain unchanged, while the deploy command must preserve the single-Machine policy when recovering from zero Machines.
- [.github/workflows/ci.yml](../../../.github/workflows/ci.yml): Defines the `quality` job that protected branches must require before merge.
- [src/main.ts](../../../src/main.ts): Starts Fastify and BullMQ workers in one persistent process when database and Redis configuration are available; it needs an explicit signal-driven shutdown path.
- [src/bootstrap/registerWorkers.ts](../../../src/bootstrap/registerWorkers.ts): Creates BullMQ Workers and Queues but does not currently retain and close every resource through the Fastify lifecycle.
- [src/bootstrap/registerWorkers.spec.ts](../../../src/bootstrap/registerWorkers.spec.ts): Existing worker-registration tests to extend with meaningful graceful-shutdown assertions.
- [Dockerfile](../../../Dockerfile): Uses exec-form `CMD`, allowing Fly.io termination signals to reach the Node.js process directly.
- [docs/features/deployment.md](../../../docs/features/deployment.md): Canonical operational guide for the two Fly.io environments, repository secrets, branch mapping, branch protection, and deployment verification.
- [docs/features/README.md](../../../docs/features/README.md): Feature documentation index that must be synchronized when the deployment guide changes.
- [docs/adr/ADR-009-fastify-persistent.md](../../../docs/adr/ADR-009-fastify-persistent.md): Requires a persistent Node.js runtime for BullMQ workers.
- [docs/adr/ADR-010-multi-environment-flyio.md](../../../docs/adr/ADR-010-multi-environment-flyio.md): Records the original temporary auto-stop configuration and requires disabling it once BullMQ workers are present; this merged ADR remains immutable.
- [docs/adr/README.md](../../../docs/adr/README.md): ADR index to update if a new lifecycle ADR is added.
- [docs/templates/adr.md](../../../docs/templates/adr.md): Template for the new ADR that records the persistent single-Machine lifecycle and its availability-versus-cost trade-off.
- [docs/architecture/config-env.md](../../../docs/architecture/config-env.md): Defines environment configuration and the separation between Fly.io secrets and GitHub Actions deploy tokens.
- [docs/testing/guidelines.md](../../../docs/testing/guidelines.md): Defines the required meaningful test coverage and project ship checks.

## Public contracts

- Deployment trigger mapping remains unchanged: a push to `develop` deploys to `gastto-develop`, and a push to `main` deploys to `gastto`. Pull request events, including `synchronize`, are not deployment triggers.
- Merge-only deployment is an external repository contract: `develop` and `main` must require pull requests and the `quality` check, apply protections to administrators, disallow force-pushes, and have no actor capable of bypassing those requirements.
- Fly service lifecycle changes for both apps: `auto_stop_machines = "off"`, `auto_start_machines = false`, and no `min_machines_running` setting. Fly.io sends `SIGTERM` and allows a 30-second graceful-shutdown window.
- Process shutdown changes: `SIGTERM` and `SIGINT` close Fastify, and Fastify shutdown closes all registered BullMQ Workers and Queues before the process exits.
- Runtime capacity remains one `app` process-group Machine per environment. `flyctl scale count` establishes the live count, while `flyctl deploy --ha=false` prevents recovery from zero Machines from seeding redundant Machines.
- Existing application, API, database, queue payload, and deployment branch-to-environment contracts remain unchanged.

# Phases

## Phase 1: Make the runtime persistent and safe to terminate

Update the versioned Fly and process-lifecycle configuration so both environments remain active during idle periods, recover with one Machine, and drain BullMQ resources when Fly.io legitimately terminates a Machine during a deploy, host migration, or manual operation.

- [x] Update [fly.develop.toml](../../../fly.develop.toml) to set `auto_stop_machines = "off"`, retain `auto_start_machines = false`, remove `min_machines_running`, and replace the obsolete comment that describes BullMQ workers as future work.
- [x] Add top-level `kill_signal = "SIGTERM"` and `kill_timeout = "30s"` to the development configuration, documenting that 30 seconds is the initial bounded drain window to revisit if observed job duration requires it.
- [x] Apply the same lifecycle and termination configuration to [fly.toml](../../../fly.toml) so production and development remain consistent.
- [x] Update both conditional commands in [.github/workflows/fly-deploy.yml](../../../.github/workflows/fly-deploy.yml) to pass `--ha=false` without changing the `push` triggers, branch mapping, app selection, config selection, secrets, or deployment concurrency.
- [x] Refactor [src/bootstrap/registerWorkers.ts](../../../src/bootstrap/registerWorkers.ts) to retain every created BullMQ Worker and Queue and register an asynchronous Fastify `onClose` hook that closes Workers before Queues, including the optional OAuth worker and session-timeout resources.
- [x] Add idempotent `SIGTERM` and `SIGINT` handling around the executable entry point in [src/main.ts](../../../src/main.ts), calling `app.close()` once, logging shutdown failures through the structured logger, and avoiding signal-handler registration when tests merely import `bootstrap`.
- [x] Extend [src/bootstrap/registerWorkers.spec.ts](../../../src/bootstrap/registerWorkers.spec.ts) and the relevant bootstrap tests to prove that all created resources close, optional resources are handled correctly, repeated shutdown is safe, and importing the bootstrap path does not install production signal handlers.
- [x] Validate both Fly configurations with `flyctl config validate --strict --config fly.develop.toml` and `flyctl config validate --strict --config fly.toml`; do not deploy or alter Fly.io resources in this phase.
- [x] Run `pnpm test` and fix any failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 2: Synchronize canonical documentation and verify external safeguards

Document the completed lifecycle decision and verify the external GitHub and Fly.io state on which the merge-only and single-Machine contracts depend. Missing repository protection is a completion blocker, and any Machine scale-down requires explicit confirmation because it destroys capacity.

- [x] Add a new ADR from [docs/templates/adr.md](../../../docs/templates/adr.md) that records the persistent single-Machine Fly.io lifecycle, the cost-versus-availability trade-off, the 30-second graceful-shutdown policy, and the fact that it supersedes only the temporary lifecycle subsection of ADR-010 without editing the merged ADR.
- [x] Add the new ADR to [docs/adr/README.md](../../../docs/adr/README.md) with its final identifier, title, and status.
- [x] Update [docs/features/deployment.md](../../../docs/features/deployment.md) to state that deployment workflows are triggered only by pushes to protected `develop` and `main`; explicitly state that PR opening and `synchronize` do not deploy and that a push workflow alone cannot distinguish a merge from a direct push.
- [x] Correct the deployment guide's contradictory direct-push wording and document the required no-bypass, administrator enforcement, force-push restriction, PR requirement, and `quality` status check.
- [x] Update the same guide with the persistent BullMQ lifecycle, disabled autostop/autostart settings, removal of `min_machines_running`, graceful termination behavior, single-Machine recovery behavior, and staged rollout and rollback procedures.
- [x] Update the deployment entry in [docs/features/README.md](../../../docs/features/README.md) so the index mentions the persistent worker lifecycle and merge-protected deployment policy.
- [x] Verify the active GitHub branch protections or rulesets for `develop` and `main`: required pull requests, required `quality` check, administrator enforcement, disabled force-pushes, and no bypass actors. If any requirement is absent or cannot be inspected, report the exact gap and leave the phase blocked until the user configures it or explicitly authorizes an in-scope correction; do not claim merge-only deployment and do not weaken existing rules.
- [x] Inspect both Fly apps with `flyctl scale show --app <app-name>` and `flyctl machine list --app <app-name>` to resolve the `app` process group, region, Machine identifiers, status, and total count.
- [x] If either `app` process group has a count other than one, present the exact current and target state and obtain explicit user confirmation before running `flyctl scale count app=1 --app <app-name>`; do not modify unrelated process groups or Machines.
- [x] After any approved scale change, repeat `flyctl scale show` and `flyctl machine list`; confirm exactly one `app` Machine remains in the intended region for each environment and record its current state. Running-state and idle-persistence verification follow the Phase 3 deployment because the live Machines still use the prior auto-stop configuration.
- [x] Run `pnpm test` and fix any failures.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Phase 3: Roll out through protected branches and verify persistence

Roll out the same reviewed change to development first and production second, using only merged pull requests and treating successful runtime verification as part of completion rather than leaving it as an unspecified future activity.

- [ ] After the user merges the reviewed pull request into `develop`, verify that the GitHub Actions run was caused by the resulting push, used `fly.develop.toml`, passed `--ha=false`, and targeted `gastto-develop` without exposing secrets.
- [ ] Verify `gastto-develop` reports exactly one running `app` Machine, the health endpoint responds successfully, worker-start logs appear, and the Machine remains running after an idle interval long enough for Fly Proxy autostop evaluation.
- [ ] Trigger or observe an existing safe development queue operation and verify that delayed or pending BullMQ work continues after the idle interval; do not use production data or create irreversible external records.
- [ ] Exercise a controlled development shutdown or redeploy and verify logs show the Fastify and BullMQ close path completing within the 30-second window; if it does not, stop promotion and adjust the drain behavior or timeout based on evidence.
- [ ] After development verification succeeds and the user promotes the same reviewed change to `main` through a pull request, verify that the GitHub Actions run used `fly.toml`, passed `--ha=false`, and targeted `gastto`.
- [ ] Verify production has exactly one running `app` Machine, a healthy endpoint, expected worker-start logs, and no new shutdown, Redis, queue-stall, or repeated-job errors, without exposing secrets or mutating production data.
- [ ] If rollout fails, follow the repository rollback policy by reverting the relevant merge commit and redeploying the prior application version while keeping autostop disabled; do not force-push, edit migration history, or re-enable idle shutdown for a runtime that still hosts BullMQ workers.
- [ ] Record the final GitHub protection, Fly scale, health, and graceful-shutdown verification results in the pull request or deployment record, without copying secrets or sensitive log payloads.
- [ ] Run `pnpm test` and fix any failures.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

# Next step

Plan execution closed at the user's request after Phase 2; Phase 3 remains intentionally pending until the committed branch is merged through protected `develop` and `main` and the rollout can be verified.
