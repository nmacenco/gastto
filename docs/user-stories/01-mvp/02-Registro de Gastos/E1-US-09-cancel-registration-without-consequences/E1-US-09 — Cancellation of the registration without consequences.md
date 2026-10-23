**User Story**

> As a user who is in the middle of an expense registration flow, I want to be able to cancel the process at any time with a simple response, so that I can exit the flow without any data being saved or side effects in my spreadsheet.

---

**Acceptance Criteria**


Feature: Cancel expense registration at any point in the flow

  Scenario: Explicit cancellation during the summary
    Given the system presented the expense summary
    When the user replies "no", "cancel", "cancel it", "do not register", "stop"
    Then the system discards all data for the expense in progress
    And confirms the cancellation: "Registration canceled. Nothing was saved."
    And the system is ready to receive a new message

  Scenario: Cancellation during a clarification request
    Given the system was waiting for a clarification from the user
    When the user replies "cancel"
    Then the system discards the expense in progress
    And confirms the cancellation
    And the system is ready to receive a new message

  Scenario: Cancellation with a global command ("stop", "exit")
    Given the user is at any point in the expense registration flow
    When the user sends "stop" or "exit"
    Then the system cancels the active flow, if one exists
    And responds confirming that nothing was saved

  Scenario: The user tries to cancel when there is no active flow
    Given there is no registration flow in progress
    When the user sends "cancel"
    Then the system responds in a friendly way that there is no pending registration
    And does not produce an error

  Scenario: Cancellation followed immediately by a new expense
    Given the user canceled a registration
    When the user immediately sends a new expense message
    Then the system processes the new message as a completely new registration
    And there are no traces of the previously canceled flow

**Definition of Done**

- Cancellation works in every flow state: during clarification, summary, and correction.
- When canceled, no data from the expense in progress remains persisted in any system layer.
- The "stop" command works as a global cancellation at any point.
- The system is left in a clean state and ready to receive a new message immediately after cancellation.
- An integration test verifies that cancellation leaves no orphaned data in the system.

**Story Points: 3**

> Cancellation appears simple but requires the system to correctly roll back conversational state at any point in the flow. Covering all possible states and cleaning up data are the main sources of complexity.

**Dependencies**

- A conversational-state mechanism with support for completely cleaning the active context.
- E1-US-05, E1-US-06, E1-US-07: the flow states where cancellation can be triggered must be defined.
