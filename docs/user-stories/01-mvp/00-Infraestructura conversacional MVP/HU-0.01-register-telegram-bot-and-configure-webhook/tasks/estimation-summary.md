# Estimation Summary

## Total Effort

**8.5 hours**

## Hours Distribution per Task

| Task ID   | Title                                                      | Estimated Hours | % of Total |
| --------- | ---------------------------------------------------------- | --------------- | ---------- |
| T-0.01-00 | Bootstrap Fastify project skeleton and core infrastructure | 2               | 23.5%      |
| T-0.01-01 | Register Telegram bot with BotFather and secure API token  | 1               | 11.8%      |
| T-0.01-02 | Create Fastify webhook endpoint route and controller       | 1               | 11.8%      |
| T-0.01-03 | Implement Telegram source validation middleware            | 1               | 11.8%      |
| T-0.01-04 | Configure production webhook via Telegram API              | 1               | 11.8%      |
| T-0.01-05 | Implement /start command use case and welcome message      | 1.5             | 17.6%      |
| T-0.01-06 | Verify end-to-end webhook latency and retry behavior       | 1               | 11.8%      |
| **Total** |                                                            | **8.5**         | **100%**   |

## Coherence Check with Story Points

- **User Story Story Points:** 2 SP
- **Estimated Range for 2 SP:** 4–8 hours
- **Total Estimated Hours:** 8.5 hours
- **Status:** ⚠️ **Slightly above nominal range.** The total exceeds the 2 SP upper bound by 0.5 hours.

## Estimation Justification

The 8.5-hour total is slightly above the nominal 2 SP range because the first User Story of the project carries the **foundational bootstrap cost** (T-0.01-00) that subsequent HUs will reuse without incurring again. This is a known and acceptable exception for the initial HU.

1. **Project bootstrap (T-0.01-00):** Setting up Fastify, TypeScript, Pino, Sentry, Zod config, and Clean Architecture folder structure is real foundational work (2h). This is a one-time cost.
2. **Bot registration (T-0.01-01):** Registering with BotFather and storing secrets remains trivial (1h).
3. **Webhook route (T-0.01-02):** Now focused strictly on the route, controller, and Zod schema validation, without scaffold work (1h).
4. **Source validation (T-0.01-03):** Header token validation in Fastify `preHandler` (1h).
5. **Webhook configuration (T-0.01-04):** Telegram API `setWebhook` call and verification (1h).
6. **Application use case (T-0.01-05):** The `/start` use case enforces the Clean Architecture boundary: the Fastify route deserializes and delegates, the use case contains all business logic, and an output port keeps the Application layer agnostic of Telegram. This boundary discipline takes slightly more effort upfront but prevents architectural collapse in later HUs (1.5h).
7. **End-to-end verification (T-0.01-06):** Production latency test and retry behavior observation (1h).

**Key architectural safeguard:** T-0.01-05 explicitly establishes that business logic lives in the Application layer (`HandleStartCommand` use case) and that the Fastify route handler is a thin transport adapter. This boundary must be enforced in code review for every subsequent HU.
