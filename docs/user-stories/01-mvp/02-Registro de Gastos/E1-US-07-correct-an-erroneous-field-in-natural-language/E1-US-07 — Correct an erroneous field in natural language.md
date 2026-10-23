**User Story**

> As a user reviewing the summary of an expense before saving it, I want to be able to correct any wrong field by responding in natural language, so I don't have to cancel the registration and start over because of a simple interpretation error.

---

**Acceptance Criteria**

Feature: Correcting summary fields in natural language

Scenario: Amount correction
Given the system showed a summary with amount = 12 EUR
When the user responds "no, it was 15"
Then the system updates the amount to 15 EUR
And presents the updated summary for a new confirmation

Scenario: Category correction
Given the system assigned category "Food"
When the user responds "put it in transport"
Then the system updates the category to "Transport" (or the equivalent in the user's spreadsheet)
And presents the updated summary

Scenario: Date correction
Given the system assumed date = today
When the user responds "it was yesterday"
Then the system updates the date to the previous day
And presents the updated summary

Scenario: Correction of several fields in a single message
Given the summary has amount = 12 and category = "Food"
When the user responds "no, it was 15 and it's transport"
Then the system updates both fields simultaneously
And presents the updated summary only once (not two separate messages)

Scenario: Correction with an invalid value
Given the summary shows amount = 12 EUR
When the user responds "change the amount to twenty billion"
Then the system detects the value as unusually high
And requests explicit confirmation before applying the change

Scenario: Uninterpretable correction message
Given the system showed the summary
When the user responds with something unrelated to any field (e.g., "uh-huh")
Then the system asks for clarification: "Did you want to confirm, correct, or cancel the registration?"
And does not modify any data or save anything

**Definition of Done**

- Amount, currency, category and date corrections are implemented and tested.
- The system can apply corrections of more than one field in a single user message.
- After each correction, an updated summary is presented; the correction cycle can be repeated until the user confirms or cancels.
- The maximum number of correction cycles is defined (recommended: 5 cycles) to avoid infinite loops; once exceeded, the system offers to cancel or confirm the current state.
- Corrections are not saved to the spreadsheet until the user explicitly confirms (E1-US-08).

**Story Points: 5**

> Interpreting a natural-language correction is similar to interpreting the original expense, but with the additional context of the previous summary. The ability to correct multiple fields in one message and the management of the correction cycle add incremental complexity on top of the already-built foundation.

**Dependencies**

- E1-US-06: the summary must exist and be in "pending confirmation" state.
- The interpretation engine from E1-US-03 and E1-US-04 is reusable to interpret correction messages.
