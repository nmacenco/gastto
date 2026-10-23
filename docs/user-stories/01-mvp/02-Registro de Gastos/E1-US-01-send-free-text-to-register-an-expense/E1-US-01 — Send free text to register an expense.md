**User Story**

> As a user who wants to register an expense, I want to send a natural language text message within my WhatsApp or Telegram chat, so I can start the registration without having to learn any format or open any other application.

---

**Acceptance Criteria**

Feature: Send free text to register an expense

  Scenario: Happy path — message with clear amount and concept
    Given the user has FinFlow active in their messaging channel
    And the user's spreadsheet is already linked and configured
    When the user sends a message like "Pagué el almuerzo, 12 euros"
    Then the system acknowledges receipt in less than 1 second
    And starts the expense interpretation flow

  Scenario: Message with partial information
    Given the user has FinFlow active
    When the user sends a message like "Almuerzo 12" without specifying currency
    Then the system acknowledges receipt in less than 1 second
    And starts the interpretation flow, requesting clarification at the corresponding step

  Scenario: Empty message or no recognizable financial content
    Given the user has FinFlow active
    When the user sends a message like "Hola" or "👋"
    Then the system responds with a friendly message indicating how to register an expense
    And does not start any saving flow

  Scenario: Very long message (more than 500 characters)
    Given the user has FinFlow active
    When the user sends a message that exceeds 500 characters
    Then the system acknowledges receipt
    And attempts to extract the expense information from the relevant content
    And if it cannot interpret it, requests the user to rephrase it in a single sentence

**Definition of Done**

- The system receives text messages in Telegram and acknowledges receipt in ≤ 1 second under normal network conditions.
- Messages without recognizable financial content generate a guiding response, not an error.
- Messages with partial information pass to the interpretation flow without blocking at this stage.
- Behavior is covered by integration tests.
- No web interface or additional screen is involved in this step.

**Story Points: 3**

> The entry channel already exists (Telegram). The real complexity is in the immediate acknowledgment and correct routing of the message. No interpretation logic lives in this story; that is resolved in subsequent stories. Handling edge cases (empty messages, long messages) adds test surface but no business complexity.

**Dependencies**

- Epic 4 — Spreadsheet linking completed (E4-US-01 to E4-US-05): the system must know which spreadsheet the user belongs to before any message has a destination.
- Integration with the Telegram Bot API operational.
