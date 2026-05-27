**As** a system, **I want** to maintain the conversation state of each user between messages, **so that** FinFlow knows what step of the flow each user is in and can respond with the correct context (e.g., if they are in onboarding, in the registration flow, or in the query flow).

Acceptance Criteria (Gherkin)

Scenario 1: New user — initial state
Given a user writes to the bot for the first time
When the system receives their message
Then it creates a state record for that user_id with state `ONBOARDING_START`
And persists it in storage

Scenario 2: Correct state transition
Given a user is in state `ONBOARDING_DRIVE`
When they complete the expected action in that state
Then the system updates their state to the next step of the flow
And the next user message is processed with the new context

Scenario 3: Persistence between sessions
Given a user was in state `ONBOARDING_MAPPING` yesterday
When they write again today
Then the system recovers their persisted state
And resumes the flow from where they left off, not from the beginning

Scenario 4: Corrupted or unrecognized state
Given the system recovers a state that does not exist in the valid states map
When it tries to process it
Then it logs the anomaly
And resets the user to a safe recovery state
And informs them: "Something went wrong. Let's start over."

Scenario 5: Active session timeout
Given a user started a flow (e.g., expense registration)
When they do not send any message in 30 minutes
Then the system marks that flow as interrupted
And when the user returns, it asks whether they want to continue or start over

### Definition of Done

- [ ] State is persisted per user_id in durable storage (not in-memory)
- [ ] State transitions are defined in an explicit map (no ad-hoc logic)
- [ ] Recovery between sessions works correctly
- [ ] Corrupted state has safe recovery handling
- [ ] 30-minute timeout is implemented
- [ ] State structure is extensible to support Épica 1 and following without refactor
- [ ] Integration tests cover the 5 scenarios

**Story Points: 5** _Justification: It is the most critical and cross-cutting infrastructure piece of the system. A poor design here generates technical debt that affects all epics. The state map, durable persistence, and handling of timeouts and corrupted states require deliberate design, not just code._

**Dependencies:** HU-0.02 and HU-0.03 (needs to be able to receive and send to be testable end-to-end)
