
**Como** sistema, **quiero** poder enviar mensajes de texto de vuelta al usuario por Telegram, **para** que todas las respuestas de FinFlow lleguen al chat del usuario de forma confiable.

### Criterios de Aceptación (Gherkin)

Escenario 1: Envío exitoso de mensaje simple
  Dado que el sistema necesita responder a un usuario
  Cuando llama al módulo de envío con chat_id y texto
  Entonces el mensaje aparece en el chat del usuario en menos de 2 segundos
  Y el sistema registra el envío como exitoso

Escenario 2: Mensaje largo (más de 4096 caracteres)
  Dado que el sistema genera una respuesta que supera el límite de Telegram
  Cuando intenta enviarla
  Entonces la divide automáticamente en fragmentos coherentes
  Y los envía en secuencia al mismo chat

Escenario 3: Fallo en el envío — reintento automático
  Dado que el sistema intenta enviar un mensaje
  Cuando la API de Telegram devuelve error 5xx
  Entonces el sistema reintenta hasta 3 veces con backoff de 1, 2 y 4 segundos
  Y si los 3 reintentos fallan, registra el fallo en el log con chat_id y contenido

Escenario 4: chat_id inválido o usuario bloqueó el bot
  Dado que el sistema intenta enviar a un chat_id que ya no es válido
  Cuando la API de Telegram devuelve error 403 o 400
  Entonces el sistema registra el caso sin reintentar
  Y no genera excepción que afecte otros procesos


### Definición de Done

- [ ]  El módulo de envío es una función/servicio reutilizable por todas las épicas
- [ ]  El límite de 4096 caracteres tiene manejo automático de división
- [ ]  El retry con backoff exponencial está implementado (3 intentos)
- [ ]  Los errores 403/400 tienen manejo diferenciado (no reintento)
- [ ]  Todos los envíos quedan loggeados con timestamp, chat_id y resultado
- [ ]  Tests unitarios cubren envío exitoso, mensaje largo, retry y error permanente

**Story Points: 2** _Justificación: La API de envío de Telegram es simple. La complejidad está en el retry, la división de mensajes largos y el logging. No hay lógica de negocio, solo infraestructura de comunicación._

**Dependencias:** HU-0.01