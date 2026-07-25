
**User Story**

> As a system receiving an expense message, I need to automatically detect the numeric amount and the mentioned currency, so I have the minimum indispensable data for any financial record.

---

**Acceptance Criteria**

Feature: Amount and currency detection in the user's text

  Scenario: Explicit amount and currency in standard format
    Given the system receives the message "Pagué 45,50 EUR en el supermercado"
    When the system processes the text
    Then it extracts amount = 45.50 and currency = EUR
    And it continues the interpretation flow

  Scenario: Currency expressed as a symbol
    Given the system receives the message "Gasté $1.200 en el taxi"
    When the system processes the text
    Then it extracts amount = 1200 and currency = the user's default configuration (or asks for clarification if not defined)

  Scenario: Amount with thousands and decimal separators that vary by locale
    Given the system receives "Cargué nafta por 8.500,00 pesos"
    When the system processes the text
    Then it extracts amount = 8500.00 and currency = pesos (or the user's default currency)

  Scenario: Amount present but currency absent and no default configuration
    Given the user has no default currency configured
    And the message says "Pagué 30 por el café"
    When the system processes the text
    Then it detects amount = 30 but cannot determine the currency
    And it asks the user for clarification: "¿En qué moneda fue ese gasto?"

  Scenario: No recognizable amount in the message
    Given the user sends "Fui al supermercado"
    When the system processes the text
    Then it does not detect a valid amount
    And it asks for clarification: "¿Cuánto gastaste?"

  Scenario: Negative or zero amount
    Given the user sends "Gasté 0 pesos en algo"
    When the system processes the text
    Then it detects amount = 0
    And it asks for confirmation before continuing: "¿Querías registrar un gasto de $0?"

**Definition of Done**

- The amount and currency extractor works correctly for the following documented variants: symbol before the number ($, €, £), ISO code after the number (EUR, ARS, USD), thousands separators with period or comma, decimals with period or comma.
- When the currency cannot be inferred, the system always asks for clarification before continuing, without assuming incorrect values.
- The user's profile field `default_currency` is consulted as a fallback before asking for clarification.
- Unit test coverage ≥ 90% for the amount/currency extraction function.

**Story Points: 5**

> Detecting amounts seems simple, but regional formats (periods vs. commas, symbols vs. ISO codes, ambiguous currencies like "$" which can be ARS, USD, MXN, etc.) add real complexity. It requires designing fallback logic to the default currency and the clarification request flow when there is not enough information.

**Dependencies**

- E1-US-01 and E1-US-02: message received and acknowledgment sent.
- User profile with `default_currency` field available (may come from the initial configuration of Epic 4).
