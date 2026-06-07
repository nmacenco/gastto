# Estimation Summary

## Total Hours

**20 hours**

## Hours per Task

| Task ID   | Title                                                       | Hours |
| --------- | ----------------------------------------------------------- | ----- |
| T-4.01-01 | Define OAuth service port and domain errors                 | 2     |
| T-4.01-02 | Implement DrizzleOAuthTokenRepository                       | 2     |
| T-4.01-03 | Implement Google Drive OAuth adapter                        | 3     |
| T-4.01-04 | Implement OneDrive OAuth adapter                            | 3     |
| T-4.01-05 | Implement InitiateCloudConnection use case                  | 2     |
| T-4.01-06 | Implement HandleOAuthCallback use case                      | 2     |
| T-4.01-07 | Implement cancel and reminder use cases                     | 2     |
| T-4.01-08 | Implement Fastify OAuth callback routes and reminder worker | 2     |
| T-4.01-09 | Integrate connection flow into message worker               | 2     |
| T-4.01-10 | Write tests and feature documentation                       | 2     |

## Coherence Check with Story Points

- **User Story Story Points:** 5 SP
- **Nominal range for 5 SP:** 10–20 hours
- **Total estimated:** 20 hours → **within range**

## Justification

The upper bound of the 5 SP range is justified by:

1. **Dual OAuth integration:** Two distinct providers (Google Drive and OneDrive) require separate adapters, separate client registrations, and separate error mappings. The HU itself notes this is the reason it is not a 3.
2. **Conversational state machine:** The flow must integrate with the existing BullMQ + FSM pipeline (`message.worker.ts`), adding coordination complexity compared to a simple REST API.
3. **Security requirements:** AES-256-GCM token encryption (ADR-007), CSRF state management in Redis, and secure callback handling add non-trivial infrastructure work.
4. **Reminder and cancellation logic:** The 10-minute reminder introduces delayed jobs and cleanup logic that a basic OAuth flow would not need.
5. **Cross-channel compatibility:** The use case output goes through `MessagingOutputPort`, ensuring the flow works for both Telegram and WhatsApp without channel-specific code.
