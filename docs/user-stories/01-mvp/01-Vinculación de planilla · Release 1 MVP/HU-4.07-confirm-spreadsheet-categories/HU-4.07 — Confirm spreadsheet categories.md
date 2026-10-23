

**As a** user, **I want** the system to recognize the categories I already use in my spreadsheet and allow me to confirm or adjust them, **so that** when I register an expense in natural language, the system uses my real categories and does not invent names that do not exist in my spreadsheet.

### Acceptance Criteria (Gherkin)


Scenario 1: The system detects existing categories
  Given that column mapping is confirmed
  When the system reads the unique values from the category column
  Then it presents the list of found categories:
    "I found these categories in your spreadsheet: Food, Transportation, Utilities, Leisure.
     Shall we use them as they are? You can reply 'yes' or add/remove any."

Scenario 2: The user confirms the categories without changes
  Given that the system displayed the detected categories
  When the user replies "yes" or equivalent
  Then the system stores that category vocabulary
  And the onboarding is completed
  And the system sends the final welcome message ("All set, you can start registering")

Scenario 3: The user adds a missing category
  Given that the system displayed the categories
  When the user says "Health is missing" or "add Education"
  Then the system adds that category to the vocabulary
  And shows the updated list for final confirmation

Scenario 4: The user corrects the name of a category
  Given that the system displayed the categories
  When the user says "Leisure is actually called Entertainment"
  Then the system updates the name in the vocabulary
  And shows the updated list

Scenario 5: The category column is empty (new spreadsheet)
  Given that the mapping points to a category column
  When that column has no values (spreadsheet with no history)
  Then the system informs that no previous categories were found
  And offers a default suggested set (Food, Transportation, Utilities, Leisure, Health, Others)
  And the user can accept them, modify them, or dictate their own



### Definition of Done

- [ ] Reading unique values from the category column is implemented
- [ ] Simple confirmation advances to onboarding closure
- [ ] Adding and correcting categories via natural language works
- [ ] Empty column case has a default category set
- [ ] Category vocabulary is persisted and available for Epic 1
- [ ] Onboarding closure message is implemented
- [ ] QA confirmed spreadsheet with 10+ categories, without categories, and with names in English

**Story Points: 3** _Justification: Reading unique values and natural language matching for adding/correcting are the main complexity. The default set reduces the risk of the empty case. No new technical ramifications compared to previous HUs._

**Dependencies:** HU-4.06 (mapping confirmed). Blocking for HU-1.01 (Epic 1 MVP).
