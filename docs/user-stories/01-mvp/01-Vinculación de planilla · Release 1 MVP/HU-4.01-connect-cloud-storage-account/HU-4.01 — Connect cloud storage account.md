**As** a user who wants to start using FinFlow, **I want** to connect my Google Drive or OneDrive account from the WhatsApp/Telegram conversation, **so that** the system can access my expense spreadsheet without me having to copy and paste data manually.

### Acceptance Criteria (Gherkin)

Scenario 1: Onboarding — user chooses provider
Given that the user starts FinFlow for the first time
When the system asks where their spreadsheet is
Then the system presents exactly two options: "Google Drive" and "OneDrive"
And the user can respond with the number or the name of the option

Scenario 2: Successful authorization with Google Drive
Given that the user chose "Google Drive"
When the system sends the OAuth authorization link
And the user completes the authorization in their browser
Then the system confirms in the chat "✅ Google Drive connected successfully"
And the flow continues towards file selection

Scenario 3: Successful authorization with OneDrive
Given that the user chose "OneDrive"
When the system sends the OAuth authorization link
And the user completes the authorization in their browser
Then the system confirms in the chat "✅ OneDrive connected successfully"
And the flow continues towards file selection

Scenario 4: User does not complete authorization
Given that the system sent the OAuth link
When 10 minutes have passed without the user completing it
Then the system sends a reminder with the link again
And the user can resume or type "cancel" to abort

Scenario 5: Authorization error
Given that the user tried to authorize
When the authorization fails for any technical reason
Then the system reports the error in simple language ("We couldn't connect your account")
And offers to retry or choose the other provider
And does not advance to the next step until there is a valid connection

### Definition of Done

- [ ] The OAuth link is generated and sent via chat without requiring any additional app
- [ ] The access token is stored securely (never visible to the user)
- [ ] The connection state persists between sessions
- [ ] The flow works in WhatsApp and Telegram
- [ ] The 10-minute reminder is implemented and tested
- [ ] Error handling exists for all authorization failure cases
- [ ] QA confirmed the full flow on both providers

**Story Points: 5** _Justification: The interface is purely conversational (no own UI), but the OAuth integration with two different providers, the state handling, and the secure token storage add real technical complexity. It is not a 3 because there are two integrations, not one._

**Dependencies:** None. It is the first HU of the onboarding flow.
