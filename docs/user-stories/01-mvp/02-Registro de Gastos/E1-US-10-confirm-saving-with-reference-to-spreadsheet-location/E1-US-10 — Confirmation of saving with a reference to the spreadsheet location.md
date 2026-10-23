**User story**

> As a user who confirmed an expense registration, I want to receive a confirmation message that indicates exactly where the data was saved in my spreadsheet (sheet and row), so that I can be certain that the process completed successfully and verify it if I wish.

---

**Acceptance criteria**

Feature: Confirmation of saving with a location reference

  Scenario: Successful save with a single-sheet spreadsheet
    Given that the user confirmed the registration of an expense
    And that saving to the spreadsheet was successful
    When the system sends the confirmation
    Then the message includes the concept, amount, and currency of the saved expense
    And it indicates the sheet and row where it was registered (e.g., "Saved in 'Expenses', row 47")

  Scenario: Successful save with a multi-sheet spreadsheet
    Given that the user's spreadsheet has multiple sheets and the expense belongs to a specific one
    When the system sends the confirmation
    Then it indicates the correct sheet and row number
    And the format is readable in the chat

  Scenario: Successful save but the row number cannot be determined
    Given that saving was successful
    But the system cannot determine the exact row number
    When it sends the confirmation
    Then it indicates the sheet where it was saved
    And it omits the row number without generating an error message

  Scenario: Saving fails
    Given that the system attempted to save the expense
    And saving fails for any reason
    When the system detects the failure
    Then it does NOT send the successful confirmation message
    And it handles the failure according to the E1-US-12 flow

**Definition of Done**

- The successful confirmation message always includes the destination sheet and the row number when they are available.
- The confirmation message is never sent if the save was not confirmed by the destination spreadsheet.
- The time between the user's confirmation and the successful-save message is ≤ 3 seconds under normal conditions.
- The failure flow (E1-US-12) is integrated as an alternative branch of this story.

**Story Points: 3**

> Saving itself depends on Epic 4, but the confirmation message with a location reference requires the spreadsheet writing service to return location metadata (sheet + row) as part of the success response. Integrating that metadata into the message and handling the case where it is unavailable add moderate complexity.

**Dependencies**

- E4: the spreadsheet writing service must return location metadata (sheet, row) as part of the success response.
- E1-US-08: the user confirmation must have triggered the saving process.
- E1-US-12: the failure flow must be defined as an alternative branch.
