**As** a user with a connected storage account, **I want** to tell the system which spreadsheet file is mine from the chat, **so that** the system knows exactly where to write my expenses.

### Acceptance Criteria (Gherkin)

Scenario 1: The system searches and lists relevant files
Given the user has Google Drive or OneDrive connected
When the system asks which spreadsheet is theirs
Then the system searches the account for .xlsx, .ods, and Google Sheets files
And presents a numbered list with the found files (maximum 5)
And offers the option "None of these / search by name"

Scenario 2: The user chooses from the list
Given the system displayed the file list
When the user replies with the file number
Then the system confirms the selected file showing its full name
And asks which sheet contains the records (proceeds to HU-4.03)

Scenario 3: The user searches by name
Given the user chose "search by name" or the file did not appear
When the user types part of the file name
Then the system shows the matching results
And the user can choose from that refined list

Scenario 4: The user pastes a direct URL
Given the user knows the link to their spreadsheet
When they paste the URL in the chat
Then the system validates that it is a file they have access to
And confirms the file or informs if they do not have permissions

Scenario 5: No compatible files are found
Given the system searches for files
When it finds no .xlsx, .ods, or Google Sheets files
Then it informs the user clearly
And suggests verifying that the file is in the connected account
And offers the option to type the name manually

### Definition of Done

- [ ] Search works for Google Sheets, .xlsx, and .ods
- [ ] The list does not exceed 5 items (most recently modified)
- [ ] Selection by number and search by name are implemented
- [ ] Direct URL validation is implemented
- [ ] The selected file is persisted in the user's profile
- [ ] QA confirmed the flow on an empty account, an account with many files, and access by URL

**Story Points: 3** _Justification: File search is a standard Drive/OneDrive API call. Complexity lies in normalizing the three response formats, but conversational logic is linear. No complex branching._

**Dependencies:** HU-4.01 (account must be connected).
