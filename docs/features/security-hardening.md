# Security hardening

## Implemented contracts

Node 24 is the runtime line for CI and all container stages. Images use a fixed digest; external Actions use full SHAs and Fly CLI is pinned. The runtime user is `node`. pnpm 10.34.9 is pinned for builds; npm, pnpm, Corepack and Yarn are absent from the final runtime filesystem. Production dependencies are copied from a separate install stage. Docker excludes environment variants, credential/key patterns and local tooling metadata. Dependency versions are resolved by the frozen lockfile; the two scoped glob overrides fix cancellation in Swagger/Sentry dependency paths. Remove them when their parent constraints include the patched release.

`pnpm security:audit` runs a production audit and writes a sanitized `security-audit.json`. `pnpm security:audit:all` also covers development/build dependencies and writes `security-audit-all.json`. Both gates use the same fail-closed validation and exception policy. Exit 0 means no unaccepted findings, 1 means advisories, 2 means unavailable/invalid evidence. Exceptions in `scripts/security/exceptions.json` must identify advisory/package/version/path, owner, approval, reason, compensating control, issue and expiry. The current list is empty. CI runs both gates before deployment, preserves both reports for 14 days and repeats checks each Monday without deploying. The repository maintainers own weekly audit failures and monthly review of action/tool/image pins. GitHub scheduled workflow notifications must be configured and verified by the operator.

## HTTP behavior

Telegram authenticates in `onRequest`, before parsing. Invalid/missing secrets return 403, or 429 after 60 unauthorized attempts per 60 seconds. Valid Telegram updates bypass the limiter. JSON/schema errors can fail before the handler; handler-level malformed and non-private updates retain their 200/no-effect behavior. Queue failures are not acknowledged as success.

OAuth callbacks share the same default budget. Their route provider is passed to nonce validation and must match stored metadata before token exchange. On admission rejection, no nonce, token or messaging effects occur. 429 includes `Retry-After`; an unavailable limiter returns 503 and `Retry-After: 1`. Responses use `Cache-Control: no-store`. Callbacks still return existing success/failure HTML after admission.

The limiter hashes socket peer addresses into 4096 Redis buckets per route/environment, uses atomic counters with TTL and ignores all forwarding headers. Redis latency is capped at 250 ms with at most 16 outstanding calls per instance. These bounds prevent unbounded client-key growth. Fly proxies/NAT or hash collisions may share budgets: hosted validation and tuning are required. This does not limit authenticated Telegram users or LLM spending. See [the boundary ADR](../adr/2026-11-01-http-security-boundaries.md).

`SECURITY_RATE_WINDOW_MS` defaults to 60000 (allowed 1000–3600000), `SECURITY_TELEGRAM_LIMIT` and `SECURITY_OAUTH_LIMIT` default to 60 (allowed 1–10000). Missing values use defaults; invalid values fail startup.

Production does not register `/documentation`, spec, redirect or static routes; they return 404. Non-production docs remain enabled. `/health` is unaffected. Fly development is public and must not be mistaken for a private environment.

`TELEGRAM_WEBHOOK_SECRET` must match `[A-Za-z0-9_-]{32,256}`. Generate it from 32 random bytes using a secret manager, not a memorable phrase. `ENCRYPTION_KEY` must contain exactly 64 hexadecimal characters. This validation does not rotate the encryption key or change existing AES-GCM ciphertext.

## Rotation and recovery

Rotate the webhook secret using the existing permissive release first. Drain/stop old Machines that could call `setWebhook` with an old secret, set the new secret through the environment's secret manager, and restart consistent instances. Verify registration and a synthetic private-chat canary. Keep pending updates; do not request `drop_pending_updates`. The single-secret contract permits a brief retry window, not a zero-downtime guarantee. Then promote the strict-validation release. Recover using a compatible known-good image with the new valid secret, and verify queues and one expense canary. Do not flush Redis or revert an AES key. Release rollback uses the repository merge-revert policy.

## Telemetry and alerts

Excel adapter errors use injected structured Pino logging. Shared scrubbing redacts sensitive object keys and free-form exception/error message fields. HTTP unexpected failures return a generic 500 and emit `HTTP_UNEXPECTED_ERROR`; expected 4xx errors are not sent to Sentry. `HTTP_RATE_LIMITED` and `LIMITER_UNAVAILABLE` events are sampled to one per 10 seconds per hook/instance to avoid attacker-driven log amplification. No raw peer address or nonce is used as a metric label.

Operator alert specification: route sustained limiter events (at least 3 samples in 5 minutes), any repeated limiter-unavailable event (2 in 2 minutes), and unexpected 5xx (5 in 5 minutes) to the service maintainer. Deduplicate per environment/route/code for 10 minutes. Check Redis connectivity/latency, backlog and legitimate callback errors before changing budgets. Secret exposure or cross-user effects trigger immediate promotion stop and incident handling. These rules are a runbook, not proof of configured external notification delivery.

## Verification and pending operational gates

Automated coverage includes config boundaries, callback provider binding, production docs availability, actual redaction output, concurrent shared Redis budgets/TTL, spoofed headers, outages and no downstream effects. CI explicitly enables opt-in PostgreSQL suites and requires Docker. Findings and command evidence are in the [execution report](../../ai/plans/2026_11_01-owasp_top_10_remediation/execution-report.md).

Hosted canary, secret rotation, alert delivery and development rollback rehearsal require their own recorded operator evidence before production promotion. The [operational checklist](../../ai/plans/2026_11_01-owasp_top_10_remediation/operational-checklist.md) records exact validation steps and release stop criteria. Container scanning is recorded separately in the execution report. Local passing tests do not establish these external facts.

## Hosted verification checkpoint (2026-11-03)

The authorized development canary completed a 30-minute observation window with 31 healthy HTTP samples. Public ingress tests verified webhook/callback rate boundaries despite forged forwarding headers, no-store callback responses, provider mismatch rejection without nonce consumption and authenticated ignored-update bypass. A controlled two-second Redis pause, performed with no active/waiting jobs, produced OAuth 503 and recovered automatically. Queue failure counts did not increase.

An image rollback to the retained pre-change digest restored health, Redis and webhook registration; the corrected candidate is restored after the rehearsal. This is technical canary/recovery evidence, not a completed financial-account or notification-delivery exercise. Synthetic account/sheet validation, operator secret rotation confirmation, external alert delivery and required CI checks on the release commit remain open. See [hosted evidence](../../ai/plans/2026_11_01-owasp_top_10_remediation/hosted-validation.json).

## Development dependency remediation (2026-11-03)

Six parent-scoped overrides close the development advisories: ESLint, its config-array and the TypeScript parser use minimatch 11, readdir-glob uses the compatible named Minimatch class from version 11, archiver-utils uses glob 14, and Drizzle's legacy loader uses esbuild 0.25. These are limited to their named consumers; remove each override when its parent dependency range includes the patched release. `scripts/security/toolchain.test.mjs` verifies archive selection/content and executable TypeScript transformation. Isolated schema generation is compared with the previously reviewed delta, without applying migrations or loading real credentials. Full dependency auditing is now a required CI gate, so tooling advisories cannot silently reappear while production auditing stays green.
