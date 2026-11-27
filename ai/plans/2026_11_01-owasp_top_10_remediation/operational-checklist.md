# Operational release checklist — technical validation complete, business gates pending

Owner: service/repository maintainer. The user authorized development canary and rollback on 2026-11-02. Actual results are recorded separately in [hosted-validation.json](hosted-validation.json); unchecked/manual exercises remain pending. Use synthetic accounts and the development environment. Never copy credentials, callback codes or state into this record. Local results and image identifiers belong in [execution-report.md](execution-report.md).

## Before promotion

- Record the reviewed release commit, final image digest, lockfile SHA-256 and successful required GitHub check URLs. Local working-tree evidence must be rerun on that commit; no release commit has been created by this task.
- Record environment/app, operator, UTC start/end, public config names and non-secret values (Node mode, rate window and budgets). Reference secret-manager versions by identifier only. Do not hash low-entropy secret values or paste secrets.
- Retain the known-good compatible image and configuration. Confirm a supported, uncompromised webhook secret before strict-schema rollout. Follow the canonical [rotation runbook](../../../docs/features/security-hardening.md#rotation-and-recovery) under the existing permissive release first; stop/drain every old Machine that might re-register its secret. Retain pending updates.
- Check actual Fly ingress provenance and peer sharing, HTTPS enforcement, Redis TLS and connection health. Repository `force_https = true` is configured in both Fly files; live TLS/ingress evidence is still required. Keep forwarding headers untrusted until proven otherwise.

## Development canary

Observe for at least 30 minutes, including one whole configured rate window after an intentional limit. Record only status codes, stable event codes, aggregate timings/counts and synthetic record identifiers.

| Exercise                                                | Required observation                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health` and docs                                      | Health 200; development docs available; production container docs all 404.                                                                                                                                       |
| Wrong/missing webhook secret + malformed JSON           | 403 below budget, 429 above budget, zero identity/queue/messaging effects.                                                                                                                                       |
| Valid private webhook and legitimate burst              | Accepted within existing contract, immediate acknowledgement precedes processing; one confirmed expense, no lost updates. Use controlled synthetic volume and measure latency/backlog before tuning.             |
| Shared NAT/proxy callbacks                              | Complete legitimate OAuth callbacks at expected peak; document peer-sharing collision risk and selected budgets.                                                                                                 |
| OAuth success/denial/replay/expired/mismatched provider | Existing success/denial HTML; expired/replayed/mismatched state has no token exchange or financial effects; all responses no-store. Never log actual callback URLs.                                              |
| Redis admission outage and recovery                     | OAuth 503 before nonce effects; wrong webhook stays 403; valid webhook reaches queue behavior without false success on queue failure; recovery restores admission. Fault injection only in isolated development. |
| Safe telemetry and alert delivery                       | Synthetic canary secret absent from actual logs/events; event code retained; deliver a synthetic alert to the authorized notification channel and record delivery timestamp/evidence reference.                  |
| Retry/replay of one expense                             | Exactly one external row and one record; stale revision and cross-user requests have no effects.                                                                                                                 |

Stop promotion on any lost update, cross-user effect, duplicate financial write, secret exposure, unexpected sustained 5xx/429 or stalled queue. Investigate before changing thresholds; a quiet dashboard alone is insufficient.

## Rollback rehearsal

Use the retained compatible image; for a merged release revert with `git revert -m 1 <merge-sha>`, then follow the normal pipeline. Keep the rotated valid webhook secret. Confirm registration points to the expected environment, pending queues drain, and one synthetic expense completes exactly once. Record rollback image/commit, duration, queue counts and canary evidence. Never flush Redis, drop Telegram updates, edit applied migrations, restore compromised secrets or force-push.

## Residual follow-ups

- Development dependency findings: closed locally by scoped overrides, compatibility tests and a zero full audit; see `dependency-development.json`. Run the full-audit gate again on the release commit. No exception is approved here.
- Authenticated Telegram flooding/LLM spending: separately design per-user quotas and cost monitoring while preserving legitimate financial confirmation. Track at `ai/plans/2026_11_01-owasp_top_10_remediation/residual-risks.md`.
- Public development docs and shared peer budgets: record access restrictions and real traffic measurements before promotion.
