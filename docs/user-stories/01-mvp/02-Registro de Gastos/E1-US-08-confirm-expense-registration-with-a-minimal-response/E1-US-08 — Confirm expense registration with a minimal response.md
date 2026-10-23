**User Story**

> As a user who has reviewed my expense summary and is satisfied with the data, I want to be able to confirm the entry with a minimal response such as "yes", "ok", or "go ahead", so I can close the flow naturally without additional friction.

---

**Acceptance Criteria**

Feature: Confirming the entry with a minimal response

  Scenario: Confirmation with a standard affirmative word
    Given the system presented the expense summary
    When the user responds "sí", "si", "ok", "dale", "confirmo", "correcto", "listo", "va"
    Then the system starts the saving process
    And does not request any additional confirmation

  Scenario: Confirmation with a regional affirmative variant
    Given the system presented the summary
    When the user responds "bárbaro", "okey", "perfecto", "yep", "sip", or another colloquial variant
    Then the system recognizes it as a valid confirmation
    And starts the saving process

  Scenario: Ambiguous response that could be a confirmation or a correction
    Given the system presented the summary with category "Food"
    When the user responds "food yes, but not the amount"
    Then the system interprets it as a partial correction, not as a confirmation
    And updates only the amount by following the E1-US-07 flow

  Scenario: Response that is neither a confirmation, correction, nor cancellation
    Given the system presented the summary
    When the user responds with something uninterpretable (e.g., "🤔")
    Then the system responds: "¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?"
    And waits for a new response without modifying any data

**Definition of Done**

- The confirmation vocabulary is documented and covers regional Spanish variants (Spain, Argentina, Mexico, and Chile at minimum).
- A valid confirmation starts the saving process described in E1-US-10.
- Ambiguous responses are routed to the correction flow (E1-US-07) without saving incorrect data.
- Uninterpretable responses produce an orientation question, not an error.

**Story Points: 2**

> The confirmation vocabulary is fixed and limited. The only relevant complexity is distinguishing a confirmation from a partial correction, which is solved by reusing the interpretation engine already built. There is no significant new business logic.

**Dependencies**

- E1-US-06: the summary must be in a "pending confirmation" state.
- E1-US-07: the correction flow must be available for the ambiguity case.

