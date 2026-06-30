# Estimation Summary — HU-4.06

## Total estimated effort

**12 hours**

## Hours per task

| Task ID | Title | Hours |
|---|---|---|
| T-4.06-01 | Define domain model for column mapping confirmation and correction state | 1 |
| T-4.06-02 | Define application ports for mapping persistence and column listing | 1 |
| T-4.06-03 | Implement confirm column mapping use case | 1.5 |
| T-4.06-04 | Implement natural-language correction parser | 2 |
| T-4.06-05 | Implement correct single mapping field use case with column validation | 2 |
| T-4.06-06 | Implement Redis conversation state for mapping correction flow | 1.5 |
| T-4.06-07 | Implement Telegram handler for confirmation and correction messages | 2 |
| T-4.06-08 | Add unit tests for use cases and validation logic | 1 |

## Coherence check with Story Points

- **User Story Story Points:** 3
- **Expected range for 3 SP:** 6–12 hours
- **Estimated total:** 12 hours

## Justification

The estimate sits at the upper bound of the 3 SP range. The two main cost drivers are the natural-language correction parser (2 hours) and the combined correction/validation use case (2 hours), which must handle incremental changes, column existence checks, and user feedback. State persistence via Redis adds 1.5 hours, and the Telegram interface adds 2 hours because it must route confirmations, corrections, invalid-column responses, and resume prompts. The remaining hours cover domain modeling, port definition, and tests.
