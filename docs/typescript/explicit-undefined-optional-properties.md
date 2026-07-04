# TypeScript: Explicit `undefined` in Optional Properties

## Convention

When `exactOptionalPropertyTypes` is enabled in `tsconfig.json`, optional properties (`?:`) must explicitly include `| undefined` in their type if the property can be assigned `undefined` at runtime. This ensures optional properties are assignable from expressions of type `string | undefined`.

## Benefits

- Prevents type errors when assigning the result of optional chaining or other potentially-undefined expressions.
- Makes the type contract explicit: consumers know the property may be missing _or_ explicitly set to `undefined`.
- Aligns the type system with runtime behavior where optional properties often come from external sources that may return `undefined`.

## Examples

### Good: Explicit `| undefined`

```typescript
export interface HandleStartCommandInput {
  chatId: string;
  username?: string | undefined;
}
```

### Bad: Missing `| undefined`

```typescript
export interface HandleStartCommandInput {
  chatId: string;
  username?: string;
}
```

## Real world examples

- [`HandleStartCommandInput`](../../src/application/use-cases/conversation/HandleStartCommand.ts)
- [`WebhookInfo`](../../src/infrastructure/adapters/telegram/TelegramWebhookConfigurator.ts)

## Related agreements

- [`tsconfig.json`](../../tsconfig.json) - `exactOptionalPropertyTypes: true` is enabled under `compilerOptions`.
