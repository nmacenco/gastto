**As** a user with the file already identified, **I want** to tell the system which sheet contains my expense records, **so that** the system does not write to the wrong sheet or confuse summary tabs with data tabs.

### Acceptance Criteria (Gherkin)

Scenario 1: Single-sheet file
Given the selected file has a single sheet
When the system detects it
Then it automatically confirms that sheet without asking
And informs the user: "I only found one sheet: '[name]'. I'll use it for recording."
And advances to structure analysis (HU-4.04)

Scenario 2: File with multiple sheets — user chooses
Given the file has more than one sheet
When the system lists the sheet names
Then the user can reply with the number or the name of the sheet
And the system confirms the selection before advancing

Scenario 3: The user does not know which sheet is correct
Given the system showed the list of sheets
When the user replies "I don't know" or a similar variant
Then the system briefly describes the content of each sheet (first row as header)
And the user chooses with that additional information

Scenario 4: The user writes the sheet name
Given the user types the sheet name directly
When the name matches exactly or with minor variation (uppercase/accents)
Then the system confirms the selected sheet
And advances to analysis

Scenario 5: Sheet name not found
Given the user types a name that does not exist
When the system finds no match
Then it informs "I couldn't find a sheet with that name" and shows the list again

### Definition of Done

- [ ] The single-sheet case is automated (no question to the user)
- [ ] The sheet list shows real names from the file
- [ ] The header-based description is implemented for the doubt case
- [ ] Selection by number and by name are implemented
- [ ] The selected sheet is persisted in the user's profile
- [ ] QA confirmed the scenarios with 1 sheet, 3 sheets, and names with accents/spaces

**Story Points: 2** _Justification: The logic is simple; it is an API call to list sheets and a string match. The biggest risk is name normalization (accents, uppercase), which is manageable. The single-sheet case removes the interaction._

**Dependencies:** HU-4.02 (the file must be selected).
