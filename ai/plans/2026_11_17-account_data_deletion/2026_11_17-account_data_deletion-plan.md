# Account and personal data deletion

## Goal

Allow a person to explicitly confirm deletion of their own Gastto account and the data Gastto retains, with safe recovery from partial failures. Stop account processing, attempt Google authorization revocation, permanently remove local credentials and account data, and preserve the user's external spreadsheet contents.

## Context

- The user approved the three phases and proposed contracts on November 17, 2026. This document authorizes planning only; implementation requires a separate instruction.
- Follow [AGENTS.md](../../../AGENTS.md), [plan conventions](../../../docs/plans/plan-conventions.md), [ADRs](../../../docs/adr/adr.md), and [testing guidelines](../../../docs/testing/guidelines.md).
- Relevant documented behavior: [incoming routing](../../../docs/features/incoming-message-routing.md), [cloud connection](../../../docs/features/cloud-storage-connection.md), [access approval](../../../docs/features/telegram-access-approval.md), [security](../../../docs/features/security-hardening.md), [conversation state](../../../docs/features/conversation-state-management.md), and [spreadsheet settings](../../../docs/features/chat-spreadsheet-settings.md).
- Persistence: [schema](../../../src/infrastructure/db/schema/index.ts), [data model](../../../docs/architecture/data-model.md), [configuration](../../../docs/architecture/config-env.md), and [repositories](../../../src/infrastructure/db/repositories/).
- OAuth: [port](../../../src/domain/ports/oauth.ts), [access service](../../../src/application/services/OAuthAccessTokenService.ts), [token repository](../../../src/infrastructure/db/repositories/DrizzleOAuthTokenRepository.ts), and candidate token storage. The current port has no revocation method; marking tokens revoked retains ciphertext.
- Processing: [workers](../../../src/interfaces/workers/), [Redis adapters](../../../src/infrastructure/redis/), webhook ingress, synchronous start handling, OAuth callbacks, reminders, and approval administration must participate in account lifecycle checks.
- Current deduplication keys contain channel and external message ID, without user ID. Establish ownership before targeted cleanup; never purge another account's keys or use global Redis deletion.
- Account deletion includes access requests, candidate credentials, payment methods, historical configurations, and identifiable operational data, in addition to the original handoff inventory. Verify the complete inventory against source before implementation.
- Expenses reference spreadsheet configurations with NO ACTION. Prefer explicit expense deletion before configuration deletion inside a transaction, verified against real PostgreSQL, without changing FK behavior.
- Frontend policy work belongs to the sibling repository `../gastto-frontend`. Read its AGENTS.md and locate its canonical policy source before editing. Do not substitute a backend document for the frontend change.
- Initial graph discovery used generation `2026-11-17T15:58:21Z`; checked Redis and candidate-token paths had no recorded coverage gaps. This was targeted discovery, not an exhaustive storage audit.
- External references: [Google token lifecycle](https://developers.google.com/identity/oauth2/web/guides/use-code-model), [Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), and [GDPR Article 17](https://eur-lex.europa.eu/eli/reg/2016/679/oj/). Verify applicable retention facts; do not infer a legal obligation or promise immediate erasure of every backup.

## Phases

### Phase 1: Authenticated request and explicit confirmation

Deliver an interactable Telegram deletion request and cancellation flow in tests/development, with production activation disabled until the complete deletion path exists. Confirmation must never report that deletion started or completed before the durable executor is available.

Public contracts:

- The primary entry is `Eliminar cuenta` in the existing Telegram `Configuración` menu. Its confirmation is routed through the authenticated message worker and existing per-user state/lock protocol. Derive identity from trusted ingress, never a caller-supplied target user ID.
- If `Configuración` requires a completed onboarding state or valid OAuth, provide a narrow recovery entry to the same deletion flow for accounts that cannot open the menu. Do not use a separate destructive contract or silently leave these users unable to delete their account.
- `RequestAccountDeletion.execute({ userId, state, externalId })` stores a pending confirmation in the existing user-bound conversation state, with a 10-minute lifetime and single-use confirmation semantics.
- Exact `ELIMINAR MI CUENTA` confirms only the matching pending request; `cancelar` cancels it. Semantic interpretation cannot authorize deletion.
- Request copy: `Eliminar tu cuenta borrará los datos que Gastto conserva sobre ti y desconectará Google. No borrará ni modificará tu hoja de cálculo. Esta acción es irreversible. Escribe ELIMINAR MI CUENTA en los próximos 10 minutos para confirmar, o cancelar para salir.`
- Cancellation copy: `Solicitud cancelada. Tu cuenta no se ha eliminado.` Expired confirmation must ask for a new request without performing deletion.
- Persist confirmation identity binding, expiry, and consumption using an explicitly validated contract. Keep pending confirmation separate from durable deletion progress.

To-do:

- [x] Inspect settings menu routing, FSM precedence, private-chat identity validation, and access gates; make `Eliminar cuenta` discoverable in settings and keep the flow reachable when OAuth or approval is unavailable without bypassing identity verification.
- [x] Implement request, expiration, cancellation, and single-use confirmation handling with deletion execution disabled in production and no destructive executor in Phase 1.
- [x] Add meaningful tests for identity mismatch, absence of a caller-supplied target, expiration, replay, cancellation, missing OAuth, pending approval, and zero destructive effects before confirmation.
- [x] Document implemented request behavior in `docs/features/account-deletion.md` and update `docs/features/README.md`; document activation restrictions accurately.
- [x] Run the full test suite and relevant integration suites; fix failures. Direct Vitest invocation passed 2,808 tests (202 files) with expanded sandbox access on 2026-11-17; the local `pnpm` wrapper could not open its database.
- [x] Run lint and typecheck; fix issues. Direct ESLint and TypeScript invocations passed on 2026-11-17; the local `pnpm` wrapper could not open its database.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Complete deletion with recovery and isolation

Connect confirmation to an end-to-end durable deletion operation. Do not publish a partial implementation that deletes PostgreSQL while allowing queued work or credentials to continue operating.

Public contracts:

- `ConfirmAccountDeletion.execute(identity, confirmation)` atomically consumes valid confirmation and starts or returns the existing operation. Reject identity mismatch and expired requests.
- `AccountDeletionService.resume(operationId)` idempotently advances a durable operation. Missing already-deleted account data is success, not a restoration trigger.
- Account lifecycle distinguishes active accounts from deletion in progress. A minimal temporary operation records recovery checkpoints and remote-revocation outcome; no tokens or message text enter job payloads or operation logs.
- `OAuthServicePort.revokeToken(provider, token)` returns a sanitized bounded result such as revoked, already invalid, or remote failure. Credentials are never retained for indefinite remote retries.
- Account cleanup ports expose user-scoped PostgreSQL deletion and Redis/BullMQ cleanup. Implementation details stay outside application services.
- Completion copy: `Tu cuenta y los datos internos de Gastto se han eliminado. Tu hoja de cálculo no se ha modificado.` Use only after the declared operational deletion scope is verified, with any confirmed retention limitation clearly disclosed.
- Remote failure copy: `Gastto ha eliminado sus credenciales locales, pero no pudo confirmar la revocación en Google. Puedes retirar el acceso de Gastto desde las conexiones de tu cuenta de Google.`

To-do:

- [x] Inventory every user-associated table, Redis key family, job queue/state, OAuth nonce, reminder, cache, diagnostic artifact, and external log sink. Record ownership keys, cleanup method, races, and verification queries. Include emails in access requests and candidate OAuth tokens. The source-visible inventory and unresolved hosted sink capabilities are recorded in `docs/features/account-deletion.md`; Phase 3 must verify provider retention and deletion controls.
- [x] Design an additive schema for lifecycle/progress with bounded temporary identifiers and indexes. Generate migrations schema-first; do not hand-write migration SQL. Any destructive schema or ON DELETE change requires separate explicit confirmation before generation.
- [ ] Atomically persist the deletion barrier before acknowledging initiation. All ingress, workers, OAuth callbacks, refreshes, approval tools, synchronous start paths, and other writers must reject or quiesce that account under the same lifecycle protocol. Confirmation consumes the identity-bound, unexpired conversation revision and inserts the barrier in one PostgreSQL transaction. Credential and access-request writers share a database lock with barrier creation. Expense append, undo, and OAuth callbacks now hold an account-work fence through external effects and local finalization; other writer paths still need audit.
- [ ] Define fencing and draining for active operations. An expiring Redis lock alone is insufficient: stale workers must not write after deletion, and already-started external calls must settle before completion is declared. The PostgreSQL key-share fence makes confirmation wait for active append/undo and OAuth callback work, and rejects late effects; a real-DB test verifies both orders for the fence. Lost-connection effects and other external work still need coverage.
- [x] Prevent stale deliveries from creating a replacement account. Specify durable ingress replay protection without permanent personal tombstones; distinguish fresh explicit registration from an old `/start` delivery. Validate this protocol before enabling deletion. Migration `0019_tricky_leo` stores a 48-hour HMAC receipt in PostgreSQL, independent of the user row; startup/hourly pruning removes expired rows. The webhook retains a claim after a later failure, accepts a fresh message ID, and refuses to start without the guard. Real-DB and route tests passed. The bounded guarantee assumes Telegram delivery through the authenticated webhook.
- [x] Block local credential use immediately; attempt bounded revocation for active and candidate grants, then permanently delete local ciphertext regardless of remote outcome. On crash, recovery must clear remaining credentials without reopening access. Record uncertainty rather than retaining secrets for remote retry.
- [x] In a PostgreSQL transaction, delete expense records before historical and active configurations, then remove all user-owned descendants and account data. Include soft-deleted records and operation logs; verify behavior with the actual schema and foreign keys.
- [ ] Purge targeted waiting, prioritized, delayed, paused, completed, failed, and applicable scheduled/repeat jobs and their retained payloads. Coordinate active jobs rather than blindly removing locks. Remove account caches, nonce/state keys, correction states, deduplication markers with proven ownership, and cleanup indexes. Marker and owner-index writes are atomic in Redis; queue cleanup now rescans retained states and keeps the barrier when owned jobs remain. An integration test confirms active work blocks erasure and a later retry completes; exhaustive state coverage and cross-system absence assertions remain outstanding.
- [x] Resolve legacy Redis markers lacking ownership conservatively. Document and test any namespace migration or bounded expiry prerequisite; do not claim full cleanup while attributable legacy payloads remain.
- [x] Keep a minimal recovery record only until all cleanup stages and bounded notification handling finish. Define crash-safe ordering for final notification and record removal; delivery cannot be guaranteed if Telegram is unavailable. Notification failure must not restore account data or retain personal identifiers indefinitely.
- [ ] Test interruption after every checkpoint, Redis/DB outages, remote revocation failure, duplicate confirmations, concurrent OAuth callbacks/refreshes, active jobs and stale workers, multiple accounts, already-deleted accounts, and no financial/token data in errors.
- [ ] Run real PostgreSQL and Redis/BullMQ integration tests asserting absence of every inventoried record/key/job, preservation of unrelated users, and zero Sheets mutation calls by deletion. Verify pre-existing in-flight writes settle before completion. The flow test seeds historical/inactive descendants, a soft-deleted expense, queue data, logs, tokens, owned jobs, and an atomic Redis marker. It now verifies active-job retry and PostgreSQL fencing of an in-flight external effect; every queue state, connection-loss case, and full Sheets mutation assertion remain outstanding.
- [x] Update feature docs, routing/OAuth docs where changed, data model, and an ADR explaining lifecycle, retry, replay, and temporary retention trade-offs. Update corresponding README indexes.
- [x] Run `pnpm test` and relevant integration suites; fix failures. Apply additive migrations only in an authorized local test environment, following repository secret restrictions. Direct Vitest passed 2,853 tests (207 files) with Docker access on 2026-11-19, including migration `0019` in isolated PostgreSQL; the local `pnpm` wrapper could not open its database.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any. Direct project-scoped ESLint and TypeScript invocations passed on 2026-11-19 after account-work fencing; the local `pnpm` wrapper could not open its database.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Privacy policy, operational recovery, and release verification

Make the implemented deletion behavior and its operational limits visible to users and operators, then validate readiness for activation.

Public contracts:

- Frontend privacy policy explains the Telegram request, explicit confirmation, internal deletion scope, preservation of Sheets, remote-revocation fallback, and any verified retention exceptions.
- Retention statements identify actual purpose, data categories, duration or deletion criteria, and responsible system. No speculative legal retention and no permanent identifying audit record solely to prove deletion.
- Recovery runbook specifies how restored backups are prevented from reactivating deleted identities or credentials, without silently introducing permanent personal tombstones.

To-do:

- [x] Inspect the frontend repository instructions and policy implementation, then update its canonical content to reflect implemented behavior. Run that repository's required checks. The Spanish policy draft and legal-page catalog are updated in `../gastto-frontend`; validation, lint, typecheck, unit tests, production build, and legal-page browser test passed.
- [ ] Confirm actual hosted log, backup, replica, export, and processor retention/deletion capabilities. Distinguish controllable operational data from provider-held data; resolve gaps before promising complete removal. Fly log windows and absence of a production Sentry secret were verified; Supabase plan/backup/PITR, replicas, exports, Redis provider, Vercel settings, and log drains need account-specific evidence.
- [ ] Define and validate restoration quarantine and erasure reconciliation. A backup restore must not resume message processing or credential use until deletion obligations have been reapplied. Escalate any unresolved retention-versus-recovery trade-off explicitly rather than inventing retention authorization. The quarantine rule is documented; an independent bounded erasure record and reconciliation tool are still missing.
- [x] Document failure recovery, remote Google access removal instructions, bounded final notification handling, and operator verification without exposing personal or financial data. See `docs/operations/account-deletion-recovery.md`.
- [x] Update `docs/features/account-deletion.md`, relevant architecture/configuration docs, ADRs, and their README indexes. Keep policy claims synchronized with verified behavior.
- [ ] Run the complete acceptance matrix: own-account authorization; no subsequent processing; PostgreSQL/Redis/jobs cleared; remote revocation attempted and local tokens removed; Sheets unchanged; retries safe; automated coverage complete; privacy text accurate. The matrix and open rows are recorded in `docs/operations/account-deletion-recovery.md`.
- [ ] Verify deployment ordering and rollback: schema and lifecycle-aware workers must precede activation; rollback must not restore ordinary processing for pending deletions. Existing irreversible deletions cannot be undone by code rollback. Ordering and rollback guards are documented but have not been rehearsed.
- [ ] Record unresolved operational evidence as release blockers. Enable the production entry point only when the full deletion path and policy are ready, through the separately authorized release workflow. Blockers are recorded; activation remains disabled.
- [x] Run `pnpm test` and required backend/frontend integration checks; fix failures. Direct backend Vitest passed 2,853 tests on 2026-11-19. Frontend Vitest passed 16 tests, the legal-page browser test passed, and the build succeeded before the new PostgreSQL replay receipt; its draft privacy copy needs that Phase 3 update. The local `pnpm` wrapper could not open its database.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any. Direct backend and frontend ESLint and TypeScript invocations passed; the local `pnpm` wrapper could not open its database.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Finish the Phase 2 audit of remaining writers, lost-connection external effects, and full cleanup states; then update the Phase 3 frontend privacy copy for the PostgreSQL replay receipt and complete provider evidence, restore reconciliation, acceptance matrix, and release rehearsal. Keep production deletion disabled until those gates pass.
