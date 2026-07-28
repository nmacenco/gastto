
**User Story**

> As a user who has just described an expense, I want to receive a structured summary of how the system interpreted my message before anything is saved, so I can verify the data is correct and have real control over what enters my spreadsheet.

---

**Acceptance Criteria**

Feature: Interpreted expense summary before saving

  Scenario: Happy path — all data detected correctly
    Given the system correctly interpreted the expense
    When it presents the summary to the user
    Then the summary includes: concept, amount, currency, category, and date (or "today" if not specified)
    And the format is clear and readable within the chat
    And the summary includes instructions to confirm, correct, or cancel

  Scenario: Category field with low confidence
    Given the assigned category has low confidence
    When the system presents the summary
    Then the category field is visually marked (e.g., with ❓ or "Correct?")
    And the rest of the summary is shown normally

  Scenario: Date field not detected
    Given the message did not mention a date
    When the system presents the summary
    Then the date field shows "Today" as the default value
    And the user can correct it before confirming

  Scenario: User does not interact with the summary
    Given the system sent the summary
    When more than 10 minutes pass without user response
    Then the system sends a one-time reminder: "Shall we confirm the entry?"
    And if another 10 minutes pass without response, the flow is automatically cancelled without saving anything

  Scenario: Summary with sensitive information (very high amount)
    Given the detected amount is unusually high (e.g., more than 10 times the historical average if it exists)
    When the system presents the summary
    Then it shows the amount with an attention indicator (e.g., "⚠️ Unusually high amount")
    And it requests explicit confirmation before allowing the save

**Definition of Done**

- The summary always includes the five minimum fields: concept, amount, currency, category, date.
- Fields with low confidence are visually differentiated in the summary message.
- The summary always shows the available action options (confirm / correct / cancel).
- The timeout and one-time reminder mechanism is implemented and tested.
- The summary format is consistent between WhatsApp and Telegram (markdown differences are allowed, but the information is identical).

**Story Points: 3**

> Generating the summary is relatively straightforward once the data is interpreted. The complexity lies in handling the timeout, the reminder, and the low-confidence visual markers. It does not involve new business logic, but rather presentation and state management.

**Dependencies**

- E1-US-03, E1-US-04, E1-US-05: complete expense interpretation.
- Conversational state mechanism with timeout support.
