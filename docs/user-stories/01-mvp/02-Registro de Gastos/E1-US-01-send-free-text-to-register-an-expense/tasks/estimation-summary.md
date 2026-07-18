# Estimation Summary — E1-US-01: Send free text to register an expense

## Total hours: 10.0 hours

## Distribution per task

| Task ID | Title | Estimated Hours |
|---|---|---|
| T-E1-US-01-01 | Define free-text message intent value object | 1.5 |
| T-E1-US-01-02 | Implement heuristic expense-intent classifier | 2.5 |
| T-E1-US-01-03 | Add expense guidance response use case and copies | 1.5 |
| T-E1-US-01-04 | Update RouteIncomingMessage to classify and route | 2.0 |
| T-E1-US-01-05 | Add integration tests for free-text expense entry | 2.5 |
| **Total** | | **10.0** |

## Coherence check with Story Points

- User Story Story Points: **3**
- Expected range for 3 SP: **6–12 hours**
- Estimated total: **10 hours** ✅ Within range

## Justification

- The project already has Telegram webhook infrastructure (`TelegramPayloadParser`, `TelegramWebhookConfigurator`), a normalized payload contract (`NormalizedPayload`), and the `RouteIncomingMessage` use case. **No bootstrap task is needed**.
- Effort is concentrated on the classification logic (domain value object + application service: 4 h), the routing update (2 h), the guidance response (1.5 h), and integration tests (2.5 h).
- The classifier is heuristic-based (no LLM) and intentionally simple for this story, keeping the estimate low. Later stories will add LLM-powered interpretation with higher complexity.
- WhatsApp integration is not included (Telegram only for this iteration), reducing scope vs. the full story text.
