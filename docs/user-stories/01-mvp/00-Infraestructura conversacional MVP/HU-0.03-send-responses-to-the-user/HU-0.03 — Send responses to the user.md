**As** a system, **I want** to be able to send text messages back to the user via Telegram, **so that** all FinFlow responses reach the user's chat reliably.

### Acceptance Criteria (Gherkin)

Scenario 1: Successful message sending
Given that the system needs to respond to a user
When it calls the sending module with chat_id and text
Then the message appears in the user's chat in less than 2 seconds
And the system logs the send as successful

Scenario 2: Long message (more than 4096 characters)
Given that the system generates a response that exceeds Telegram's limit
When it attempts to send it
Then it automatically splits it into coherent fragments
And sends them in sequence to the same chat

Scenario 3: Send failure — automatic retry
Given that the system attempts to send a message
When the Telegram API returns a 5xx error
Then the system retries up to 3 times with backoff of 1, 2, and 4 seconds
And if all 3 retries fail, it logs the failure with chat_id and content

Scenario 4: Invalid chat_id or user blocked the bot
Given that the system attempts to send to a chat_id that is no longer valid
When the Telegram API returns a 403 or 400 error
Then the system logs the case without retrying
And does not generate an exception that affects other processes

### Definition of Done

- [x] The sending module is a reusable function/service for all epics
- [x] The 4096 character limit has automatic split handling
- [x] Exponential backoff retry is implemented (3 attempts)
- [x] 403/400 errors have differentiated handling (no retry)
- [x] All sends are logged with timestamp, chat_id and result
- [x] Unit tests cover successful send, long message, retry and permanent error

**Story Points: 2** _Justification: The Telegram send API is simple. The complexity lies in retry, long message splitting, and logging. There is no business logic, only communication infrastructure._

**Dependencies:** HU-0.01
