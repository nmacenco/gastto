# Estimation Summary — E1-US-02: Immediate acknowledgment of receipt

## Total hours: 8.0 hours

## Distribution per task

| Task ID | Title | Estimated Hours |
|---|---|---|
| T-E1-US-02-01 | Add external message ID to NormalizedPayload and job data | 1.0 |
| T-E1-US-02-02 | Define idempotency key value object and repository port | 1.0 |
| T-E1-US-02-03 | Implement immediate acknowledgment use case | 1.5 |
| T-E1-US-02-04 | Update Telegram webhook to send immediate acknowledgment and enqueue | 2.0 |
| T-E1-US-02-05 | Implement Redis idempotency repository | 1.5 |
| T-E1-US-02-06 | Update RouteIncomingMessage to skip duplicate messages | 1.0 |
| **Total** | | **8.0** |

## Coherence check with Story Points

- User Story Story Points: **2**
- Expected range for 2 SP: **4–8 hours**
- Estimated total: **8 hours** ✅ Within range (upper bound)

## Justification

- The project already has Telegram webhook infrastructure, BullMQ queues (`incomingMessageQueue`, `messageQueue`), `RouteIncomingMessage`, `MessagingOutputPort`, and Redis. **No bootstrap task is needed.**
- The largest effort is in T-E1-US-02-04 (2 h): moving the acknowledgment emission to the webhook handler while keeping the route thin, non-blocking, and well-tested.
- Idempotency is split across domain contract (T-E1-US-02-02), Redis implementation (T-E1-US-02-05), and integration into the routing flow (T-E1-US-02-06).
- The estimate reaches the top of the 2 SP range because the User Story explicitly requires idempotency and a ≤ 1 second latency guarantee, both of which add infrastructure and testing overhead.
