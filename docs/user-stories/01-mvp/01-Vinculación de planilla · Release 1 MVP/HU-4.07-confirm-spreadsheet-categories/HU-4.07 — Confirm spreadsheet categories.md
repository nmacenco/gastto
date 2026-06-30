**As a** user, **I want** the system to recognize the categories I already use in my spreadsheet and allow me to confirm or adjust them, **so that** when I register an expense in natural language, the system uses my real categories instead of inventing names that do not exist in my spreadsheet.

### Acceptance Criteria (Gherkin)

Scenario 1: The system detects existing categories
  Given the column mapping is confirmed
  When the system reads the unique values from the category column
  Then it presents the list of categories found:
    "I found these categories in your spreadsheet: Food, Transportation, Services, Leisure.
     Should we use them as they are? You can reply 'yes' or add/remove any."

Scenario 2: The user confirms the categories without changes
  Given the system displayed the detected categories
  When the user replies "yes" or equivalent
  Then the system saves that category vocabulary
  And the onboarding is completed
  And the system sends the final welcome message ("All set, you can start registering")

Scenario 3: The user adds a missing category
  Given the system displayed the categories
  When the user says "Health is missing" or "add Education"
  Then the system adds that category to the vocabulary
  And shows the updated list for final confirmation

Scenario 4: The user corrects the name of a category
  Given the system displayed the categories
  When the user says "Leisure is actually called Entertainment"
  Then the system updates the name in the vocabulary
  And shows the updated list

Scenario 5: The category column is empty (new spreadsheet)
  Given the mapping points to a category column
  When that column has no values (spreadsheet without history)
  Then the system informs that no previous categories were found
  And offers a default suggested set (Food, Transportation, Services, Leisure, Health, Others)
  And the user can accept them, modify them, or dictate their own

### Definition of Done

- [ ] Reading unique values from the category column is implemented
- [ ] Simple confirmation advances to the end of onboarding
- [ ] Adding and correcting categories in natural language work
- [ ] The empty-column case has a default category set
- [ ] The category vocabulary is persisted and available for Epic 1
- [ ] The onboarding closing message is implemented
- [ ] QA confirmed spreadsheet with 10+ categories, with no categories, and with names in English

**Story Points: 3** _Justification: Reading unique values and matching natural language to add/correct are the main complexity. The default set reduces the risk of the empty case. No new technical branches compared to previous HUs._

**Dependencies:** HU-4.06 (confirmed mapping). Blocks HU-1.01 (Epic 1 MVP).
