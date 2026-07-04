**As** a user who wants to start using FinFlow, **I want** to connect my Google Drive account from the WhatsApp/Telegram conversation, **so that** the system can access my expense spreadsheet without me having to copy and paste data manually.

### Acceptance Criteria (Gherkin)

Scenario 1: Onboarding — user chooses provider
Given that the user starts FinFlow for the first time
When the system asks where their spreadsheet is
Then the system presents "Google Drive" as the MVP-available option
And presents "OneDrive" marked as "coming soon" (out of MVP scope)
And the user can respond with the number or the name of the option

Scenario 2: Successful authorization with Google Drive
Given that the user chose "Google Drive"
When the system sends the OAuth authorization link
And the user completes the authorization in their browser
Then the system confirms in the chat "✅ Google Drive connected successfully"
And the flow continues towards file selection

Scenario 3: OneDrive — out of MVP scope (future work)
Given that the user chose "OneDrive"
When the system processes the choice
Then it informs the user in the chat that OneDrive will be available soon
And it does not start the OneDrive authorization flow (out of MVP)
And the user can choose Google Drive to continue onboarding

Scenario 4: User does not complete authorization
Given that the system sent the OAuth link
When 10 minutes have passed without the user completing it
Then the system sends a reminder with the link again
And it resends the reminder up to a maximum of 3 attempts
And upon exceeding the maximum, it suggests reconnecting the account or aborting onboarding
And the user can resume or type "cancel" to abort at any time

Scenario 5: User chooses an invalid provider
Given that the user replies with an unrecognized option
When the system cannot interpret the provider choice
Then it shows the available options again
And it does not advance until the user chooses a valid option

Scenario 6: Authorization error
Given that the user tried to authorize
When the authorization fails for any technical reason
Then the system reports the error in simple language ("We couldn't connect your account")
And offers to retry or choose Google Drive again
And does not advance to the next step until there is a valid connection

### Definition of Done

- [ ] The OAuth link is generated and sent via chat without requiring any additional app
- [ ] The access token is stored securely (never visible to the user)
- [ ] The connection state persists between sessions
- [ ] The flow works in WhatsApp and Telegram
- [ ] The 10-minute reminder is implemented, with a maximum of 3 retries, and tested
- [ ] Selecting OneDrive reports "coming soon" and does not start the authorization flow (out of MVP)
- [ ] Error handling exists for all authorization failure cases
- [ ] QA confirmed the full flow on Google Drive

**Story Points: 5** _Justification: The interface is purely conversational (no own UI), but the OAuth integration with Google Drive, state handling, secure token storage, and reminder retry control add real technical complexity._

**Dependencies:** None. It is the first HU of the onboarding flow.
