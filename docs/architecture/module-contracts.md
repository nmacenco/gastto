# Module Contracts — Gastto

## Clean Architecture import rules

| Layer            | Can import from                 |
| ---------------- | ------------------------------- |
| `domain`         | nothing above it                |
| `application`    | `domain` only                   |
| `infrastructure` | `domain`, `application`         |
| `interfaces`     | `application`, `infrastructure` |

Ports are defined in `domain/ports/`. Adapters implement them in `infrastructure/`.

## Ports summary

| Port | File | Responsibility | Implementations |
|------|------|----------------|------------------|
| `LLMPort` | `src/domain/ports/LLMPort.ts` | Extract expenses and generate responses from free text | `OpenAIAdapter`, `ClaudeAdapter` (`src/infrastructure/llm/`) |
| `SpreadsheetPort` | `src/domain/ports/SpreadsheetPort.ts` | Read/write rows, headers, and validate access to user spreadsheets | `GoogleSheetsAdapter`, `ExcelOnlineAdapter` (`src/infrastructure/spreadsheet/`) |
| `MessagingPort` | `src/domain/ports/MessagingPort.ts` | Send messages to users via Telegram or WhatsApp | `TelegramAdapter`, `WhatsAppAdapter` (`src/infrastructure/messaging/`) |
| `ConversationStateRepository` | `src/domain/ports/ConversationStateRepository.ts` | Persist and transition FSM state per user | `DrizzleConversationStateRepository` (`src/infrastructure/db/`) |
| `UserRepository` | `src/domain/ports/UserRepository.ts` | Create users, resolve identity, link messaging accounts | `DrizzleUserRepository` (`src/infrastructure/db/`) |
| `OAuthTokenRepository` | `src/domain/ports/OAuthTokenRepository.ts` | Store/retrieve encrypted OAuth tokens | `DrizzleOAuthTokenRepository` (`src/infrastructure/db/`) |

## Adapter naming convention

| Pattern            | Example                                                       |
| ------------------ | ------------------------------------------------------------- |
| `{Provider}{Port}` | `GoogleSheetsAdapter`, `TelegramAdapter`, `OpenAIAdapter`     |
| `Drizzle{Port}`    | `DrizzleUserRepository`, `DrizzleConversationStateRepository` |

- Each adapter file exports a single class.
- Dependency injection is manual (constructor injection). No IoC container in MVP.
