
**As a** system, **I want** to analyze the headers and data of the user's spreadsheet and suggest which column corresponds to each FinFlow field (date, amount, category, description, payment method), **so that** the user doesn't have to configure the mapping from scratch and the onboarding process is smooth.

### Acceptance Criteria (Gherkin)

Scenario 1: Clear headers — high-confidence mapping
  Given that the sheet has headers in row 1
  When the headers contain recognizable words (Date, Amount, Category, etc.)
  Then the system proposes the mapping in a clear message:
    "This is what I found in your spreadsheet:
     📅 Date → column A
     💰 Amount → column B
     🏷️ Category → column C
     📝 Description → column D
     Is this correct?"
  And the user can respond "yes" or correct it

Scenario 2: Ambiguous headers — low-confidence mapping
  Given that the headers are not unambiguous (e.g., "Col1", "Amount", "Type")
  When the system infers with lower certainty
  Then it presents the proposed mapping indicating its uncertainty:
    "I'm not sure about some fields, this is my best attempt: [mapping]"
  And the user can correct field by field

Scenario 3: No headers — row 1 contains data
  Given that row 1 appears to contain data (not headers)
  When the system detects this
  Then it informs the user: "It seems your spreadsheet doesn't have a header row"
  And asks which row the data starts at to assume that as the beginning

Scenario 4: FinFlow field with no equivalent column
  Given that the mapping is in progress
  When a FinFlow field (e.g., "payment method") has no equivalent column in the spreadsheet
  Then the system informs that it will omit that field when recording
  And the user can indicate a column manually or confirm the omission

Scenario 5: Spreadsheet with columns in a language other than Spanish
  Given that the headers are in another language (English, Portuguese)
  When the system analyzes them
  Then it recognizes them correctly (Date→Date, Amount→Amount, Category→Category)
  And proposes the mapping as in Scenario 1

### Definition of Done

- [ ]  The inference algorithm covers Spanish and English at minimum
- [ ]  The system distinguishes between high and low confidence mapping and communicates them differently
- [ ]  "No headers" detection is implemented
- [ ]  Unmapped fields have explicit handling (confirmed omission)
- [ ]  The mapping result is persisted for use during saving
- [ ]  QA has tested with at least 5 real spreadsheets with different structures

**Story Points: 5** _Justification: The inference algorithm requires non-trivial logic: string normalization, fuzzy matching, type detection by content of the first rows, and language handling. It is the most technically complex HU of the onboarding._

**Dependencies:** HU-4.04 (the spreadsheet must be read and validated).
