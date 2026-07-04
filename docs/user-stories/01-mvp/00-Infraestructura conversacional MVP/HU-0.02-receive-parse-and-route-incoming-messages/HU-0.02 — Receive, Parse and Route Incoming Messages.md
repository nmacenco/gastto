**As** a system, **I want** to receive the Telegram payload, extract the relevant message data, and route it to the correct module, **so that** each message reaches the appropriate handler regardless of its type or content.

### Acceptance Criteria (Gherkin)

Scenario 1: Incoming text message
Given a user sends a text message to the bot
When the webhook receives the payload
Then the system extracts: chat_id, user_id, message text and timestamp
And routes the message to the text handler with those normalized data

Scenario 2: Unsupported message type in MVP (audio, image, sticker)
Given a user sends an unsupported message type
When the webhook receives the payload
Then the system identifies the type as unsupported
And responds to the user: "For now I only process text messages. Tell me about your expense by typing it."
And does not generate any internal error or exception

Scenario 3: Malformed or unexpected payload
Given the webhook receives a payload that does not match the expected schema
When the parser tries to process it
Then the system logs the error with the full payload
And responds 200 to Telegram (to avoid infinite retries)
And does not propagate the exception to the rest of the system

Scenario 4: Multiple messages in rapid succession from the same user
Given a user sends 3 messages in less than 2 seconds
When the system receives them
Then it processes them in arrival order without losing any
And each one receives its corresponding response

### Definition of Done

- [ ] The parser reliably extracts chat_id, user_id, text and timestamp
- [ ] Routing by message type is implemented (text / unsupported / unknown)
- [ ] Unsupported types return a friendly message to the user
- [ ] Malformed payloads are logged and respond 200 without exception
- [ ] Ordered processing is guaranteed (queue or synchronous processing)
- [ ] Unit tests cover all 4 scenarios

**Story Points: 3** _Justification: Telegram payload parsing is well documented, but robust routing with error handling, unsupported types, and processing order requires careful design. It is the piece on top of which everything else is built._

**Dependencies:** HU-0.01
