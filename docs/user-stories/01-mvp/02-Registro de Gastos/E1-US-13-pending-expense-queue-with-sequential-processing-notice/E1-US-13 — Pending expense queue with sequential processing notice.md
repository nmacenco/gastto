### User story

As a user who sends several expenses in separate, rapid messages, I want the system to queue them in order and tell me how many are pending after each confirmation, so that I can register all of them without losing any or having to wait between messages.

> **Scope note:** This story exclusively covers expenses sent as separate text messages in quick succession. Registering multiple expenses in a single message is a different use case covered in Release 2. The queue limit is 2 pending expenses in addition to the active one (3 total). If that limit is exceeded, the system blocks new incoming expenses and notifies the user.

---

### Acceptance criteria

```gherkin
Feature: Pending expense queue with sequential processing notice

  Background:
    Given the user has FinFlow active on their messaging channel
    And the user's spreadsheet is linked and configured
    And there is no active registration flow at the start

  # ─── HAPPY PATH ─────────────────────────────────────────────────────────

  Scenario: The user sends three expenses in separate messages before confirming the first
    Given the system has no queued or active expense
    When the user sends "I spent 10 pesos on food"
    Then the system acknowledges receipt in ≤ 1 second
    And processes the first expense and presents its summary
    And the user's state becomes EXPENSE_REVIEW

    When the user sends "3 pesos on transport" before confirming the first
    Then the system acknowledges receipt in ≤ 1 second
    And queues the second expense without interrupting the active flow
    And does not present the second expense summary yet

    When the user sends "5 on an ice cream" before confirming the first
    Then the system acknowledges receipt in ≤ 1 second
    And queues the third expense
    And the queue now contains 2 pending expenses (the allowed maximum)

    When the user confirms the first expense with "yes"
    Then the system saves the first expense and sends the location confirmation
    And then sends the queue notice:
      """
      You have 2 pending expenses. Let's do the next one:
      """
    And immediately presents the second expense summary for review
    And the user's state becomes EXPENSE_REVIEW for the second expense

  Scenario: The user cancels the active expense with pending expenses in the queue
    Given the user has 1 expense under review and 1 expense in the queue
    When the user cancels the active expense with "cancel"
    Then the system discards the active expense without saving it
    And sends:
      """
      Registration cancelled. You have 1 pending expense. Let's do the next one:
      """
    And presents the summary of the expense that was in the queue
    And the user's state becomes EXPENSE_REVIEW for that expense

  Scenario: The user processes and confirms all queued expenses sequentially
    Given the user has 1 expense under review and 2 expenses in the queue
    When the user confirms the active expense
    Then the system saves the expense and reports its location
    And presents the next queued expense with the corresponding notice
    When the user confirms that expense
    Then the system saves the expense and reports its location
    And presents the last queued expense
    When the user confirms that expense
    Then the system saves the expense and reports its location
    And sends a closing message:
      """
      All set! I registered the 3 expenses. You have no more pending expenses.
      """
    And the user's state returns to IDLE

  # ─── QUEUE LIMIT ────────────────────────────────────────────────────────

  Scenario: The user tries to send a fourth expense when the queue is full
    Given the user has 1 expense under review and 2 expenses in the queue (limit reached)
    When the user sends a new expense message
    Then the system does NOT queue the new message
    And replies:
      """
      You already have 3 expenses in progress. Confirm or cancel the current one before adding more.
      """
    And the new expense message is discarded without being saved
    And the active flow is not interrupted

  Scenario: The user sends a fifth expense after the queue has room
    Given the user had a full queue and has just confirmed the active expense
    And the queue now has 1 pending expense (below the limit)
    When the user sends a new expense message
    Then the system queues it normally
    And acknowledges receipt normally

  # ─── NON-FINANCIAL MESSAGES WITH AN ACTIVE QUEUE ─────────────────────────

  Scenario: The user sends a non-financial message while expenses are queued
    Given the user has 1 expense under review and 1 expense in the queue
    And the system is waiting for confirmation of the active expense
    When the user sends "thanks"
    Then the system does not interpret the message as a confirmation or correction
    And replies by reminding the user of the current state:
      """
      You still have one expense awaiting confirmation and 1 more in the queue.
      Shall we confirm, correct, or cancel the current one?
      """
    And does not change the queue or the active expense

  Scenario: The user repeats a non-financial message a second consecutive time
    Given the system has already sent the pending-expenses notice once
    When the user sends another non-financial message without responding to the notice
    Then the system repeats the notice in the same format
    And does not escalate to any other behavior or cancel the queue

  # ─── TIMEOUT WITH AN ACTIVE QUEUE ────────────────────────────────────────

  Scenario: The user does not respond to the active expense and expenses are queued
    Given the user has 1 expense under review and 1 expense in the queue
    When 10 minutes pass without a user response
    Then the system sends the standard E1-US-06 reminder:
      """
      Shall we confirm the registration as it is?
      """
    And appends to the same message:
      """
      (You also have 1 more expense waiting in the queue.)
      """

  Scenario: The user does not respond after the reminder while a queue is active
    Given the system has already sent the timeout reminder mentioning the queue
    When another 10 minutes pass without a response
    Then the system cancels the active expense without saving it
    And automatically presents the next queued expense with the message:
      """
      The previous registration expired without confirmation and was cancelled.
      Let's do the next pending expense:
      """
    And the user's state becomes EXPENSE_REVIEW for that expense

  # ─── UNDO WITH AN ACTIVE QUEUE ───────────────────────────────────────────

  Scenario: The user requests undo while expenses are queued
    Given the user has just confirmed an expense and has 1 more in the queue
    And the system has already presented the next expense summary
    When the user sends "undo"
    Then the system interprets "undo" as referring to the last saved expense
    And pauses presentation of the queued expense
    And runs the standard E1-US-11 flow for the last saved expense
    And resumes presentation of the queued expense once undo is complete
```

---

### Definition of Done

- The system queues incoming expense messages when the user is in `EXPENSE_REVIEW`, `EXPENSE_CLARIFYING`, or `EXPENSE_CORRECTING`, without interrupting the active flow.
- The limit of 2 queued expenses (3 total including the active expense) is implemented and the blocking message is tested.
- The queue notice always appears after the save-confirmation or cancellation message, never before or during the active flow.
- Non-financial messages with an active queue produce the reminder notice; the behavior is identical on the second and subsequent attempts.
- A 10-minute timeout with an active queue cancels the active expense and automatically advances to the next one without losing queued expenses.
- Undo pauses the queue, runs the E1-US-11 flow, and resumes the queue when it completes.
- Expenses discarded because of the queue limit leave no trace in any system layer.
- The closing message ("I registered N expenses") is sent only when the queue is empty and the last expense was confirmed.
- An integration test covers the complete flow of 3 queued expenses processed sequentially through `IDLE`.
- Behavior is consistent on WhatsApp and Telegram.

---

### Story Points: 8

The complexity is not in any individual piece, but in the **intersection of the queue with all existing flows**: timeout, cancellation, correction, undo, and non-financial messages. Each existing flow must understand that a queue can be active and behave consistently. That makes this story the most cross-cutting one in the MVP so far. It is assigned 8 (rather than 5+5) because it is one conversational-infrastructure story that does not make sense to split: its value is the consistency of the complete behavior, not its individual pieces.

---

### Dependencies

- **E1-US-01 through E1-US-12:** all existing flows are dependencies because this story changes the behavior of each one when a queue is active.
- **HU-0.04** (conversation state management): the FSM must be extended with `EXPENSE_QUEUE_ACTIVE` as a cross-cutting flag, or the state model must support a per-user queue as a top-level field. This implementation decision must be made before this story enters a sprint; it is the main technical risk.
- **E1-US-11** (undo): the undo + queue interaction must be explicitly coordinated with the team implementing E1-US-11.

---

### Design note for the architecture team

The current conversation state models one active flow per user. This story introduces **implicit concurrency** (multiple expenses at different stages of the same flow) within one user's model. The cleanest solution is **not to change the main FSM**, but to add a separate queue structure to the user's profile:

```
user_state: {
  active_flow: { state: EXPENSE_REVIEW, data: {...} },
  expense_queue: [
    { received_at: timestamp, raw_message: "3 pesos on transport" },
    { received_at: timestamp, raw_message: "5 on an ice cream" }
  ]
}
```

When `active_flow` is resolved (confirmation, cancellation, or timeout), the orchestrator checks `expense_queue`, removes the first item in arrival order, and starts a new `active_flow` with it. The queue never processes two expenses in parallel.
