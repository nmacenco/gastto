
**Historia de usuario**

> Como usuario que acaba de enviar un mensaje con un gasto, quiero recibir una señal visual o textual de que el sistema lo recibió en menos de un segundo, para no quedar en la incertidumbre ni reenviar el mensaje por error.

---

**Criterios de aceptación**

Feature: Acuse de recibo inmediato al recibir un mensaje

  Scenario: Flujo feliz — mensaje recibido dentro del tiempo límite
    Given que el usuario envió un mensaje describiendo un gasto
    When el sistema lo recibe
    Then el sistema envía un acuse de recibo en ≤ 1 segundo
    And el acuse es un mensaje breve y no invasivo (ej: "Recibido, procesando tu gasto…")
    And no bloquea al usuario para enviar otro mensaje mientras espera

  Scenario: Carga alta — el sistema tarda más de 1 segundo en procesar
    Given que el sistema está bajo carga elevada
    When el usuario envía un mensaje
    Then el acuse de recibo se envía de todos modos en ≤ 1 segundo
    And el procesamiento de interpretación continúa en segundo plano
    And el usuario recibe el resumen interpretado cuando esté listo, sin reenvíos solicitados

  Scenario: El sistema no puede acusar recibo (fallo total de conectividad)
    Given que el sistema pierde la conexión con el canal de mensajería
    When el usuario envía un mensaje
    Then el sistema no envía acuse de recibo
    And cuando la conexión se restablece, el sistema evalúa si el mensaje quedó pendiente de procesamiento
    And no genera un registro duplicado

**Definición de Done**

- El tiempo de acuse de recibo está medido en entorno de staging y cumple ≤ 1 segundo en el percentil 95.
- El acuse de recibo es un mensaje diferenciado visualmente del resumen final (no se confunden).
- El flujo de procesamiento es asíncrono: el acuse no bloquea la interpretación ni viceversa.
- Existe un mecanismo de idempotencia que evita procesar el mismo mensaje dos veces si llega duplicado.

**Story Points: 2**

> La funcionalidad es concreta y acotada: enviar un mensaje en ≤ 1 segundo. La complejidad reside en garantizar la asincronía y la idempotencia, pero no involucra lógica de negocio compleja. No tiene ramificaciones de flujo significativas.

**Dependencias**

- E1-US-01: el mensaje debe estar llegando correctamente al sistema.
- Infraestructura de mensajería asíncrona operativa (cola de mensajes o equivalente).