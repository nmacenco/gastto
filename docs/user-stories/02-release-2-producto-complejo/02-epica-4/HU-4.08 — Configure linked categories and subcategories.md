# HU-4.08 - Configure linked categories and subcategories

**Release:** Release 2  
**Story Points:** 8

## User story

> As a user who organizes expenses with categories and subcategories in a spreadsheet, I want Gastto to detect, let me adjust, and confirm those relationships, so that it preserves my actual hierarchy without inventing associations or breaking spreadsheets that use categories only.

## Acceptance criteria

```gherkin
Feature: Configure linked categories and subcategories

  Scenario: Spreadsheet without a subcategory column
    Given the confirmed mapping includes a category column
    And it does not include a subcategory column
    When the system detects the spreadsheet vocabulary
    Then it preserves the flat category flow from HU-4.07
    And the absence of subcategories does not block confirmation or onboarding completion

  Scenario: Detect relationships while preserving each row
    Given the spreadsheet contains the rows "Food | Supermarket", "Food | Restaurant", and "Leisure | Restaurant"
    And the confirmed mapping includes category and subcategory columns
    When the system reads the spreadsheet
    Then it preserves the relationships "Food > Supermarket", "Food > Restaurant", and "Leisure > Restaurant"
    And it does not combine categories and subcategories as independent lists
    And it allows "Restaurant" to exist under different parents

  Scenario: Empty hierarchy in a new spreadsheet
    Given the mapped category and subcategory columns contain no values
    When the system prepares the confirmation
    Then it reports that no existing hierarchy was found
    And it offers the default category set from HU-4.07 without invented subcategories
    And the user can accept, modify, or dictate the hierarchy before confirming it

  Scenario: Orphan subcategories
    Given a row contains the subcategory "Streaming" without a parent category
    When the system detects the hierarchy
    Then it excludes "Streaming" from the proposed vocabulary
    And it tells the user that "Streaming" was omitted because it has no parent category
    And it does not assign a default or inferred category to that value

  Scenario: Duplicate values within and across parents
    Given the hierarchy already contains "Food > Restaurant"
    When another normalized variant of "Restaurant" appears under "Food"
    Then the system preserves only one relationship under that parent
    But when "Restaurant" appears under "Leisure"
    Then it also preserves that relationship because it belongs to a different parent

  Scenario: Add a subcategory to an existing parent
    Given the active category "Transportation" exists
    When the user says "add Tolls to Transportation"
    Then the system adds "Transportation > Tolls"
    And it shows the updated hierarchy for confirmation
    But if the parent does not exist or is ambiguous
    Then it rejects the change and lists the active categories the user can choose

  Scenario: Rename a subcategory within its parent
    Given "Food > Delivery" exists
    When the user says "under Food, rename Delivery to Takeout"
    Then the system renames only that subcategory
    And it rejects the change if the normalized name already exists under "Food"
    And it does not modify a subcategory with the same name under another parent

  Scenario: Move a subcategory between parents
    Given "Utilities > Streaming" exists
    And the active category "Leisure" exists
    When the user says "move Streaming from Utilities to Leisure"
    Then the system moves the complete relationship to "Leisure > Streaming"
    And it rejects the operation if "Streaming" already exists under "Leisure"
    And it leaves no active copy under "Utilities"

  Scenario: Remove a subcategory or category
    Given the hierarchy contains "Leisure > Cinema" and "Leisure > Streaming"
    When the user says "remove Cinema from Leisure"
    Then it deactivates only "Leisure > Cinema"
    When the user says "remove Leisure"
    Then it deactivates the category and its configured subcategories
    And it shows the resulting hierarchy before confirmation

  Scenario: Confirm the hierarchy atomically
    Given the user reviewed the complete hierarchy and the orphan-value warnings
    When the user replies "yes" or an equivalent confirmation
    Then the system persists categories and subcategories as one unit
    And it completes onboarding only if the complete valid hierarchy was saved
    And it does not add a new conversational state
```

## Definition of Done

- [ ] `subcategoria` is an optional mapping field, and a spreadsheet without that column preserves the exact behavior of HU-4.07.
- [ ] Detection uses complete rows, normalizes and deduplicates parent/child pairs, and permits the same subcategory name under different parents.
- [ ] A subcategory without a parent is excluded, reported by value, and never assigned an invented parent.
- [ ] An empty hierarchy offers default categories without creating default subcategories.
- [ ] Adding, renaming, moving, and removing subcategories requires an unambiguous active parent and enforces parent-scoped duplicate rules.
- [ ] Removing a category deactivates its configured subcategories, and the complete hierarchy is confirmed atomically.
- [ ] Repeated detection, modification, or confirmation is idempotent and does not create duplicate relationships.
- [ ] Unit and integration tests cover every scenario, persistence failures, and compatibility with existing flat payloads.
- [ ] Presentation and operations are consistent in Telegram and WhatsApp.
- [ ] No HTTP route or FSM state is added.

## Dependencies

- **HU-4.06:** Column mapping must be confirmed before reading the hierarchy columns.
- **HU-4.07:** The flat category detection, modification, confirmation, and compatibility behavior is reused.
- **ADR-004 and the existing spreadsheet adapters:** Row relationships must be preserved in Google Sheets and Excel Online.
