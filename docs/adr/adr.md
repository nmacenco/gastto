---

**Producto:** Gastto — Asistente Financiero Conversacional **Release:** Release 1 — MVP **Fecha:** Abril 2025 **Autor:** Arquitectura de Producto / Engineering Lead **Revisores:** Tech Lead, Product Owner, Senior Dev **Stack base:** Fastify + TypeScript · Node.js (Clean Architecture) · LLM (Claude API) · Fly.io

---

## ADR-001 · Topología: Monolito Modular

**Status:** Accepted

### Contexto

El MVP de Gastto requiere coordinar múltiples responsabilidades: recepción de webhooks, procesamiento de lenguaje natural, gestión de estado conversacional y escritura en hojas de cálculo externas. La decisión sobre cómo organizar estos componentes condiciona la velocidad de desarrollo, el overhead operativo y la capacidad de evolución futura del sistema.

El equipo es reducido y el proyecto tiene un horizonte de MVP acotado. Se necesita una topología que permita avanzar rápido sin hipotecar la arquitectura a largo plazo.

### Decisión

Se adopta un **monolito modular** como topología de partida, organizado en torno a cinco módulos internos con responsabilidades claramente delimitadas:

- **Gateway de mensajería:** recibe webhooks de Telegram y WhatsApp Business API, valida el origen (token/IP) y enruta al Orquestador.
- **Orquestador de flujos (FSM):** determina en qué paso del flujo conversacional está cada usuario y delega al módulo correspondiente.
- **Motor NLP (LLM):** llama a la API del modelo de lenguaje para interpretar gastos y generar respuestas en lenguaje natural.
- **Servicio de planilla:** encapsula toda la lógica de lectura/escritura sobre Google Sheets y Excel Online, incluyendo el mapeo dinámico de columnas.
- **Store de estado conversacional:** persiste el estado de conversación de cada usuario en base de datos, no en memoria volátil.

La comunicación entre módulos es asíncrona vía cola de mensajes (ver ADR-005).

### Alternativas descartadas

| Alternativa                     | Motivo de descarte                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Microservicios desde el inicio  | Overhead operativo (service mesh, CI/CD por servicio, observabilidad distribuida) no justificado para un equipo pequeño en MVP. |
| Monolito sin separación modular | Dificulta la extracción futura de servicios y mezcla responsabilidades, generando deuda técnica inmediata.                      |

### Consecuencias

**Positivas**

- Velocidad de desarrollo: un único repositorio, despliegue simple, sin latencia inter-servicio.
- La Clean Architecture en Node.js permite extraer módulos a servicios independientes en el futuro sin refactor estructural.
- Facilita la incorporación de nuevas épicas (consulta, reportes) sin cambio de topología.

**Negativas**

- Escalabilidad horizontal limitada a nivel de módulo: si el Motor NLP se convierte en el cuello de botella, escalar implica replicar el monolito completo.
- Requiere disciplina de equipo para mantener los límites entre módulos y no crear acoplamientos cruzados.

---

## ADR-002 · NLP: LLM con Extracción Estructurada vía Puerto Abstraído

**Status:** Accepted

### Contexto

El sistema debe interpretar mensajes de texto libre en lenguaje natural (español con variantes regionales, abreviaciones y errores ortográficos) y extraer entidades financieras precisas: monto, moneda, categoría, fecha y medio de pago. La precisión en esta extracción es crítica para generar confianza en el usuario.

Adicionalmente, el proyecto tiene un objetivo pedagógico explícito (Máster en IA), por lo que el uso de modelos LLM es un requerimiento, no solo una opción técnica.

El equipo requiere además que el sistema no quede atado a un único proveedor de LLM, preservando la capacidad de intercambiar o combinar modelos sin modificar la lógica de aplicación.

### Decisión

Se utiliza un **LLM** como único motor de interpretación de lenguaje natural, con la técnica de **extracción estructurada mediante prompt engineering** (Function Calling / JSON Schema).

Para desacoplar el proveedor concreto de la lógica de aplicación, se implementa el **patrón Adapter** mediante un puerto `LLMPort` en la capa de Dominio, siguiendo el mismo patrón ya establecido en ADR-004 para `SpreadsheetPort`. Cada proveedor de LLM tiene su propio adapter en la capa de Infraestructura que implementa esta interfaz común.

**`gpt-4o`** es la implementación por defecto para el MVP mediante `OpenAIAdapter`. Nuevos proveedores (Claude, Gemini, etc.) pueden incorporarse en el futuro implementando el mismo puerto sin modificar ningún caso de uso.

**Puerto de dominio `LLMPort`:**

```typescript
// Domain layer — src/domain/ports/LLMPort.ts

interface ExtractedExpense {
  monto: number | null;
  moneda: 'ARS' | 'EUR' | 'USD' | 'MXN' | 'GBP' | 'BRL' | null;
  categoria_raw: string | null;
  fecha_raw: string | null;
  medio_pago: string | null;
  confianza_categoria: 'alta' | 'baja' | 'nula';
}

interface LLMPort {
  extractExpense(userMessage: string, userContext: UserContext): Promise<ExtractedExpense>;
  generateResponse(prompt: string, context: ConversationContext): Promise<string>;
}
```

**Implementación por defecto `OpenAIAdapter`:**

El adapter recibe el mensaje del usuario, construye el prompt y parsea la respuesta. El modelo recibe un system prompt estricto que lo instruye a devolver exclusivamente un objeto JSON validable. La estructura del prompt es la siguiente:

```
SYSTEM:
Eres el motor de extracción de datos de Gastto. Tu única tarea es:
1. Extraer las entidades del mensaje del usuario: monto, moneda, categoría, fecha y medio de pago.
2. Devolver un JSON estricto con el esquema definido.
3. Nunca inventar datos. Si un campo no está presente, devolver null.

Esquema de salida (siempre JSON, sin markdown):
{
  "monto": number | null,
  "moneda": "ARS" | "EUR" | "USD" | "MXN" | null,
  "categoria_raw": string | null,
  "fecha_raw": string | null,
  "medio_pago": string | null,
  "confianza_categoria": "alta" | "baja" | "nula"
}

USER:
Pagué el almuerzo, 12 euros
```

La respuesta del LLM se parsea como JSON (validado con Zod/TypeScript) y se pasa al motor de mapeo de categorías, que aplica el vocabulario real de la planilla del usuario mediante búsqueda de similitud semántica (embeddings). Esto desacopla la interpretación lingüística del mapeo de dominio.

### Alternativas descartadas

| Alternativa                                                 | Motivo de descarte                                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NER clásico (spaCy, Duckling)                               | Requiere entrenamiento y mantenimiento de modelos por idioma y variante regional. Baja adaptabilidad a jerga financiera por usuario. No alineado con el objetivo pedagógico.              |
| Expresiones regulares (RegEx)                               | No captura variedad lingüística ni errores ortográficos. Requiere mantenimiento constante de patrones.                                                                                    |
| Rasa / frameworks conversacionales                          | Curva de aprendizaje alta, requiere datos de entrenamiento, y no aporta ventaja sobre un LLM bien prompeado para este caso de uso.                                                        |
| SDK del proveedor LLM directamente en la capa de aplicación | Acopla la lógica de negocio a un vendor concreto. Un cambio de proveedor requeriría modificar casos de uso, violando el principio de inversión de dependencias ya establecido en ADR-004. |

### Consecuencias

**Positivas**

- Robustez ante variedad lingüística sin entrenamiento adicional ("Pagué 15 lucas del almuerzo" se interpreta correctamente).
- Actualizable sin cambio de código: modificar el system prompt dentro del adapter ajusta el comportamiento del extractor.
- Genera respuestas en lenguaje natural en el mismo paso que la extracción de entidades.
- Alineación directa con el objetivo pedagógico del Máster en IA.
- El puerto `LLMPort` permite intercambiar o combinar proveedores sin modificar ningún caso de uso ni la FSM. Coherente con el patrón ya establecido en ADR-004.
- Cada adapter encapsula las diferencias de API, autenticación y formato de respuesta de su proveedor.

**Negativas**

- Costo por token de API. Con volumen alto, el costo puede ser significativo. Mitigación: cachear respuestas para mensajes idénticos del mismo usuario.
- Latencia variable (2-5 segundos típicos), mitigada por la arquitectura asíncrona del ADR-005.
- Dependencia de un proveedor externo de API: una caída del servicio LLM activo paraliza el procesamiento NLP. Mitigación futura: implementar un segundo adapter como fallback.
- Los modelos de distintos proveedores no se comportan de forma idéntica ante el mismo prompt. El adapter no puede ocultar completamente las diferencias de calidad de extracción entre modelos: un cambio de proveedor requiere validar el prompt y el esquema de salida contra el nuevo modelo antes de activarlo en producción.

---

## ADR-003 · Estado Conversacional: FSM Persistida en PostgreSQL

**Status:** Accepted

### Contexto

Los flujos conversacionales de Gastto son multi-turno y pueden durar minutos u horas (el usuario puede iniciar un registro, interrumpirlo y retomarlo). El sistema debe saber en todo momento en qué punto del flujo está cada usuario para responder de forma coherente.

El estado no puede residir en memoria del proceso porque un reinicio eliminaría todos los contextos en curso. Se requiere persistencia durable y capacidad de auditoría de flujos fallidos.

### Decisión

El estado de conversación de cada usuario se modela como una **Máquina de Estados Finita (FSM) persistida en PostgreSQL**. Redis se usa únicamente como caché; la cola de mensajes la gestiona BullMQ sobre Redis (ADR-005), pero nunca como store primario de estado.

Los estados definidos para el MVP son los siguientes:

| Estado                  | Descripción                                 | Transiciones salientes                               |
| ----------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `IDLE`                  | Sin flujo activo                            | → `ONBOARDING_START` \| `EXPENSE_RECEIVING`          |
| `ONBOARDING_START`      | Primer contacto, sin planilla vinculada     | → `ONBOARDING_START` (marcar `promptShown`) \| `ONBOARDING_DRIVE` |
| `ONBOARDING_DRIVE`      | Esperando conexión OAuth                    | → `ONBOARDING_FILE`                                  |
| `ONBOARDING_FILE`       | Esperando selección de archivo              | → `ONBOARDING_FILE` (guardar `fileList` / `step`) \| `ONBOARDING_SHEET` |
| `ONBOARDING_SHEET`      | Esperando selección de hoja                 | → `ONBOARDING_SHEET` (guardar `sheetList` / `step`) \| `ONBOARDING_MAPPING` |
| `ONBOARDING_MAPPING`    | Esperando confirmación de mapeo de columnas | → `ONBOARDING_CATEGORIES`                            |
| `ONBOARDING_CATEGORIES` | Esperando confirmación de categorías        | → `IDLE`                                             |
| `EXPENSE_RECEIVING`     | Mensaje recibido, procesando NLP            | → `EXPENSE_CLARIFYING` \| `EXPENSE_REVIEW`           |
| `EXPENSE_CLARIFYING`    | Esperando aclaración del usuario            | → `EXPENSE_REVIEW` \| `IDLE`                         |
| `EXPENSE_REVIEW`        | Resumen enviado, esperando confirmación     | → `EXPENSE_SAVING` \| `EXPENSE_CORRECTING` \| `IDLE` |
| `EXPENSE_CORRECTING`    | Aplicando corrección del usuario            | → `EXPENSE_REVIEW`                                   |
| `EXPENSE_SAVING`        | Escribiendo en la planilla                  | → `IDLE` \| `EXPENSE_SAVING_RETRY`                   |
| `EXPENSE_SAVING_RETRY`  | Reintentando guardado fallido (TTL: 10 min) | → `IDLE`                                             |

### Alternativas descartadas

| Alternativa                              | Motivo de descarte                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Estado solo en Redis (memoria)           | Redis puede reiniciarse o el key puede expirar. Los flujos de onboarding pueden durar horas. Se necesita persistencia durable. |
| Estado en memoria del proceso (variable) | Un reinicio del proceso Node.js eliminaría todos los estados en curso. Incompatible con escalabilidad horizontal.              |

### Consecuencias

**Positivas**

- Resiliencia ante reinicios: el estado sobrevive caídas del proceso.
- Permite auditoría y debugging de flujos fallidos consultando la BD directamente.
- Soporte nativo para flujos de larga duración (onboarding puede durar horas).
- La FSM hace explícitos todos los estados posibles, reduciendo comportamientos inesperados.

**Negativas**

- Cada transición de estado implica una escritura en BD, añadiendo latencia mínima pero constante.
- Mantener el mapa de estados sincronizado con las HUs requiere disciplina: un estado no contemplado puede causar comportamientos inesperados en producción.

---

## ADR-004 · Integración con Planillas: Adapter Pattern

**Status:** Accepted

### Contexto

El MVP debe soportar simultáneamente dos proveedores de almacenamiento en la nube: Google Drive (Sheets) y OneDrive (Excel Online). La estructura de las planillas es desconocida hasta el momento del onboarding, y puede variar por usuario. El sistema debe ser capaz de leer, escribir y mapear columnas de forma dinámica sin asumir una estructura fija.

Las APIs de Google y Microsoft son suficientemente distintas (autenticación, formatos de respuesta, manejo de permisos) como para requerir implementaciones separadas.

### Decisión

Se implementa el **Patrón Adapter** en la capa de Infraestructura de la Clean Architecture, con un adapter independiente por proveedor y una interfaz común.

**Interfaz unificada `SpreadsheetPort`:**

```typescript
interface SpreadsheetPort {
  readRows(sheetId: string, range: string): Promise<Row[]>;
  appendRow(
    sheetId: string,
    sheetName: string,
    values: CellValue[],
  ): Promise<{ sheet: string; row: number }>;
  deleteRow(sheetId: string, sheetName: string, rowIndex: number): Promise<void>;
  getUniqueValues(sheetId: string, column: string): Promise<string[]>;
  getHeaders(sheetId: string, sheetName: string): Promise<string[]>;
  validateAccess(sheetId: string): Promise<boolean>;
}
```

**Implementaciones:** `GoogleSheetsAdapter` y `ExcelOnlineAdapter`, ambos implementando `SpreadsheetPort`.

**Mapeo dinámico de columnas:** el resultado del onboarding (inferencia de columnas en E4-US-05 y E4-US-06) se persiste en BD como `MappingConfig` por usuario. Este mapeo relaciona las entidades extraídas por la IA con los índices de columna reales del archivo (ej. `"monto" → Columna B`). El mapeo se cachea en Redis con TTL de 1 hora para evitar llamadas innecesarias a la API en cada registro.

**Verificación proactiva de permisos:** durante el onboarding, el sistema ejecuta un append de prueba en una fila temporal y la elimina inmediatamente, confirmando acceso de lectura y escritura antes de que el usuario intente guardar su primer gasto.

### Alternativas descartadas

| Alternativa                              | Motivo de descarte                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Un único adapter para Google y Microsoft | Las APIs son suficientemente distintas como para que un adapter unificado genere más complejidad que dos adapters limpios con interfaz común. |
| Integración directa sin abstracción      | Un cambio en la API de cualquier proveedor requeriría modificar la lógica de negocio. Viola el principio de inversión de dependencias.        |

### Consecuencias

**Positivas**

- Desacoplamiento total del proveedor de almacenamiento: un cambio en la API de un proveedor solo afecta su adapter.
- Facilidad para añadir nuevos proveedores en el futuro (Notion, Excel Online standalone) implementando la interfaz.
- La verificación proactiva de permisos evita errores de acceso en el primer guardado real.

**Negativas**

- El mapeo dinámico de columnas es la HU más compleja del onboarding: un algoritmo de inferencia deficiente generará mapeos incorrectos que destruyen la confianza del usuario.
- Necesidad de gestionar y refrescar tokens OAuth de dos proveedores de forma segura (ver ADR-007).
- Duplica la superficie de autenticación y los casos de prueba de seguridad desde el inicio.

---

## ADR-005 · Latencia: Pipeline Asíncrono con BullMQ sobre Redis

**Status:** Accepted **Fecha:** Abril 2025

---

### Contexto

El sistema impone dos restricciones técnicas mutuamente excluyentes en un pipeline síncrono:

- **Acuse de recibo ≤ 1 segundo** (E1-US-02, P95 bajo carga normal).
- **Procesamiento NLP mediante LLM**, que típicamente tarda entre 2 y 5 segundos.

Un diseño síncrono no puede cumplir ambas restricciones simultáneamente. Se requiere un mecanismo de desacoplamiento entre la recepción del mensaje y su procesamiento.

El servidor Fastify desplegado en Fly.io (ADR-009) opera como proceso Node.js persistente, lo que hace viable el modelo de workers de BullMQ con conexión activa y continua a Redis. No existe ninguna restricción de entorno efímero que limite esta elección.

---

### Decisión

Se adopta un **pipeline asíncrono en dos etapas con BullMQ sobre Redis (Upstash)** como mecanismo de desacoplamiento entre la recepción del webhook y el procesamiento NLP.

**BullMQ** es una librería de colas para Node.js que opera sobre Redis como broker. Los producers encolan jobs; los workers, corriendo en el mismo proceso persistente de Fastify, los consumen de forma asíncrona con soporte nativo de reintentos, backoff exponencial y dead letter queues.

---

### Etapa 1 — Acuse inmediato (objetivo: < 300ms)

El handler Fastify de la ruta `/webhook/:channel` ejecuta exclusivamente:

1. Recibe el webhook de Telegram o WhatsApp Business API.
2. Valida el origen: verifica el token secreto en header (Telegram) o la firma HMAC-SHA256 del payload (WhatsApp Business API).
3. Encola el payload normalizado en BullMQ como job de tipo `process-message`.
4. Envía el acuse de recibo al usuario (`"Recibido, procesando tu gasto…"`) via Telegram/WhatsApp API.
5. Devuelve HTTP 200 al canal de mensajería.

Esta etapa no llama al LLM, no accede a la planilla ni consulta PostgreSQL más allá de la resolución de identidad cacheada en Redis.

---

### Etapa 2 — Procesamiento asíncrono (objetivo: < 5 segundos desde el mensaje original)

El worker BullMQ consume el job `process-message` en el mismo proceso Fastify:

1. El Orquestador FSM recupera el estado del usuario desde PostgreSQL.
2. El Motor NLP llama a la API del LLM (Claude) con el mensaje y el system prompt estructurado.
3. El Servicio de Categorías aplica el mapeo semántico contra el vocabulario del usuario.
4. El Servicio de Planilla ejecuta la escritura si corresponde (flujo de guardado).
5. El Gateway envía la respuesta final al usuario y actualiza el estado FSM en PostgreSQL.

Si el procesamiento falla, BullMQ reintenta automáticamente con backoff exponencial según la política configurada (ver sección de reintentos).

---

### Política de reintentos

| Parámetro            | Valor configurado                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Máximo de reintentos | 3                                                                                                                                                           |
| Backoff              | Exponencial: 1s → 2s → 4s                                                                                                                                   |
| Timeout por intento  | 25 segundos (el Motor NLP tiene timeout propio de 10s antes de devolver error controlado)                                                                   |
| Dead letter          | Los jobs que agotan reintentos son capturados por el evento `failed` de BullMQ y se registran en la tabla `failed_jobs` en PostgreSQL para auditoría manual |

---

### Validación de origen en el webhook

La validación de origen se realiza en el handler de Fastify antes de encolar el job, sin depender de ningún intermediario externo:

```typescript
// Telegram: verificación de token secreto en header X-Telegram-Bot-Api-Secret-Token
function validateTelegramOrigin(req: FastifyRequest): boolean {
  return req.headers['x-telegram-bot-api-secret-token'] === process.env.TELEGRAM_WEBHOOK_SECRET;
}

// WhatsApp Business API: verificación de firma HMAC-SHA256 del payload
function validateWhatsAppOrigin(req: FastifyRequest): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  const expected =
    'sha256=' +
    createHmac('sha256', process.env.WHATSAPP_APP_SECRET!)
      .update(JSON.stringify(req.body))
      .digest('hex');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Requests que no superen la validación se rechazan con HTTP 403 sin encolar ningún job ni ejecutar lógica de negocio.

---

### Alternativas descartadas

| Alternativa                           | Motivo de descarte                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline síncrono                     | Incompatible con el SLA de ≤ 1s de acuse de recibo si el LLM tarda 2-5 segundos.                                                                                                                        |
| Upstash QStash (cola HTTP gestionada) | Requiere funciones efímeras (serverless) como workers. Incompatible con BullMQ y con los timeouts conversacionales de la FSM que necesitan proceso persistente. Descartado junto con Vercel en ADR-009. |
| RabbitMQ / Kafka                      | Overhead operativo no justificado. Sin tier gratuito operativo para producción.                                                                                                                         |
| Polling de BD con Cron                | Introduce latencia mínima de segundos entre el encolado y el procesamiento. Incompatible con el SLA de respuesta < 5 segundos.                                                                          |

---

### Consecuencias

**Positivas**

- BullMQ opera en su modelo nativo: proceso persistente con conexión activa a Redis, sin workarounds ni brokers HTTP intermedios.
- Reintentos automáticos con backoff exponencial y dead letter queue gestionados directamente por BullMQ, sin lógica adicional en el handler.
- Los timeouts conversacionales de la FSM (10 minutos en `EXPENSE_REVIEW`, 30 minutos en onboarding) se implementan con jobs BullMQ con delay, en el mismo runtime.
- Redis (Upstash free tier) sirve tanto de broker de cola como de caché: resolución de identidad `(channel, externalId) → userId` y mapeo de columnas por usuario.
- La validación de origen se realiza con las APIs nativas de cada canal (token secreto de Telegram, HMAC-SHA256 de WhatsApp), sin dependencias de SDKs de terceros para este propósito.

**Negativas**

- El worker y el servidor HTTP comparten proceso: una fuga de memoria en el procesamiento NLP puede afectar la disponibilidad del webhook. Mitigación: monitorizar métricas de heap en Fly.io y configurar restart automático ante umbrales críticos.
- Upstash Redis free tier tiene límite de 10.000 comandos/día y 256 MB. BullMQ genera varios comandos Redis por job (enqueue, lock, acknowledge, cleanup). Monitorizar a partir de 6.000 comandos/día.
- La concurrencia del worker debe configurarse conservadoramente (máximo 2-3 jobs simultáneos) para no saturar la cuota de la API del LLM ni los límites de conexiones a PostgreSQL en el tier gratuito de Supabase.

---

### Límites de infraestructura relevantes para el MVP

| Servicio            | Límite gratuito                      | Umbral de alerta                         |
| ------------------- | ------------------------------------ | ---------------------------------------- |
| Upstash Redis       | 10.000 comandos/día, 256 MB          | > 6.000 comandos/día                     |
| Supabase PostgreSQL | 500 MB almacenamiento, 2 proyectos   | > 400 MB                                 |
| Fly.io free tier    | 3 VMs compartidas, 256 MB RAM por VM | Monitorizar heap del proceso             |
| Claude API          | Sin límite gratuito; costo por token | Configurar alerta de presupuesto mensual |

---

## ADR-006 · Confiabilidad del Guardado: Write-with-Confirmation + Retry

**Status:** Accepted

### Contexto

La confianza es el valor central del producto. Los fallos en la persistencia sobre la planilla (permisos revocados, errores de red, cambios de estructura) deben ser comunicados claramente al usuario, ofreciendo caminos de resolución. El fallo silencioso está explícitamente prohibido (E1-US-12). Adicionalmente, el usuario debe poder deshacer el último registro (E1-US-11), lo que requiere conocer la referencia exacta de fila tras cada escritura.

### Decisión

Se implementa el patrón **Write-with-Confirmation** con **retry persistido** y **fallback manual**.

**Flujo de guardado exitoso:**

1. El Servicio de Planilla ejecuta `appendRow()` y espera la respuesta de la API (Google/Microsoft).
2. La respuesta incluye el índice de fila resultante.
3. Solo si la respuesta es exitosa, el sistema persiste internamente la referencia `{ userId, sheetName, rowIndex }` como "último registro" (necesario para E1-US-11 — deshacer).
4. El mensaje de confirmación se construye con esa referencia y se envía al usuario: `"✅ Guardado en Gastos, fila 47"`.

**Flujo de guardado fallido:**

- Los datos del gasto se mantienen en el estado `EXPENSE_SAVING_RETRY` con TTL de 10 minutos.
- El sistema distingue tres tipos de error y responde de forma diferente a cada uno:

| Tipo de error     | Causa                                               | Acción del sistema                                     |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `NETWORK_ERROR`   | Timeout o error de red hacia la API                 | Reintento automático con backoff exponencial           |
| `AUTH_ERROR`      | Token expirado o permisos revocados (HTTP 401/403)  | Notificación al usuario con enlace de re-autenticación |
| `STRUCTURE_ERROR` | Columna o hoja no encontrada (mapeo desactualizado) | Notificación al usuario con instrucciones de re-mapeo  |

- Si el guardado falla definitivamente, el bot envía el gasto formateado al usuario para que pueda copiarlo y pegarlo manualmente, garantizando que la información nunca se pierda.

### Alternativas descartadas

| Alternativa                         | Motivo de descarte                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Fire-and-forget (sin confirmación)  | El sistema no sabría si el guardado fue exitoso ni en qué fila quedó, imposibilitando E1-US-11 y violando E1-US-12. |
| Confirmación sin referencia de fila | Cumple E1-US-10 parcialmente pero impide la operación de deshacer (E1-US-11).                                       |

### Consecuencias

**Positivas**

- Cero pérdida de datos: el estado `EXPENSE_SAVING_RETRY` con TTL garantiza que los datos sobreviven fallos temporales.
- Refuerza la percepción de fiabilidad del sistema: el usuario siempre recibe feedback, nunca silencio.
- La referencia persistida al último registro hace que E1-US-11 (deshacer) sea una eliminación determinista por índice, sin ambigüedad.
- Evita "callejones sin salida" en la UX: cada tipo de error ofrece una ruta de resolución.

**Negativas**

- Requiere mayor esfuerzo de desarrollo en la lógica de manejo de excepciones y diseño de mensajes de error.
- La clasificación de errores debe mantenerse sincronizada con los códigos de respuesta reales de las APIs de Google y Microsoft, que pueden cambiar.

---

## ADR-007 · Seguridad: Almacenamiento de Tokens OAuth con AES-256

**Status:** Accepted

### Contexto

Gastto actúa en nombre del usuario sobre sus archivos personales en Google Drive y OneDrive. Para ello, almacena tokens de acceso y refresh OAuth 2.0 de ambos proveedores. Estos tokens son credenciales de alto valor: su exposición permitiría a un atacante acceder a los archivos del usuario y potencialmente a otros servicios del mismo proveedor. Su gestión segura es un requisito no negociable.

### Decisión

Se implementa una **estrategia de almacenamiento cifrado de tokens** con las siguientes garantías:

- **Cifrado en reposo:** los tokens de acceso y refresh se almacenan cifrados en base de datos utilizando **AES-256**. Nunca se persisten en texto plano.
- **No exposición:** el token nunca se incluye en logs, respuestas de API, mensajes al usuario ni variables de entorno de la aplicación. La clave de cifrado se gestiona como secreto de infraestructura (variable de entorno en el servidor de Fly.io, o secret manager externo).
- **Refresh transparente:** si el access token expira durante una operación, el sistema utiliza el refresh token de forma transparente para obtener uno nuevo, sin interrumpir al usuario ni requerir re-autenticación.
- **Revocación explícita:** si el sistema detecta un `AUTH_ERROR` (HTTP 401/403) que no se resuelve con el refresh token, concluye que los permisos fueron revocados por el usuario y le notifica solicitando re-autenticación (coordinado con ADR-006).

### Alternativas descartadas

| Alternativa                                        | Motivo de descarte                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Almacenamiento en texto plano en BD                | Exposición directa de credenciales ante cualquier dump de base de datos o acceso no autorizado. Inaceptable.                             |
| Almacenamiento en Redis                            | Redis no ofrece cifrado en reposo por defecto. Además, Redis se reinicia y los tokens se perderían, forzando re-autenticación frecuente. |
| Almacenamiento en variables de entorno del proceso | No escala a múltiples usuarios. Las variables de entorno son por proceso, no por usuario.                                                |

### Consecuencias

**Positivas**

- Protección de credenciales ante brechas de base de datos: un dump sin la clave AES es inútil.
- El refresh transparente mejora la experiencia de usuario: no se interrumpe el flujo por expiración de token.
- Alineación con las guías de seguridad de OAuth 2.0 de Google y Microsoft.

**Negativas**

- Requiere gestión segura de la clave AES-256: si la clave se compromete, todos los tokens almacenados quedan expuestos. Se recomienda rotación periódica de clave con re-cifrado.
- La doble integración OAuth (Google + Microsoft) duplica la superficie de autenticación y los casos de prueba de seguridad desde el MVP.
- Añade complejidad en el flujo de onboarding: cada proveedor tiene su propio flujo de consentimiento OAuth con scopes distintos.

---

## ADR-008 · Identidad de Usuario: Registro Local con `userId` Propio

**Status:** Accepted

### Contexto

Gastto recibe mensajes a través de canales de mensajería externos (Telegram y WhatsApp Business API). Cada canal provee su propio identificador de conversación: Telegram usa un `chat_id` numérico; WhatsApp usa el número de teléfono del usuario. Sin embargo, depender de estos identificadores externos como clave primaria de usuario introduce fricciones significativas a mediano plazo:

- Un mismo usuario podría interactuar con Gastto desde Telegram y desde WhatsApp, generando dos identidades desconectadas con la misma planilla y el mismo historial.
- Si en el futuro se agrega un canal nuevo (webchat, app móvil propia, frontend web), el sistema necesitaría migrar todos los registros asociados al identificador externo anterior.
- Los tokens OAuth (ADR-007), el mapeo de columnas (ADR-004) y el estado conversacional (ADR-003) se almacenan en PostgreSQL y ya referencian implícitamente un `userId` interno. Sin una entidad `User` explícita, estas referencias flotan sin un ancla estable.

Se necesita una decisión explícita sobre cómo se modela la identidad de usuario en el sistema antes de redactar las primeras Historias de Usuario, dado que afecta directamente el esquema de base de datos y la lógica de resolución de identidad en el Gateway de mensajería.

### Decisión

Cada usuario de Gastto tiene un **registro propio en PostgreSQL** representado por una entidad `User` con un `userId` interno de tipo UUID, generado por el sistema en el primer contacto.

**Modelo de datos:**

```typescript
// Entidad principal
User {
  userId: UUID          // identificador primario interno, generado por el sistema
  createdAt: timestamp
  status: 'active' | 'onboarding' | 'suspended'
}

// Identidades de mensajería (relación 1:N con User)
MessagingIdentity {
  id: UUID
  userId: UUID          // FK → User.userId
  channel: 'telegram' | 'whatsapp'
  externalId: string    // chat_id de Telegram o número E.164 de WhatsApp
  linkedAt: timestamp
}
```

**Resolución de identidad en el Gateway:** cuando llega un webhook, el Gateway extrae el `channel` y el `externalId` del mensaje entrante, consulta la tabla `MessagingIdentity` para obtener el `userId` correspondiente y lo pasa al Orquestador. Si no existe una `MessagingIdentity` para ese par `(channel, externalId)`, el sistema crea un nuevo `User` y una nueva `MessagingIdentity` vinculada, iniciando el flujo de onboarding.

**Relación con ADRs existentes:**

| ADR                                | Impacto                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| ADR-003 (FSM en PostgreSQL)        | El estado conversacional referencia `userId` interno, no `chat_id`.        |
| ADR-004 (Adapter Pattern)          | El `MappingConfig` por usuario se asocia al `userId` interno.              |
| ADR-006 (Write-with-Confirmation)  | La referencia `{ userId, sheetName, rowIndex }` usa el `userId` interno.   |
| ADR-007 (Tokens OAuth con AES-256) | Los tokens de acceso y refresh se almacenan asociados al `userId` interno. |

### Alternativas descartadas

| Alternativa                                    | Motivo de descarte                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Usar `chat_id` de Telegram como clave primaria | No es portable entre canales. Un mismo usuario en Telegram y WhatsApp generaría dos registros desconectados con configuraciones duplicadas. Impide la multicanalidad futura sin migración estructural. |
| Usar el número de teléfono como clave primaria | Supone que Telegram y WhatsApp comparten el mismo número, lo cual no es garantía (cuentas de empresa, números distintos por canal). Además, expone un dato personal como clave técnica.                |
| No modelar una entidad `User` explícita        | Los ADRs 003, 004, 006 y 007 ya referencian un `userId` implícito. No formalizar la entidad deja esas referencias sin ancla, generando inconsistencias en el esquema y dificultando la auditoría.      |

### Consecuencias

**Positivas**

- El `userId` interno es estable ante cambios de canal, número de teléfono o incorporación de nuevos canales de mensajería.
- La separación entre identidad de mensajería e identidad de sistema permite que un mismo usuario vincule múltiples canales en el futuro sin migración de datos.
- Consistencia con los ADRs existentes: los módulos de Estado (ADR-003), Planilla (ADR-004) y Seguridad (ADR-007) ya operan sobre un `userId` interno; este ADR lo formaliza.
- Si en el futuro se agrega un frontend propio (web o móvil) con autenticación por email/password o SSO, basta con agregar una nueva `MessagingIdentity` de tipo `'web'` asociada al mismo `userId`. No hay refactor estructural.
- Facilita la auditoría y el soporte: todos los registros de un usuario (estado, mapeo, tokens, gastos) se pueden recuperar desde un único `userId`.

**Negativas**

- Introduce una consulta adicional en el Gateway por cada mensaje entrante (lookup de `MessagingIdentity`). Mitigación: cachear la resolución `(channel, externalId) → userId` en Redis (Upstash) con TTL razonable (24h), compartiendo la misma instancia Redis que usa BullMQ como broker (ADR-005).
- Agrega dos tablas al esquema de base de datos (`users`, `messaging_identities`) que deben gestionarse desde el primer sprint, aunque su lógica es simple.
- El onboarding debe contemplar el caso de un usuario que ya existe en otra `MessagingIdentity` (mismo teléfono, otro canal). Para el MVP este caso está fuera de scope: cada `(channel, externalId)` genera un `User` independiente. La vinculación de cuentas entre canales queda diferida al Backlog.

---

## ADR-009 · Runtime: Servidor Node.js Persistente con Fastify

**Status:** Accepted

### Contexto

El stack inicial del proyecto listaba Next.js como framework base sin un ADR que justificara esa decisión. El análisis posterior reveló una contradicción estructural: Next.js desplegado en Vercel opera como funciones serverless efímeras con un timeout máximo de 60 segundos, mientras que los requerimientos del producto exigen procesos de larga duración que ese modelo no puede satisfacer.

Los requerimientos concretos que hacen incompatible el modelo serverless con Gastto son los siguientes:

- BullMQ requiere un proceso Node.js persistente con conexión activa a Redis. No puede operar en funciones efímeras.
- Los timeouts conversacionales de la FSM (10 minutos en `EXPENSE_REVIEW`, 30 minutos en `HU-0.04`) requieren un scheduler que sobreviva entre invocaciones HTTP.
- La cola de gastos de E1-US-13 procesa mensajes en orden estricto con estado compartido entre turnos de conversación.
- La Épica 3 (Release 2) introduce alertas periódicas y resúmenes automáticos que requieren jobs programados con resolución de segundos, no de minutos.

El único argumento real a favor de serverless era el costo cero de Vercel. Ese argumento cae cuando se evalúa que Fly.io ofrece un tier gratuito con proceso siempre activo, sin cold starts y con región configurable, suficiente para el volumen esperado en MVP.

Adicionalmente, Next.js introduce un peso de toolchain (React, bundling de frontend, App Router, Server Components) que no aporta valor en un sistema sin interfaz web, y cuyas convenciones de estructura de carpetas entran en conflicto con la Clean Architecture definida en ADR-001.

### Decisión

Gastto es un **servidor Node.js persistente** construido con **Fastify** como framework HTTP, desplegado en **Fly.io** en su tier gratuito para el MVP.

Next.js queda descartado del stack. No existe frontend en el MVP y ningún requerimiento de Release 1 o Release 2 lo justifica.

La estructura de carpetas sigue directamente la Clean Architecture de ADR-001, sin restricciones impuestas por convenciones de framework:

```
src/
  domain/          # Entidades, value objects, interfaces de puerto
  application/     # Casos de uso, servicios de aplicación, FSM
  infrastructure/  # Adapters: DB, Redis, Telegram, WhatsApp, Sheets, LLM
  interfaces/      # Handlers HTTP (Fastify routes), workers BullMQ
```

Fastify se elige sobre Express por tres razones concretas: validación de esquemas nativa con JSON Schema integrado (complementa a Zod en la capa de aplicación), rendimiento superior en throughput de webhooks concurrentes, y soporte nativo de TypeScript sin configuración adicional.

El deployment en Fly.io utiliza un único proceso que levanta tanto el servidor HTTP como los workers de BullMQ en el mismo runtime, manteniendo la topología de monolito modular de ADR-001.

### Alternativas descartadas

| Alternativa                                   | Motivo de descarte                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js en Vercel (serverless)                | Incompatible con BullMQ, timeouts conversacionales y jobs periódicos. El modelo de funciones efímeras contradice los requerimientos de procesos de larga duración del producto.                     |
| Next.js en servidor dedicado (sin serverless) | Elimina la contradicción técnica pero mantiene el peso de toolchain de frontend sin ningún beneficio. La estructura de carpetas de Next.js sigue conflictuando con Clean Architecture.              |
| Express.js                                    | Viable técnicamente. Se descarta frente a Fastify por ausencia de validación de esquemas nativa, peor soporte TypeScript out-of-the-box y menor rendimiento en benchmarks de webhooks concurrentes. |
| Next.js + worker separado en segundo servicio | Introduce exactamente la complejidad de infraestructura multi-servicio que ADR-001 rechazó. Dos servicios que coordinar, dos deploys, dos puntos de fallo.                                          |
| Render (free tier)                            | Suspende el proceso tras 15 minutos de inactividad. Un cold start de 30 segundos es incompatible con el SLA de acuse de recibo de 300ms definido en ADR-005.                                        |

### Consecuencias

**Positivas**

- BullMQ opera en su modelo nativo: proceso persistente con conexión activa a Redis, sin workarounds ni brokers HTTP intermedios. ADR-005 implementa su decisión sin contradicciones.
- Los timeouts conversacionales de la FSM se implementan con jobs BullMQ con delay, viables en proceso persistente.
- La estructura de carpetas de Clean Architecture se implementa sin restricciones impuestas por el framework.
- Sin toolchain de frontend: sin React, sin bundler, sin configuración de transpilación de cliente. El proyecto compila y arranca más rápido.
- Fly.io mantiene el proceso activo sin cold starts en tier gratuito, garantizando el SLA de 300ms de acuse de recibo.
- La migración futura a un servidor dedicado o a contenedores propios es trivial: el `Dockerfile` que Fly.io ya requiere es el artefacto de deploy.

**Negativas**

- Se pierde la integración automática de Vercel con GitHub (preview deployments por PR). Mitigación: GitHub Actions con deploy a Fly.io en merge a main, que es configuración estándar de una hora.
- Fly.io free tier tiene límite de 3 VMs compartidas y 256 MB de RAM por VM. Para el volumen esperado en MVP es suficiente, pero debe monitorearse conforme crezca el número de usuarios concurrentes.
- El equipo que conocía Next.js necesita familiarizarse con Fastify. La curva es baja dado que ambos son frameworks HTTP con TypeScript, pero existe.
- La responsabilidad de mantenimiento del servidor (actualizaciones de dependencias, configuración de Fly.io) recae en el equipo, a diferencia del modelo gestionado de Vercel.

---

## ADR-010 · Infraestructura: Despliegue Multi-Ambiente en Fly.io

**Status:** Accepted

### Contexto

A medida que el equipo crece y las funcionalidades se estabilizan, se hace necesario contar con un entorno de staging aislado donde probar cambios antes de promoverlos a producción. El despliegue único sobre `main` obliga a validar todas las modificaciones directamente en el entorno productivo, incrementando el riesgo de regresiones visibles por los usuarios finales.

Además, el proyecto maneja secretos sensibles (tokens de bots, claves de API, credenciales de base de datos) que deben rotarse y gestionarse de forma independiente por ambiente. Compartir un único conjunto de secretos entre producción y desarrollo viola el principio de mínimo privilegio y dificulta la rotación segura.

La infraestructura actual consiste en un único `Dockerfile` de una etapa, un `fly.toml` que expone el puerto `8080` y un workflow de GitHub Actions que solo escucha `main`. Estos artefactos deben evolucionar para soportar dos ambientes operativos con costo y complejidad controlados.

### Decisión

Se adopta un modelo de **despliegue multi-ambiente sobre Fly.io** con las siguientes decisiones operativas:

**Dos aplicaciones Fly.io independientes**

- `gastto` → ambiente de producción, desplegada desde la rama `main`.
- `gastto-develop` → ambiente de desarrollo (staging), desplegada desde la rama `develop`.

Cada app tiene su propio conjunto de secretos en Fly.io, su propio bot de Telegram y su propia base de datos (o esquema), garantizando aislamiento total.

**Despliegue automático vía GitHub Actions**

El workflow `.github/workflows/fly-deploy.yml` se actualiza para escuchar pushes en `main` y `develop`. Cada rama dispara el despliegue correspondiente mediante pasos condicionales (`if: github.ref == 'refs/heads/...'`), utilizando tokens de API de Fly.io distintos (`FLY_API_TOKEN` y `FLY_API_TOKEN_DEVELOP`). Se mantiene `concurrency: deploy-group` para evitar deploys concurrentes.

**Configuración y secretos en Fly.io, no en GitHub**

Toda la configuración específica de ambiente (incluyendo variables sensibles) se almacena como secretos de Fly.io por app. GitHub Actions solo almacena los tokens de Fly.io necesarios para autenticar el despliegue. Esto simplifica la rotación de credenciales: un único `flyctl secrets set` por app, sin modificar el repositorio.

**Un bot de Telegram por ambiente**

Para evitar colisiones de webhooks y aislar el tráfico de prueba, cada ambiente utiliza su propio bot de Telegram. El bot de desarrollo se registra con el webhook apuntando a `gastto-develop.fly.dev`.

**Dockerfile multi-etapa con pnpm**

El `Dockerfile` se reescribe como construcción multi-etapa:

- Etapa `builder`: instala todas las dependencias (incluyendo dev), compila con `pnpm build` y genera `dist/main.js`.
- Etapa `runner`: copia únicamente `dist/` e instala solo dependencias de producción con `pnpm install --prod --frozen-lockfile`.

Esto reduce drásticamente el tamaño de la imagen final al excluir devDependencies y herramientas de compilación.

**Puerto unificado: 3000**

Se alinea el puerto expuesto en el `Dockerfile`, `fly.toml`, `fly.develop.toml` y el default de `env.schema.ts` a `3000`. Antes, el `Dockerfile` exponía `8080` mientras la aplicación arrancaba en `3000` por defecto, lo que provocaba fallos de ruteo si Fly.io no inyectaba explícitamente `PORT=8080`.

**Recursos ajustados al free tier**

Cada VM se configura con:

- `memory = '256mb'`
- `cpu_kind = 'shared'`
- `cpus = 1`

Esto mantiene el consumo dentro de los límites del tier gratuito de Fly.io (3 VMs compartidas, 256 MB cada una).

**`auto_stop_machines = true` (configuración temporal)**

Ambos archivos `fly.toml` y `fly.develop.toml` configuran `auto_stop_machines = true` y `min_machines_running = 0`. Esta configuración es segura mientras no haya workers de BullMQ ejecutándose en segundo plano. Cuando se introduzcan workers (per ADR-009), `auto_stop_machines` **debe cambiarse a `false`** para evitar que Fly.io detenga la VM mientras hay jobs pendientes en la cola.

### Alternativas descartadas

| Alternativa                                                   | Motivo de descarte                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Una sola app con preview deployments (similares a Vercel)     | Fly.io no ofrece preview deployments nativos por rama. Emularlos con máquinas efímeras añade complejidad operativa comparable a tener dos apps permanentes, pero sin el beneficio del aislamiento completo de secretos y base de datos.        |
| Almacenar variables de entorno en GitHub repository variables | GitHub variables no están encriptadas con el mismo nivel que Fly.io secrets. Además, obligarían a re-desplegar solo para rotar una clave de API. Fly.io secrets permiten rotación inmediata sin tocar el repo.                                 |
| Compartir un único bot de Telegram entre ambiente             | Los webhooks de Telegram solo permiten una URL por bot. Compartirlo obligaría a re-registrar el webhook en cada deploy, con riesgo de que mensajes de producción lleguen al ambiente de desarrollo y viceversa.                                |
| Mantener el puerto 8080                                       | Mantener `8080` en Fly.io mientras la aplicación escucha en `3000` por defecto requiere que Fly.io inyecte siempre `PORT=8080`. Si esa variable falta, el deploy falla silenciosamente. Unificar a `3000` elimina esta dependencia implícita.  |
| Conservar el Dockerfile de una sola etapa                     | La imagen resultante incluye todas las devDependencies (TypeScript, ESLint, Vitest, etc.), aumentando el tamaño final y la superficie de ataque. La construcción multi-etapa es estándar en la industria y no añade complejidad significativa. |

### Consecuencias

**Positivas**

- Aislamiento completo entre producción y staging: un error en `develop` no afecta a los usuarios de producción.
- Despliegue automático y branch-based: mergear a `main` o `develop` despliega automáticamente sin intervención manual.
- Imagen Docker significativamente más pequeña gracias a la construcción multi-etapa, reduciendo tiempos de despliegue y uso de disco en Fly.io.
- Rotación de secretos simplificada: cambios de credenciales se hacen directamente en Fly.io sin commits al repositorio.
- Costo controlado: ambas apps corren dentro del free tier de Fly.io (3 VMs compartidas, 256 MB cada una).

**Negativas**

- Sobrecarga operativa de gestionar dos conjuntos de secretos independientes.
- Necesidad de crear y mantener un segundo bot de Telegram para el ambiente de desarrollo.
- Consumo duplicado de recursos del free tier (dos apps en lugar de una), lo que reduce la capacidad disponible para futuras VMs o workers.
- El cambio de `auto_stop_machines` a `false` cuando lleguen los workers de BullMQ es un paso manual que debe recordarse; se documenta con comentarios en ambos `fly.toml`.

---

## ADR-011 · Pipeline de Dos Colas para Orden FIFO

**Status:** Accepted

### Contexto

ADR-005 introdujo un pipeline asíncrono de dos etapas (webhook → worker BullMQ `process-message`) que cumple el SLA de acuse ≤ 1s y el procesamiento LLM de 2–5s. Sin embargo, ese pipeline no garantiza ordenamiento FIFO por usuario.

Cuando un usuario envía varios mensajes en rápida sucesión, la cola `process-message` con `concurrency: 2` puede procesarlos desordenados, violando la coherencia conversacional.

### Decisión

Se adopta un **pipeline de tres etapas** extendiendo ADR-005:

1. **Webhook (Fastify)** — Valida origen, parsea payload, short-circuita `MALFORMED` (logs + 200) y `/start` (síncrono), encola todo lo demás a `incoming-message`.
2. **Thin Worker (`incoming-message`)** — `concurrency: 1`. Garantiza FIFO por usuario. Deserializa el job y llama a `RouteIncomingMessage.execute()`.
3. **Thick Worker (`process-message`)** — `concurrency: 2`. Procesamiento FSM/LLM/gasto existente de ADR-005.

La cola `process-message` y su worker permanecen sin cambios.

### Alternativas descartadas

| Alternativa                                                | Motivo de descarte                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cola única `process-message` con `concurrency: 1`          | Bloquea el procesamiento LLM pesado para todos los usuarios si un job es lento. Rechazado.                            |
| Procesamiento síncrono en orden dentro del handler Fastify | Viola el SLA de acuse ≤ 1s si la resolución de identidad o cualquier handler downstream es lento. Rechazado.          |
| BullMQ Pro Groups                                          | Requiere licencia paga de BullMQ Pro. Overkill para el MVP. Rechazado por ahora; anotado como path de upgrade futuro. |

### Consecuencias

**Positivas**

- FIFO estricto por usuario garantizado por el thin worker.
- El thick worker puede escalar independientemente (`concurrency: 2` o mayor).
- Separación clara de capas: webhook (Interfaces) → router (Application) → FSM/NLP (Application + Infrastructure).
- El log de payloads malformados se movió a la capa de ruta donde el contexto de request (`req.log`) está disponible.

**Negativas**

- Dos colas y dos workers añaden complejidad operativa.
- El mensaje de acuse ("Recibido, procesando tu gasto…") ahora se envía de forma asíncrona desde el worker en lugar de síncronamente desde el webhook. Añade una pequeña demora (< 100ms en la práctica) pero se mantiene bien bajo el SLA de 1s.
- `concurrency: 1` en el thin worker es un cuello de botella si el volumen de mensajes entrantes excede algunas docenas por segundo. Mitigación: monitorear profundidad de cola y migrar a BullMQ Pro Groups o una estrategia de partición por hash de `chat_id` cuando sea necesario.

---

## Resumen de Decisiones

| ADR     | Decisión                                                                                                                          | Status   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| ADR-001 | Monolito Modular con cinco módulos internos (Gateway, Orquestador, Motor NLP, Servicio Planilla, Store de Estado)                 | Accepted |
| ADR-002 | LLM (`claude-sonnet-4-6`) con extracción estructurada JSON vía prompt engineering                                                 | Accepted |
| ADR-003 | FSM con 13 estados persistida en PostgreSQL; Redis solo para caché y broker de cola BullMQ                                        | Accepted |
| ADR-004 | Adapter Pattern con interfaz `SpreadsheetPort` y adapters independientes por proveedor                                            | Accepted |
| ADR-005 | Pipeline asíncrono con BullMQ sobre Redis; acuse < 300ms en Fastify, procesamiento < 5s en worker persistente                     | Accepted |
| ADR-006 | Write-with-Confirmation con clasificación de tres tipos de error y fallback manual                                                | Accepted |
| ADR-007 | Tokens OAuth cifrados con AES-256 en BD, refresh transparente, nunca en texto plano                                               | Accepted |
| ADR-008 | Registro local de usuario con `userId` UUID propio; identidad de mensajería como atributo separado (tabla `messaging_identities`) | Accepted |
| ADR-009 | Servidor Node.js persistente con Fastify desplegado en Fly.io; Next.js descartado                                                 | Accepted |
| ADR-010 | Despliegue multi-ambiente en Fly.io con apps `gastto` y `gastto-develop`, Dockerfile multi-etapa y puerto unificado 3000          | Accepted |
| ADR-011 | Pipeline de dos colas para orden FIFO con thin worker (`incoming-message`, `concurrency: 1`) y thick worker (`process-message`)   | Accepted |

---

_Gastto ADR Pack · Release 1 MVP · Pendiente de aceptación formal del equipo de engineering._

---
