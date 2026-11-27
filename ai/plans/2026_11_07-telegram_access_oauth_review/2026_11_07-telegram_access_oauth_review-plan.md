# Telegram Access Approval and Google OAuth Review Plan

## Goal

Let a person enter the production Telegram bot, request access using an email address, receive approval after the operator confirms the Google Cloud test-user entry, and complete Google OAuth before any model API call can run. Preserve the existing account and spreadsheet during an email change until a replacement account and destination are ready. This is an implementation plan for an exploratory proposal, not a declaration that all design and Google Cloud prerequisites are settled.

## Context

- [Exploratory proposal](./proposed-telegram-access-and-oauth-review-flow.md): agreed flow, accepted limits, and unresolved operator Gmail authorization.
- [Repository instructions](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), [ADR pack](../../../docs/adr/adr.md), [data model](../../../docs/architecture/data-model.md), [environment configuration](../../../docs/architecture/config-env.md), and [FSM states](../../../docs/architecture/fsm-states.md). Follow schema-first Drizzle migrations, explicit foreign-key deletion behavior and indexes, encrypted OAuth credentials, and documentation synchronization.
- [Cloud storage connection](../../../docs/features/cloud-storage-connection.md), [chat spreadsheet settings](../../../docs/features/chat-spreadsheet-settings.md), [incoming message routing](../../../docs/features/incoming-message-routing.md), [security hardening](../../../docs/features/security-hardening.md), and [deployment](../../../docs/features/deployment.md) describe the existing OAuth, settings, queue, security, and production paths. Update canonical feature documentation and its [index](../../../docs/features/README.md) when behavior is implemented; add an ADR and update its index if the final trade-offs warrant one.
- [Identity resolution](../../../src/application/use-cases/user/ResolveUserIdentity.ts), [start handling](../../../src/application/use-cases/conversation/HandleStartCommand.ts), [message worker](../../../src/interfaces/workers/message.worker.ts), [routing](../../../src/application/use-cases/conversation/RouteIncomingMessage.ts), [expense interpretation](../../../src/application/use-cases/expense/RegisterExpense.ts), [OAuth initiation](../../../src/application/use-cases/spreadsheet/InitiateCloudConnection.ts), [OAuth callback](../../../src/application/use-cases/spreadsheet/HandleOAuthCallback.ts), [token service](../../../src/application/services/OAuthAccessTokenService.ts), and [bootstrap](../../../src/bootstrap/buildDependencies.ts) are the main integration points.
- Production users and the product reviewer use the same bot and Google OAuth project. The reviewer is a product tester and must pass through the same Telegram access flow. The public website has no access form or model API path.
- Google Cloud does not send Gastto a test-user-list update. The owner manually verifies/adds the email in Google Cloud, then approves a specific Gastto request through a deployment CLI. Local approval does not prove which Google account completes OAuth; email matching is outside this proposal.
- The operator wants a personal `@gmail.com` account as the actual sender. Use the existing official `googleapis` client with only `gmail.send` in a **separate operator OAuth project/client**. Before integrating unattended mail, validate a durable refresh grant: Google's External/Testing refresh tokens can expire after seven days. Do not add Gmail scopes to product-user authorization, use an app password, or put the operator token in the user-token table. If durable authorization cannot be established, stop the mail slice and return to a sender/provider decision; do not silently deploy unreliable alerts.

## Phases

### Phase 1: Pending request and model-call admission

**Description:** Deliver a visible Telegram path from `/start` to a durable pending request, while centrally preventing all token-consuming model calls before a usable Google OAuth credential exists. This phase can be exercised locally without operator mail or approval automation.

**Public contracts:** Add `access_requests` with request ID, `user_id`, submitted email, request kind (`initial` or `replacement`), status (`pending`, `approved`, `superseded`), timestamps, and decision actor. Add unique/current-request constraints and indexes for user/status and approval lookup, with explicit foreign-key deletion behavior. Define `AccessRequestRepository` operations for current-by-user lookup, replacement/supersession, and current-by-ID lookup; `RequestAccess.execute({ userId, email, kind })` returns the current request and whether it was newly created/replaced; `ModelAdmission.assertAllowed({ userId })` determines whether OAuth is complete and a usable credential exists. Final method names and exact schema types may be refined with tests, but the ownership and atomicity requirements are fixed. Add deterministic Spanish copies for welcome, email prompt, pending, existing-approved, invalid email, and duplicate pending states.

- [x] Add the schema, generated additive migration, repository and transactional supersession so an older request cannot later become current. Preserve requests durably when a conversation timeout or cancellation occurs.
- [x] Wire `/start` and free-text routing so a private Telegram chat with no approved association gives its email once, sees pending status, and does not reach provider selection or OAuth initiation. A chat with an approved association proceeds toward `continuar`. Keep the process the same for the reviewer.
- [x] Place model admission before semantic routing, including shadow mode; enforce it again at model-calling use cases or a shared model boundary so queued jobs and alternate paths cannot bypass the gate. Refreshable access-token expiry remains usable; missing, rejected, or revoked credentials block model calls and trigger existing recovery guidance. Preserve existing authenticated expense behavior.
- [ ] Add meaningful unit and PostgreSQL/Redis integration tests for first request, repeat request, changed pending email, stale request, reviewer-equivalent behavior, no model invocation before OAuth, shadow mode, and credential loss. Update feature, FSM, data-model and index documentation for implemented behavior.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Operator notification, CLI approval, and OAuth continuation

**Description:** Complete the manual approval loop: email the owner from their Gmail account, approve one current request in a deployment CLI, notify the applicant in Telegram, and let `continuar` create a fresh Google OAuth link.

**Public contracts:** `OperatorMailPort.sendAccessRequestNotice({ requestId, chatId, email, kind, previousEmail? })`; a separate Gmail API adapter and deployment configuration for operator sender/recipient plus OAuth client credentials and refresh token; `ApproveAccessRequest.execute({ requestId, operatorIdentity })` with outcomes `approved`, `alreadyApproved`, `notCurrent`, or `notFound`; and a dedicated `approve-access-request <request-id>` CLI. The actor must come from a trusted deployment/operator context, not an arbitrary claimed CLI flag. Telegram copies distinguish pending approval, approval notification, `continuar`, and retryable OAuth failure. No public approval HTTP route is added.

- [ ] Validate a separate operator-mail Google Cloud project/client with `gmail.send`, the owner's Gmail account, publishing/verification state, and durable refresh access. Document the exact operational setup and recovery path without exposing credentials; treat failed validation as a blocker for this mail implementation.
- [x] Persist an email-delivery intent with the request, send a minimal notice after commit, and handle retries and ambiguous Gmail API timeouts with a local delivery record and explicit duplicate policy. A delivery failure must leave the access request pending and be visible to the operator. Replacement notices state clearly that the new email supersedes the old one for the Telegram chat.
- [x] Implement the CLI and approval use case with a transaction that checks request currency and records actor/time exactly once. Send the Telegram approval notice only after commit; make re-execution safe and recoverable if notification delivery fails.
- [x] Route exact `continuar` for an approved chat into a newly generated OAuth link. Keep OAuth callback, CSRF, encrypted-token persistence and spreadsheet onboarding protections. Do not require an unimplemented Google-email identity comparison.
- [ ] Test Gmail adapter at the network boundary, delivery failure and retry, stale/superseded approval, idempotent CLI execution, Telegram notification recovery, `continuar`, and OAuth denial/retry. Update canonical feature, configuration and deployment docs; add an ADR for the separate operator Gmail authorization if retained.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Safe email and Google account replacement in settings

**Description:** Let an already active user request a new email only through `configuración`. Keep the old approved email, credential, and spreadsheet active while the candidate email waits for approval and while the candidate OAuth and destination are configured.

**Public contracts:** Extend request status or link a replacement request to the active association without overwriting it. Add a staged, encrypted candidate Google credential and candidate destination tied to the user, settings flow ID and revision. `ActivateReplacement.execute({ userId, requestId, flowId, expectedRevision })` atomically promotes the approved candidate email, credential, destination and confirmed mappings; it returns `activated`, `stale`, or `conflict`. Define fixed chat copies for replacement request, approval, candidate OAuth, destination selection, confirmation, cancellation and failure. The current one-token-per-user/provider constraint must be addressed with an additive candidate store rather than prematurely replacing the active token.

- [x] Add the replacement entry to the settings menu and preserve active usage while the new email is pending or approved. A normal `/start` or message cannot change an approved email.
- [x] Stage a candidate OAuth credential without validating it against the old spreadsheet. Require a fresh file, sheet, access validation and mapping/configuration confirmation for the candidate account; a different Google account may not access the old destination.
- [x] Promote the candidate only after all checks succeed, using a guarded transaction and immutable source/flow checks. Cancellation, expiry, failed OAuth, stale callbacks, inaccessible sheet and persistence failures leave the old configuration active. Record enough state to recover safely after an interrupted cutover.
- [ ] Add tests for concurrent expense use during pending replacement, approval, candidate OAuth failure, destination mismatch, successful atomic activation, cancellation, duplicate callbacks and stale revisions. Update settings, OAuth, FSM and data-model docs and indexes. Document manual old-email cleanup in Google Cloud only after successful cutover; do not treat allowlist removal as token revocation.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 4: Reviewer journey and release evidence

**Description:** Verify the complete production-shaped journey and prepare a short, safe walkthrough for the person reviewing Gastto as an ordinary user.

**Public contracts:** No new product API. Publish operator and reviewer instructions: bot entry, email submission, pending notice, owner approval CLI, Telegram `continuar`, Google OAuth, test spreadsheet selection, and an expense test. Record the expected Spanish text and failure/retry guidance. A production test requires the reviewer email to be present in the production Google Cloud test-user list and the feature release to be deployed; a local test alone cannot establish this.

- [ ] Add an end-to-end test or focused integration suite across Telegram update, durable request, notification intent, CLI approval, OAuth callback, spreadsheet setup and first model-backed expense. Assert zero model-provider calls before OAuth, including shadow traffic, and no unauthorized calls after terminal credential failure.
- [ ] Verify normal-user and reviewer paths use identical rules, including a prelisted Google Cloud email that is not yet associated with a Telegram chat. Verify notification failure recovery and replacement-email rollback behavior.
- [x] Prepare a production rollout and manual canary checklist for the owner: isolated Fly secrets, Gmail sender authorization health, generated migration, OAuth callback, safe reviewer spreadsheet, CLI availability to owner only, rollback and audit evidence. Keep actual deployment and Google Cloud changes as operator actions requiring their own authorization.
- [ ] Update the canonical feature/deployment docs and directory indexes with implemented behavior. Run `pnpm test`, `pnpm build`, and the required security audit as release gates; record any external validation still pending.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

The user requested continuous execution of the full plan. The local implementation, additive migrations, CLI commands, feature documentation and reviewer runbook are in this workspace. The independent Google Cloud audience entry, durable Gmail authorization, production secrets, production migration/deployment, and live reviewer canary remain operator actions; they cannot be established by local tests. See [reviewer runbook](./reviewer-runbook.md).
