**As** a development team, **I want** to register a bot in Telegram and configure the webhook that receives incoming messages, **so that** FinFlow can receive and process user messages in real time.

### Acceptance Criteria (Gherkin)

Scenario 1: Bot registered and active
Given the team executes the registration process with BotFather
When the registration is complete
Then the bot has a public name, username, and valid API token
And the bot responds to the /start command with a basic welcome message

Scenario 2: Webhook configured and verified
Given the FinFlow server has a public HTTPS endpoint
When the webhook is configured with the Telegram API
Then Telegram confirms the webhook with status "ok"
And a message sent to the bot arrives at the endpoint in less than 2 seconds

Scenario 3: Webhook fails and Telegram retries
Given the endpoint is temporarily unavailable
When Telegram attempts to deliver a message
Then Telegram retries with exponential backoff according to its native behavior
And when the endpoint recovers, the message arrives correctly

Scenario 4: Message origin validation
Given the endpoint receives a call
When the call does not come from Telegram (invalid token or unexpected IP)
Then the endpoint rejects the call with 403
And does not process the message content

### Definition of Done

- [ ] Bot registered in Telegram with the product's definitive name and username
- [ ] Token stored in vault/secrets manager, never in code
- [ ] Webhook configured pointing to the production endpoint with HTTPS
- [ ] Source validation implemented (token verification in header)
- [ ] Basic welcome message on /start functional in production
- [ ] Webhook latency < 2 seconds verified with real test

**Story Points: 2** _Justification: The registration process with BotFather is trivial. The real complexity lies in configuring the webhook with HTTPS and source validation, but these are well-documented tasks without design ambiguity._

**Dependencies:** None. First US of the project.
