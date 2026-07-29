**User Story**

> As a user who sent a message with incomplete or ambiguous information, I want the system to ask me for exactly the missing data in a single question, so I can complete the registration without having to resend the message from scratch.

---

**Acceptance Criteria**

Feature: Clarification request for ambiguous or missing data

  Scenario: A single piece of data is missing — currency
    Given the system processed the message "Pagué 30 por el café"
    And it could not determine the currency
    When the system needs clarification
    Then it sends exactly one question: "¿En qué moneda fue ese gasto?"
    And waits for the response before continuing

  Scenario: A single piece of data is missing — amount
    Given the system processed the message "Fui al supermercado"
    And it did not find any amount
    When the system needs clarification
    Then it sends exactly one question: "¿Cuánto gastaste?"
    And waits for the response before continuing

  Scenario: Ambiguity in the category
    Given the system processed the message "Compré algo en el kiosco, 8 euros"
    And the inferred category has low confidence
    When the system builds the summary
    Then it shows the proposed category as editable
    And does not ask an additional question; the correction is handled in the review step (E1-US-06)

  Scenario: Several pieces of data missing at once
    Given the message is "Gasté algo"
    And there is no amount, currency, or recognizable concept
    When the system processes the message
    Then it asks first for the most blocking piece of data (the amount)
    And waits for the response before asking for the next piece of data
    And does not bombard the user with multiple questions in the same message

  Scenario: The user does not answer the clarification and sends another expense
    Given the system was waiting for a clarification response
    When the user sends a new expense message without answering the previous question
    Then the system discards the previous flow (without saving it)
    And processes the new message as a new registration
    And briefly notifies that the previous registration was cancelled

  Scenario: The user answers the clarification with an invalid value
    Given the system asked "¿En qué moneda fue ese gasto?"
    When the user answers "no sé"
    Then the system reformulates the question with concrete options based on previously used currencies or the default currency

**Definition of Done**

- The system never asks more than one question per clarification message.
- The priority order for requesting missing data is defined and documented: amount > currency > category.
- The clarification flow has a configured timeout: if the user does not respond within X time and sends another expense message, the previous flow is cleanly cancelled.
- The current flow state (expense pending clarification) persists between messages from the same user.
- There is an integration test covering the "new expense interrupts previous clarification" scenario.

**Story Points: 5**

> Conversational state management (keeping the context of a partially completed expense between conversation turns) is the main complexity of this story. The questions themselves are simple, but context management, timeout, and interruption by a new expense require a persistent state solution.

**Dependencies**

- E1-US-03: amount and currency detection (it is the main trigger for clarifications).
- E1-US-04: category assignment (may generate a need for secondary clarification).
- Persistent conversational state mechanism per user.
