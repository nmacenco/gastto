
**User Story**

> As a user who just sent an expense message, I want to receive a visual or textual signal that the system received it in less than one second, so I am not left uncertain or resend the message by mistake.

---

**Acceptance Criteria**

Feature: Immediate acknowledgment when receiving a message

  Scenario: Happy path — message received within the time limit
    Given the user sent a message describing an expense
    When the system receives it
    Then the system sends an acknowledgment in ≤ 1 second
    And the acknowledgment is brief and non-intrusive (e.g., "Received, processing your expense…")
    And it does not block the user from sending another message while waiting

  Scenario: High load — the system takes more than 1 second to process
    Given the system is under heavy load
    When the user sends a message
    Then the acknowledgment is still sent in ≤ 1 second
    And interpretation processing continues in the background
    And the user receives the interpreted summary when it is ready, without requested resends

  Scenario: The system cannot acknowledge receipt (total connectivity failure)
    Given the system loses connection with the messaging channel
    When the user sends a message
    Then the system does not send an acknowledgment
    And when connectivity is restored, the system evaluates whether the message remained pending processing
    And it does not generate a duplicate record

**Definition of Done**

- The acknowledgment time is measured in the staging environment and meets ≤ 1 second at the 95th percentile.
- The acknowledgment message is visually differentiated from the final summary (they are not confused).
- The processing flow is asynchronous: the acknowledgment does not block interpretation and vice versa.
- There is an idempotency mechanism that prevents processing the same message twice if it arrives duplicated.

**Story Points: 2**

> The functionality is concrete and bounded: send a message in ≤ 1 second. The complexity lies in guaranteeing asynchronicity and idempotency, but it does not involve complex business logic. It has no significant flow branches.

**Dependencies**

- E1-US-01: the message must be reaching the system correctly.
- Asynchronous messaging infrastructure operational (message queue or equivalent).
