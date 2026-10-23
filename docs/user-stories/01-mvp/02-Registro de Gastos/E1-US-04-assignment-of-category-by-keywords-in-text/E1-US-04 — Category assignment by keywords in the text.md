**User Story**

> As a system that interprets an expense, I want to automatically assign a category based on the keywords in the user's message, so the record is organized in the spreadsheet without the user having to specify the category manually.

---

> **Scope note:** This story only covers keyword-based assignment. Improvement through the user's history is addressed in E1-US-05 (Release 2). This separation is intentional: in the MVP there is no history, so the history-based mechanism is not applicable.


Acceptance criteria

Feature: Category assignment by keywords

  Scenario: Unambiguous keyword present in the message
    Given the system has a configured category vocabulary for the user
    And the message is "Pagué el almuerzo, 12 euros"
    When the system processes the text
    Then it assigns the category "Food" (or its equivalent in the user's spreadsheet)
    And includes the category in the summary for confirmation

  Scenario: Several possible keywords, all point to the same category
    Given the message is "Cargué combustible para el auto"
    When the system processes the text
    Then it assigns the category "Transport" with high confidence

  Scenario: Ambiguous keywords that may correspond to more than one category
    Given the message is "Compré algo en el kiosco"
    When the system processes the text
    And the ambiguity exceeds the configured confidence threshold
    Then the system proposes the most likely category
    And tells the user they can correct it before confirming

  Scenario: No relevant keyword is detected
    Given the message is "Gasté 50 euros hoy"
    When the system processes the text
    And it finds no match with any category
    Then it includes the category field as "No category" or equivalent in the user's spreadsheet
    And in the summary it shows the field empty with the option to complete it

  Scenario: The inferred category does not exist in the user's spreadsheet
    Given the system infers "Entertainment"
    But that category is not in the confirmed vocabulary of the user's spreadsheet
    When the system builds the summary
    Then it proposes the closest available category in the spreadsheet
    And points it out in the summary so the user can correct it

**Definition of Done**

- The system has a multi-language (Spanish) base category vocabulary that is extensible.
- The user's category vocabulary is taken from the spreadsheet linking process (E4-US-06).
- Keyword-based assignment covers at least the most common categories: food, transportation, housing, health, entertainment, services.
- When confidence is low or null, the category field remains visible in the summary with an indication of pending correction, but does not block the flow.
- Unit tests cover high confidence, low confidence, and no-match scenarios.

**Story Points: 5**

> Requires building the keyword-based classification engine and its integration with the user's spreadsheet vocabulary. It is not trivial because the vocabulary is heterogeneous per user, but it is not advanced ML in this story. Complexity lies in the edge cases (ambiguity, category not present in the user's spreadsheet).

**Dependencies**

- E4-US-06: confirmed category vocabulary from the user's spreadsheet.
- E1-US-03: amount detected (the interpretation flow must be in progress).
