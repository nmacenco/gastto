**User story**

> As a user who has just registered an expense and realizes they made a mistake, I want to undo it with a simple command from the chat, so that the record is removed from my spreadsheet without having to open it manually.

---

**Acceptance criteria**

Feature: Undo the last registered expense

  Scenario: Undo immediately after saving
    Given that the system has just confirmed that an expense was saved
    When the user sends "deshacer", "undo", or "borrar el último"
    Then the system deletes the record from the spreadsheet
    And confirms: "Done, the last record ([concept], [amount]) was deleted."

  Scenario: Undo after time has passed (a new message was sent afterwards)
    Given that the user registered an expense several minutes ago
    And has since sent other non-expense messages to the bot
    When the user sends "deshacer"
    Then the system confirms which expense is the latest registered expense
    And asks for explicit confirmation before deleting it: "Should I delete '[concept], [amount]' registered at [time]?"

  Scenario: Undo when two or more expenses have been registered afterwards
    Given that the user has multiple registered expenses
    When the user sends "deshacer"
    Then the system offers to undo only the most recent one
    And does not offer to undo multiple records in this story (that is backlog)

  Scenario: There is no registered expense to undo
    Given that the user has no records in the current session or the spreadsheet is empty
    When the user sends "deshacer"
    Then the system responds: "I could not find a recent record to undo."
    And does not perform any action on the spreadsheet

  Scenario: The system cannot delete the record (spreadsheet write error)
    Given that the user requested an undo
    And the system cannot modify the spreadsheet at that time
    When it attempts the deletion
    Then it notifies the user of the failure with clear instructions
    And does not leave the system in an inconsistent state

**Definition of Done**

- "Undo" deletes the last spreadsheet record and confirms the operation with the concept and amount of the deleted record.
- This story is exclusively limited to the latest record. Multiple consecutive "undo" operations are not included in this scope.
- When later messages or expenses exist, the system requests explicit confirmation before deleting to avoid accidental errors.
- The undo operation writes an internal log entry (minimum audit: what was deleted, when, and by which user).
- A deletion failure produces a useful notification, not a technical error exposed to the user.

**Story Points: 5**

> Requires the system to retain a reference to each user's last saved record (row ID plus sheet) and the spreadsheet-writing service to support deletion. Explicit confirmation when intervening messages exist and failure handling add complexity beyond the happy path.

**Dependencies**

- E1-US-10: the system must save the reference to the last successfully saved record per user.
- E4: the spreadsheet-writing service must support deletion by reference.
