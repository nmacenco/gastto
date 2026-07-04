# TypeScript: No Redundant `undefined` on Top Types

## Convention

Do not add `| undefined` to optional properties whose base type is already a top type (`unknown` or `any`). Since `unknown` includes every possible value, `unknown | undefined` is semantically identical to `unknown` and will trigger `@typescript-eslint/no-redundant-type-constituents`.

## Benefits

- Eliminates linter errors from `@typescript-eslint/no-redundant-type-constituents`.
- Keeps type declarations concise without losing correctness.
- Avoids confusion when reconciling `exactOptionalPropertyTypes` with top types.

## Examples

### Good: Optional `unknown` without `| undefined`

```typescript
export interface NormalizedPayload {
  readonly rawPayload?: unknown;
}
```

### Bad: Redundant `| undefined` on `unknown`

```typescript
export interface NormalizedPayload {
  readonly rawPayload?: unknown | undefined;
}
```

## Real world examples

- [`NormalizedPayload`](../../src/domain/ports/messaging.ts)

## Related agreements

- [`explicit-undefined-optional-properties.md`](./explicit-undefined-optional-properties.md) - general rule for optional properties.
- [`tsconfig.json`](../../tsconfig.json) - `exactOptionalPropertyTypes: true`.
