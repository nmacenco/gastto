## ADR-014 · FSM Eager Advance: Auto-trigger next use case on deterministic transitions

**Status:** Proposed

---

### Contexto

Gastto modela sus flujos conversacionales como una Máquina de Estados Finita (FSM) persistida en PostgreSQL (ADR-003). Varias transiciones de esta FSM son determinísticas: una vez que el sistema alcanza un estado, el siguiente paso no requiere una decisión del usuario y puede ejecutarse inmediatamente.

Históricamente, después de transicionar a un nuevo estado el bot quedaba a la espera de un nuevo mensaje entrante para que `message.worker` enrutara al siguiente caso de uso. Esto generaba "dead air" conversacional y obligaba al usuario a enviar mensajes de avance innecesarios (por ejemplo, tras conectar Google Drive o tras seleccionar un archivo).

Con el tiempo se fueron agregando disparos automáticos puntuales —el callback de OAuth invoca `HandleSpreadsheetFileSelection` y la selección de archivo invoca `HandleSheetSelection`— pero el patrón no está documentado ni aplicado de forma consistente en todo el flujo.

### Decisión

Cuando un caso de uso realiza una **transición de FSM determinística hacia adelante** (es decir, no requiere input del usuario), puede invocar inmediatamente el siguiente caso de uso después de persistir el nuevo estado.

La invocación sigue estas reglas:

1. Se ejecuta **después** de `TransitionConversationState.execute`, con el `statePayload` resultante de la transición.
2. El siguiente caso de uso se invoca con `rawMessage: ''` y el `channel` original.
3. La llamada se envuelve en un `try/catch` aislado: un fallo en el siguiente paso se loguea estructuradamente pero **no cambia** el resultado exitoso del caso de uso actual.
4. El código de error debe seguir el formato `POST_<ESTADO_ACTUAL>_<ESTADO_DESTINO>_FAILED` o similar, con `endpoint` apuntando al caso de uso que disparó la transición.
5. En `main.ts` el siguiente caso de uso debe instanciarse **antes** que el caso de uso que lo invoca, para evitar referencias circulares o `undefined` en tiempo de construcción.
6. El fallback en `message.worker` para el estado destino permanece activo: si el disparo automático falla o no está cableado, el siguiente mensaje del usuario sigue pudiendo continuar el flujo.

### Cuándo aplica

El patrón eager advance aplica en transiciones forward-only donde el siguiente estado puede procesarse con `rawMessage: ''` o con el `statePayload` generado:

- `ONBOARDING_DRIVE` → `ONBOARDING_FILE`: el callback de OAuth dispara el listado de archivos.
- `ONBOARDING_FILE` → `ONBOARDING_SHEET`: la selección de archivo dispara el listado/autoselección de hojas.
- `ONBOARDING_SHEET` → `ONBOARDING_VALIDATING_ACCESS`: la autoconfirmación de una hoja única dispara la validación de acceso.
- `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_MAPPING`: el acceso exitoso dispara la inferencia de mapeo de columnas.
- `EXPENSE_REVIEW` → `EXPENSE_SAVING`: la confirmación del gasto por parte del usuario dispara el guardado.
- `EXPENSE_SAVING` → `IDLE`: el guardado exitoso dispara el envío de la confirmación final.

### Cuándo NO aplica

No debe usarse cuando el siguiente paso requiere elección, confirmación o corrección del usuario:

- `ONBOARDING_FILE` en self-transition mientras se muestra la lista de archivos.
- `ONBOARDING_SHEET` en self-transition mientras se muestra la lista de hojas.
- `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_SHEET` por hoja vacía (pide confirmación).
- `ONBOARDING_VALIDATING_ACCESS` → `ONBOARDING_START` por error de acceso (reconexión manual).
- `ONBOARDING_MAPPING` en self-transition mientras se muestra la propuesta de mapeo.
- `ONBOARDING_CATEGORIES` en self-transition mientras se muestran las categorías propuestas.
- `EXPENSE_RECEIVING` → `EXPENSE_CLARIFYING` cuando faltan datos.
- `EXPENSE_REVIEW` → `EXPENSE_CORRECTING` cuando el usuario pide corregir un campo.

### Relación con otros ADRs

- **ADR-003 (FSM persistida en PostgreSQL):** el eager advance opera sobre la misma FSM; la diferencia es quién dispara el siguiente caso de uso (el caso de uso anterior en lugar de un mensaje entrante).
- **ADR-005 (pipeline asíncrono BullMQ):** los mensajes generados por el disparo automático siguen saliendo por el mismo `MessagingOutputPort`; no se crea un nuevo worker.
- **ADR-011 (pipeline de dos colas FIFO):** el thin worker `incoming-message` solo enruta mensajes entrantes; el eager advance ocurre dentro del thick worker `process-message` y no afecta el ordenamiento FIFO.

### Consecuencias

**Positivas**

- Menor fricción conversacional: el usuario avanza por el onboarding con la menor cantidad de mensajes posible.
- UX consistente: una vez que aceptamos un patrón, todos los flujos determinísticos lo siguen.
- Reutilización del mismo mecanismo de cola y mensajería; no se agrega infraestructura nueva.

**Negativas**

- Mayor acoplamiento entre casos de uso contiguos: el caso de uso A debe conocer la existencia del caso de uso B.
- El orden de instanciación en `main.ts` pasa a ser relevante; una referencia mal ordenada produce un error en tiempo de construcción.
- Un fallo en el disparo automático no debe romper el paso actual, lo que obliga a un manejo de errores cuidadoso.
- El timeout de la FSM se renueva en cada transición automática; esto es deseable, pero debe tenerse en cuenta al auditar sesiones largas.

### Alternativas descartadas

| Alternativa | Motivo de descarte |
| --- | --- |
| Disparar el siguiente paso con un job de BullMQ encolado | Añade latencia y complejidad (nuevo tipo de job, manejo de errores distribuido) para un caso que ocurre en el mismo worker. |
| Dejar que `message.worker` enrute siempre el siguiente paso | Mantiene el acoplamiento bajo pero genera "dead air" y mensajes de avance innecesarios del usuario. |
| Modelar el avance automático como eventos de dominio | Para el MVP es over-engineering; la inyección directa del siguiente caso de uso es suficiente y más explícita. |
