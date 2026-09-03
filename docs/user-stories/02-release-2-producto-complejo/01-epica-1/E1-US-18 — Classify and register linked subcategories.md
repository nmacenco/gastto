# E1-US-18 - Classify and register linked subcategories

**Release:** Release 2  
**Story Points:** 8

## User story

> As a user with a configured category hierarchy, I want Gastto to classify, display, let me correct, and save a subcategory linked to its parent category, so that I can record the correct detail without losing traceability or compatibility with earlier expenses.

## Acceptance criteria

```gherkin
Feature: Classify and register linked subcategories

  Scenario: Classification within the parent category
    Given the user has configured "Food > Restaurant" and "Leisure > Restaurant"
    And the message describes "dinner at a restaurant"
    When the system classifies the expense
    Then it resolves the parent category first
    And it searches only among the active subcategories of that parent
    And it returns stable identifiers and names for the selected category and subcategory

  Scenario: Valid category without an applicable subcategory
    Given the system resolved an active category
    And no subcategory under that parent is a valid match
    When it prepares the expense for review
    Then it preserves the resolved category
    And it leaves the subcategory empty
    And it does not use a subcategory that belongs to another parent

  Scenario: Unresolved parent category
    Given the system cannot resolve a valid category
    When it evaluates subcategories
    Then it does not select a subcategory
    And it preserves independent confidence statuses for category and subcategory

  Scenario: Review with hierarchy enabled
    Given the user has a mapped subcategory column or configured subcategories
    When the system presents the expense summary
    Then it displays the selected category and subcategory with their confidence levels
    And it permits confirmation of a category without a subcategory
    But for a user without hierarchy support enabled
    Then it preserves the existing summary without adding a subcategory field

  Scenario: Correct category and subcategory together
    Given the summary contains "Utilities > Internet"
    When the user replies "it is Leisure, subcategory Streaming"
    Then the system resolves both values as one correction
    And it applies "Leisure > Streaming" only if the relationship is active
    And it presents the updated summary exactly once

  Scenario: Change category without a valid replacement subcategory
    Given the summary contains "Food > Restaurant"
    When the user changes the category to "Transportation" without specifying another subcategory
    Then the system changes the category
    And it clears the previous subcategory because it does not belong to the new parent
    And it keeps the expense pending confirmation

  Scenario: Correct to a subcategory under another parent
    Given "Streaming" belongs to "Leisure" and the selected category is "Utilities"
    When the user tries to change only the subcategory to "Streaming"
    Then the system rejects the complete correction
    And it lists the active subcategories allowed for "Utilities"
    And it does not modify the persisted summary

  Scenario: Save with a mapped subcategory column
    Given the user confirmed an expense with a valid category and subcategory
    And a confirmed mapping exists for `subcategoria`
    When the spreadsheet write completes successfully
    Then it writes the subcategory name to the mapped column
    And it persists the category and subcategory identifiers and snapshots locally
    And it sends the existing save confirmation

  Scenario: Save without a mapped subcategory column
    Given the user confirmed an expense and no mapping exists for `subcategoria`
    When the system writes the expense
    Then it does not attempt to write a subcategory column
    And it preserves the current spreadsheet behavior
    And it may persist the local reference and snapshot when a hierarchy is configured

  Scenario: External write fails
    Given the user confirmed an expense with a subcategory
    When the spreadsheet write fails
    Then it does not persist a local expense record
    And it does not send a success confirmation
    And it retains the category, subcategory, identifiers, and snapshots for the retry flow

  Scenario: Retry saving
    Given an expense with a subcategory remains pending after a recoverable error
    When the user requests a retry
    Then the system reuses the reviewed data without repeating natural-language interpretation
    And it applies the same atomic write and persistence rules

  Scenario: Stable audit after vocabulary changes
    Given an expense was saved with category and subcategory references and snapshots
    When a vocabulary entry is later renamed or deactivated
    Then history preserves the text captured at save time
    And references may become null if the configured entry is deleted
    And no fuzzy or destructive backfill is performed

  Scenario: Legacy conversational payload
    Given a review, correction, queue, or retry JSONB payload has no subcategory fields
    When the system loads it
    Then it accepts the payload as an expense without a subcategory
    And it preserves the existing flow through confirmation, saving, cancellation, or undo
```

## Definition of Done

- [ ] The structured selection contains stable identifiers, names, and independent category and subcategory statuses.
- [ ] The category is resolved first, and every subcategory match is isolated to the selected active parent.
- [ ] A category may exist without a subcategory; an unresolved category never produces a subcategory.
- [ ] The summary displays the subcategory only when the hierarchy is enabled and preserves current output for legacy users.
- [ ] Combined corrections are atomic; changing a parent clears an invalid child, and a child under another parent is rejected without mutating state.
- [ ] The subcategory is written externally only when the optional mapping exists, and the local record is persisted only after a successful write.
- [ ] Retries and the queue preserve reviewed fields without repeating NLP; cancellation and undo retain their existing guarantees.
- [ ] Saved records retain nullable references and text snapshots; renaming, deactivating, or deleting vocabulary does not rewrite history.
- [ ] JSONB payloads without subcategory fields validate and normalize as legacy payloads without a subcategory.
- [ ] Unit, adapter, repository, integration, and end-to-end tests cover spreadsheets with and without subcategories, including append and persistence failures.
- [ ] No HTTP route or FSM state is added.

## Dependencies

- **HU-4.08:** The hierarchy must be detected, managed, and confirmed.
- **HU-4.07:** A confirmed category vocabulary must exist.
- **E1-US-04:** Classification against the user's actual vocabulary.
- **E1-US-06 and E1-US-07:** Reviewable summaries and natural-language correction.
- **E1-US-08 and E1-US-10:** Minimal confirmation and post-save confirmation.
- **E1-US-12 and E1-US-13:** Recoverable failures, retries, and the pending queue must preserve the new fields.
