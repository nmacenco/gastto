## ADR-015 · Spreadsheet config idempotencia en re-onboarding

**Status:** Accepted

---

### Contexto

Cuando un usuario vuelve a pasar por el onboarding (por ejemplo, porque expiró el token OAuth y tuvo que reconectarse), el flujo intenta crear un nuevo registro en `spreadsheet_configs` usando `ISpreadsheetConfigRepository.create`. Sin embargo, el usuario ya tiene un registro existente en esa tabla, protegido por el índice único `uq_user_spreadsheet` en `user_id`. Esto produce un error `duplicate key value violates unique constraint` que falla permanentemente el job de BullMQ y, debido a que la transición de FSM se ejecutaba después de la inserción, el estado queda atascado en `ONBOARDING_SHEET` mientras la cola reintenta el job hasta 3 veces, enviando el mismo mensaje de confirmación al usuario en cada intento.

### Decisión

1. **Persistencia idempotente con upsert.** Se agrega `upsertByUserId` a `ISpreadsheetConfigRepository` y se implementa en `DrizzleSpreadsheetConfigRepository` usando `ON CONFLICT (user_id) DO UPDATE`. El caso de uso `HandleSheetSelection.confirmSheet` utiliza `upsertByUserId` en lugar de `create` para persistir la configuración de la planilla. Esto permite que un usuario que ya tiene una configuración previa pueda re-seleccionar una hoja sin errores de restricción.

2. **Reordenamiento de operaciones en `confirmSheet`.** El orden de ejecución se cambia a: persistencia → transición de FSM → envío de mensaje de confirmación → validación de acceso (eager advance). Esto garantiza que si la persistencia falla, no se envía un mensaje de éxito al usuario y la FSM no queda en un estado intermedio. Un reintento de BullMQ no reenvía el mensaje porque la transición de FSM nunca se comprometió.

3. **Cierre defensivo en `processMessageJob`.** El worker `process-message` envuelve el handler de FSM en un `try/catch` que atrapa errores inesperados, los loguea con campos estructurados, y envía un único mensaje de fallback (`fallbackError`) al usuario en lugar de permitir que BullMQ reintente el handler con los mismos efectos secundarios.

4. **Una sola tentativa para `process-message`.** La configuración de la cola `process-message` se cambia de `attempts: 3` a `attempts: 1`. Esto, combinado con el try/catch del worker, evita la re-ejecución de handlers con efectos secundarios visibles (envío de mensajes).

### Cuándo aplica

El patrón de upsert idempotente aplica en cualquier entidad que:
- Tiene una restricción única por usuario (o por usuario + provider).
- Puede ser re-creada durante un flujo de re-onboarding o reconexión.

### Consecuencias

- **Positivas:** El usuario puede re-onboardear cuantas veces sea necesario sin errores ni mensajes duplicados. El estado de la FSM siempre avanza correctamente. La cola de mensajes se comporta de forma determinista con una sola tentativa.
- **Negativas:** Se mantiene `create` en la interfaz para compatibilidad con código existente. Se documenta que `create` solo aplica para usuarios nuevos.
- **Riesgos:** Si `process-message` necesitara reintentos legítimos en el futuro (por ejemplo, para errores transitorios de red), se debería evaluar un mecanismo de idempotencia por mensaje en lugar de reintentos ciegos.

### Archivos afectados

- `src/domain/ports/repositories.ts` — `ISpreadsheetConfigRepository.upsertByUserId`
- `src/infrastructure/db/repositories/DrizzleSpreadsheetConfigRepository.ts` — implementación con `onConflictDoUpdate`
- `src/application/use-cases/spreadsheet/HandleSheetSelection.ts` — `confirmSheet` reordenado y usando `upsertByUserId`
- `src/interfaces/workers/message.worker.ts` — `processMessageJob` con try/catch
- `src/main.ts` — `attempts: 1` en la cola `process-message`
- `docs/features/select-sheet.md` — contrato actualizado
- `docs/architecture/data-model.md` — decisión documentada
