# Estimation Summary — HU-4.07

## Total estimated effort

**12 hours**

## Hours per task

| Task ID | Title | Hours |
|---|---|---|
| T-4.07-01 | Define domain model for category vocabulary | 1 |
| T-4.07-02 | Define application ports for category vocabulary persistence | 1 |
| T-4.07-03 | Implement spreadsheet unique category values reader | 1.5 |
| T-4.07-04 | Implement natural-language category edit parser | 2 |
| T-4.07-05 | Implement detect and present categories use case | 1.5 |
| T-4.07-06 | Implement confirm categories use case | 1 |
| T-4.07-07 | Implement add or correct category use case | 1 |
| T-4.07-08 | Implement Redis conversation state adapter for category confirmation flow | 1 |
| T-4.07-09 | Implement Telegram handler for category confirmation messages | 2 |
| T-4.07-10 | Add unit tests for category vocabulary use cases and parser | 1 |

## Coherence check with Story Points

- **User Story Story Points:** 3
- **Expected range for 3 SP:** 6–12 hours
- **Estimated total:** 12 hours

## Justification

The estimate sits at the upper bound of the 3 SP range. The main cost drivers are the natural-language category edit parser (2 hours), which must handle add/remove/rename intents in two languages, and the Telegram handler (2 hours), which routes multiple states and formats list/prompt/welcome messages. Reading unique values from the spreadsheet (1.5 hours) and the detect/present use case (1.5 hours) account for the empty-column default path and state persistence. The remaining hours cover domain modeling, port definition, Redis state adapter, confirm/correct use cases, and tests. Since the project scaffold already exists from earlier HUs, no bootstrap task is required.
