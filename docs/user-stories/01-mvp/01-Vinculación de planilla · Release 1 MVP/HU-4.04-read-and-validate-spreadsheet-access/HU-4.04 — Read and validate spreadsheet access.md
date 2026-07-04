

**As a** system, **I want** to read the content of the selected sheet and validate that I have write permissions, **so that** I can operate on it without the user discovering a permissions error only when trying to save their first expense.

### Acceptance Criteria (Gherkin)


Scenario 1: Read and write access confirmed
  Given that the user selected a file and sheet
  When the system attempts to read the first 10 rows of the sheet
  Then the read is successful
  And the system also verifies it has write permission
  And it proceeds to mapping analysis (HU-4.05) without notifying the user (transparent flow)

Scenario 2: System has read-only, not write access
  Given that the system successfully reads the sheet
  When it attempts to verify write permissions and does not have them
  Then it informs the user: "I can see your spreadsheet but I don't have permission to write to it"
  And it explains how to change permissions in Google Drive / OneDrive
  And it does not proceed until confirming it has write access

Scenario 3: The sheet is empty
  Given that the system accesses the sheet
  When it detects that it has no content
  Then it informs the user that the sheet appears to be empty
  And it clarifies that creating the structure from scratch is not available in the MVP
  And it offers the user to choose another sheet or abort onboarding
  And if the user chooses another sheet, it returns to sheet selection (HU-4.03)
  And if the user aborts, the flow stops without advancing to mapping

Scenario 4: Access error (network, expired token)
  Given that the system attempts to access the sheet
  When it fails due to a technical reason
  Then it reports the type of problem in plain language
  And it offers to automatically retry once
  And if it persists, it suggests reconnecting the account (returns to HU-4.01)


### Definition of Done

- [ ] Reading the first 10 rows is implemented for Google Sheets and Excel Online
- [ ] Write permission verification is implemented
- [ ] Empty sheet case has explicit handling
- [ ] Network and expired token errors have handling and automatic retry
- [ ] This HU is transparent to the user when everything works (no message generated)
- [ ] QA confirmed all 4 scenarios including simulated expired token

**Story Points: 3** _Justification: Technically requires permission handling across two distinct APIs and robust error management. The conversational interface is minimal (only appears on error). Retry and empty-sheet detection add non-trivial test cases._

**Dependencies:** HU-4.03 (selected sheet).
