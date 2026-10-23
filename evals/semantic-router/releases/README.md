# Semantic router release evidence

This directory stores immutable, aggregate-safe release candidates for ADR-023. A bundle is append-only: changing source, model, prompt, contract, policy, dataset, labels, thresholds, pricing, or evidence creates a new candidate directory.

## Workflow

1. Copy the pending threshold template into a new candidate directory. Product Owner and Tech Lead supply numeric gates, minimum samples, approved pricing, identities, and approval time before any live call.
2. Independently review and freeze labels. Record only version identifiers and checksums here; never store production messages or provider bodies.
3. Add implementation and proposal evidence, then list every artifact filename and raw SHA-256 digest in the manifest.
4. Run `pnpm eval:semantic-router:release --thresholds <file> --manifest <file> --implementation <file> --offline-development <file> --offline-held-out <file> --output <new-file>` and add later evidence arguments only when those stages are authorized.
5. Treat exit `0` as approval only for the manifest's requested next stage. Exit `1` means a gate failed; exit `2` means invalid or incomplete evidence. Existing output files are never overwritten.

The command is offline-only and does not import dotenv, application bootstrap, database, Redis, queues, or provider SDKs. Artifact schemas reject unknown fields. Rollout observations permit only aggregate release metadata and explicitly exclude messages, option labels, amounts, full payloads, credentials, provider bodies, reasoning, and identity-bearing values.

## Outcome accounting

- An eligible expense starts once at deterministic admission. Duplicate webhook delivery and repeated callbacks do not create starts.
- Direct, clarified, corrected, and separately admitted queued expenses share the expense denominator. A queued item starts once when admitted, not again when advanced.
- `task_completed` requires the actual terminal save outcome. Failed/unknown append, retry requests, and presented confirmations are not completions.
- Cancellation, timeout, failure, and unknown outcome remain distinct terminals in the same expense denominator. A retry does not add a new start.
- Option selection and control actions use their own capability counts and cannot increase completed-expense counts.
- Router, extraction, and correction calls are costed separately. Any missing usage or approved model price makes cost incomplete rather than zero.

## Privacy and review

Before import, reviewers must verify the strict allowlist in `release-contracts.ts`, inspect aggregate files for identity/message fields, and confirm every manifest digest. Zero observed critical events is a necessary release gate, not proof of zero production risk.

