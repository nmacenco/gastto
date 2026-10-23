**User story**

> As a user whose expense could not be saved correctly, I want to receive a clear notice telling me that the registration failed and what I must do to resolve it, so that I am not left with the false certainty that my data was saved when it was not.

---

**Acceptance criteria**

Feature: Save failure notification

  Scenario: Failure due to lost connection with the spreadsheet
    Given the user confirmed the expense registration
    And the system cannot reach the spreadsheet at that moment
    When the failure is detected
    Then the system notifies the user: "I could not save your expense. It seems there is a connection problem with your spreadsheet."
    And offers an option to retry: "Reply 'retry' to try again."
    And keeps the expense data in memory for the retry without losing it

  Scenario: Failure due to revoked spreadsheet permissions
    Given the user's access token to the spreadsheet has expired or been revoked
    When the system tries to save
    Then it notifies: "I do not have access to your spreadsheet. You need to authorize access again."
    And provides concrete instructions to re-authorize in one step, not a technical manual

  Scenario: Failure due to a modified spreadsheet structure (deleted column)
    Given the spreadsheet structure changed since the mapping was last configured
    When the system tries to save into a column that no longer exists
    Then it notifies: "Your spreadsheet structure changed. We need to update the configuration."
    And provides the command to start reconfiguration

  Scenario: Successful retry after a failure
    Given the user replied "retry" after a connection failure
    And the connection is available again
    When the system retries the save
    Then it saves the expense correctly
    And sends the standard E1-US-10 confirmation

  Scenario: Failed retry (the problem persists)
    Given the user replied "retry"
    And the problem persists
    When the second attempt also fails
    Then the system notifies that the operation could not be completed
    And offers to save the expense data in a message so the user can copy it manually as a last resort

**Definition of Done**

- The system never sends a successful confirmation message (E1-US-10) if the save was unsuccessful.
- Error messages distinguish at least three causes: network problem, revoked permissions, and modified spreadsheet structure.
- Expense data is kept in memory for at least 10 minutes after a failure to allow a retry.
- The user always has a clear resolution path; no error message ends in a dead end.
- Silent failure (save not completed without notifying the user) is explicitly covered by an integration test that verifies it cannot occur.

**Story Points:** 5

> The variety of failure causes, in-memory data retention for retry, and logic to distinguish error types add real complexity. The most critical case (silent failure) requires specific test coverage. This is a medium-to-high complexity error-handling story.

**Dependencies**

- E1-US-10: this is the alternative branch of that story.
- E4: spreadsheet access services must expose distinguishable error types (network, permissions, structure).
