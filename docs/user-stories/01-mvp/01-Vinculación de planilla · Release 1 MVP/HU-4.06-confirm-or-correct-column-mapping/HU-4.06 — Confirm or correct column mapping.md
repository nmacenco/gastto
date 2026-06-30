**As a** user, **I want** to be able to review the mapping proposed by the system and correct it from the chat if something is wrong, **so that** I can make sure expenses will be saved to the correct columns of my spreadsheet before starting to use it.

### Acceptance Criteria (Gherkin)


Scenario 1: User confirms the full mapping
  Given the system displayed the proposed mapping
  When the user replies "yes", "ok", "correct" or equivalent
  Then the system saves the final mapping
  And advances to category confirmation (HU-4.07)

Scenario 2: User corrects one field in natural language
  Given the system displayed the proposed mapping
  When the user says "no, the category is in column E" or similar
  Then the system updates only that field in the mapping
  And displays the full updated mapping again for new confirmation

Scenario 3: User corrects several fields
  Given the user needs to correct multiple fields
  When they correct them one by one by replying in natural language
  Then the system accumulates the changes and displays the updated mapping after each correction
  And confirms the final mapping when the user says "done" or "ok"

Scenario 4: User indicates a column that does not exist
  Given the user mentions a column (e.g.: "column Z")
  When that column does not exist in the spreadsheet
  Then the system reports that it could not find that column
  And displays the available columns for the user to choose from

Scenario 5: User abandons the correction flow
  Given the system is in the correction flow
  When the user does not reply for 30 minutes
  Then the system saves the state and, when resuming, asks whether to continue from where they left off

### Definition of Done

- [ ] Simple confirmation ("yes/ok") closes the mapping and advances.
- [ ] Per-field correction in natural language is implemented.
- [ ] The system displays the updated mapping after each correction.
- [ ] Validation of non-existent columns is implemented.
- [ ] State persists if the user abandons the flow halfway.
- [ ] QA confirmed corrections of 1 field, 3 fields, and invalid-column correction.

**Story Points: 3** _Rationale: The conversational logic for incremental correction has medium complexity. The main challenge is robustly parsing "the category is in column E". State persistence adds an extra test case but does not change the order of magnitude._

**Dependencies:** HU-4.05 (the mapping must have been proposed).
