
### Historia de usuario

Como usuario que envía varios gastos en mensajes separados y rápidos, quiero que el sistema los encole en orden y me avise cuántos tengo pendientes al terminar cada confirmación, para poder registrarlos todos sin perder ninguno y sin tener que esperar entre mensaje y mensaje.

> **Nota de alcance:** Esta historia cubre exclusivamente gastos enviados como mensajes de texto independientes en rápida sucesión. El registro de múltiples gastos en un único mensaje es un caso de uso distinto cubierto en Release 2. El límite de cola es 2 gastos pendientes además del activo (3 en total). Si se supera ese límite, el sistema bloquea nuevos ingresos y notifica al usuario.

---

### Criterios de aceptación

```gherkin
Feature: Cola de gastos pendientes con aviso de procesamiento secuencial

  Background:
    Given que el usuario tiene FinFlow activo en su canal de mensajería
    And la planilla del usuario está vinculada y configurada
    And no hay ningún flujo de registro activo al inicio

  # ─── FLUJO FELIZ ────────────────────────────────────────────────────────

  Scenario: El usuario envía tres gastos en mensajes separados antes de confirmar el primero
    Given que el sistema no tiene ningún gasto en cola ni activo
    When el usuario envía "gasté 10 pesos en comida"
    Then el sistema acusa recibo en ≤ 1 segundo
    And procesa el primer gasto y presenta su resumen
    And el estado del usuario pasa a EXPENSE_REVIEW

    When el usuario envía "3 pesos en transporte" antes de confirmar el primero
    Then el sistema acusa recibo en ≤ 1 segundo
    And encola el segundo gasto sin interrumpir el flujo activo
    And no presenta el resumen del segundo gasto todavía

    When el usuario envía "5 en un helado" antes de confirmar el primero
    Then el sistema acusa recibo en ≤ 1 segundo
    And encola el tercer gasto
    And la cola tiene ahora 2 gastos pendientes (máximo permitido)

    When el usuario confirma el primer gasto con "sí"
    Then el sistema guarda el primer gasto y envía la confirmación de ubicación
    And a continuación envía el aviso de cola:
      """
      Tenés 2 gastos pendientes. Vamos con el siguiente:
      """
    And presenta inmediatamente el resumen del segundo gasto para revisión
    And el estado del usuario pasa a EXPENSE_REVIEW para el segundo gasto

  Scenario: El usuario cancela el gasto activo con gastos pendientes en cola
    Given que el usuario tiene 1 gasto en revisión y 1 gasto en cola
    When el usuario cancela el gasto activo con "cancelar"
    Then el sistema descarta el gasto activo sin guardarlo
    And envía:
      """
      Registro cancelado. Tenés 1 gasto pendiente. Vamos con el siguiente:
      """
    And presenta el resumen del gasto que estaba en cola
    And el estado del usuario pasa a EXPENSE_REVIEW para ese gasto

  Scenario: El usuario procesa y confirma todos los gastos en cola de forma secuencial
    Given que el usuario tiene 1 gasto en revisión y 2 gastos en cola
    When el usuario confirma el gasto activo
    Then el sistema guarda el gasto y notifica la ubicación
    And presenta el siguiente gasto de la cola con el aviso correspondiente
    When el usuario confirma ese gasto
    Then el sistema guarda el gasto y notifica la ubicación
    And presenta el último gasto de la cola
    When el usuario confirma ese gasto
    Then el sistema guarda el gasto y notifica la ubicación
    And envía un mensaje de cierre:
      """
      ¡Listo! Registré los 3 gastos. No tenés más pendientes.
      """
    And el estado del usuario vuelve a IDLE

  # ─── LÍMITE DE COLA ─────────────────────────────────────────────────────

  Scenario: El usuario intenta enviar un cuarto gasto cuando la cola está llena
    Given que el usuario tiene 1 gasto en revisión y 2 gastos en cola (límite alcanzado)
    When el usuario envía un nuevo mensaje de gasto
    Then el sistema NO encola el nuevo mensaje
    And responde:
      """
      Ya tenés 3 gastos en proceso. Confirmá o cancelá el actual antes de agregar más.
      """
    And el nuevo mensaje de gasto se descarta sin guardarse
    And el flujo activo no se interrumpe

  Scenario: El usuario envía un quinto gasto después de que la cola se libera
    Given que el usuario tenía la cola llena y acaba de confirmar el gasto activo
    And la cola ahora tiene 1 gasto pendiente (por debajo del límite)
    When el usuario envía un nuevo mensaje de gasto
    Then el sistema lo encola sin problema
    And acusa recibo normalmente

  # ─── MENSAJES NO FINANCIEROS CON COLA ACTIVA ────────────────────────────

  Scenario: El usuario envía un mensaje no financiero mientras hay gastos en cola
    Given que el usuario tiene 1 gasto en revisión y 1 gasto en cola
    And el sistema está esperando confirmación del gasto activo
    When el usuario envía "gracias"
    Then el sistema no interpreta el mensaje como confirmación ni corrección
    And responde recordando el estado actual:
      """
      Todavía tenés un gasto pendiente de confirmar y 1 más en cola.
      ¿Confirmamos, corregimos o cancelamos el actual?
      """
    And no modifica la cola ni el gasto activo

  Scenario: El usuario repite un mensaje no financiero por segunda vez consecutiva
    Given que el sistema ya envió el aviso de pendientes una vez
    When el usuario vuelve a enviar un mensaje no financiero sin responder al aviso
    Then el sistema repite el aviso con el mismo formato
    And no escala a ningún otro comportamiento ni cancela la cola

  # ─── TIMEOUT CON COLA ACTIVA ────────────────────────────────────────────

  Scenario: El usuario no responde al gasto activo y hay gastos en cola
    Given que el usuario tiene 1 gasto en revisión y 1 gasto en cola
    When pasan 10 minutos sin respuesta del usuario
    Then el sistema envía el recordatorio estándar de E1-US-06:
      """
      ¿Confirmamos el registro tal como está?
      """
    And añade al mismo mensaje:
      """
      (También tenés 1 gasto más en cola esperando.)
      """

  Scenario: El usuario no responde después del recordatorio con cola activa
    Given que el sistema ya envió el recordatorio de timeout con mención de cola
    When pasan otros 10 minutos sin respuesta
    Then el sistema cancela el gasto activo sin guardarlo
    And presenta automáticamente el siguiente gasto de la cola con el mensaje:
      """
      El registro anterior venció sin confirmación y fue cancelado.
      Vamos con el siguiente gasto pendiente:
      """
    And el estado del usuario pasa a EXPENSE_REVIEW para ese gasto

  # ─── DESHACER CON COLA ACTIVA ────────────────────────────────────────────

  Scenario: El usuario solicita deshacer mientras hay gastos en cola
    Given que el usuario acaba de confirmar un gasto y tiene 1 más en cola
    And el sistema ya presentó el resumen del siguiente gasto
    When el usuario envía "deshacer"
    Then el sistema interpreta "deshacer" como referido al último gasto guardado
    And pausa la presentación del gasto en cola
    And ejecuta el flujo estándar de E1-US-11 para el último gasto guardado
    And una vez completado el deshacer, retoma la presentación del gasto en cola
```

---

### Definición de Done

- El sistema encola mensajes de gasto entrantes cuando el usuario está en `EXPENSE_REVIEW`, `EXPENSE_CLARIFYING` o `EXPENSE_CORRECTING`, sin interrumpir el flujo activo.
- El límite de 2 gastos en cola (3 en total incluyendo el activo) está implementado y el mensaje de bloqueo está probado.
- El aviso de cola aparece siempre después del mensaje de confirmación de guardado o de cancelación, nunca antes ni durante el flujo activo.
- Los mensajes no financieros con cola activa generan el aviso de recordatorio; el comportamiento es idéntico en el segundo y sucesivo intento.
- El timeout de 10 minutos con cola activa cancela el gasto activo y avanza automáticamente al siguiente, sin perder los gastos en cola.
- La operación de deshacer pausa la cola, ejecuta el flujo de E1-US-11 y retoma la cola al completarse.
- Los gastos descartados por límite de cola no dejan rastro en ninguna capa del sistema.
- El mensaje de cierre ("Registré los N gastos") se envía únicamente cuando la cola queda vacía y el último gasto fue confirmado.
- Existe un test de integración que cubre el flujo completo de 3 gastos en cola procesados secuencialmente hasta `IDLE`.
- El comportamiento es consistente en WhatsApp y Telegram.

---

### Story Points: 8

La complejidad no está en ninguna pieza individual sino en la **intersección de la cola con todos los flujos ya definidos**: timeout, cancelación, corrección, deshacer y mensajes no financieros. Cada uno de esos flujos existentes tiene que saber que puede haber una cola activa y comportarse de forma coherente. Eso convierte esta historia en la más transversal del MVP hasta ahora. Se asigna 8 (en lugar de 5+5) porque es una única historia de infraestructura conversacional que no tiene sentido partir: su valor está en la consistencia del comportamiento completo, no en las piezas por separado.

---

### Dependencias

- **E1-US-01 a E1-US-12**: todos los flujos existentes son dependencias, porque esta historia modifica el comportamiento de cada uno cuando hay cola activa.
- **HU-0.04** (gestión de estado conversacional): la FSM debe extenderse con los estados `EXPENSE_QUEUE_ACTIVE` como flag transversal, o bien el modelo de estado debe soportar una cola por usuario como campo de primer nivel. Esta decisión de implementación debe tomarse antes de que esta HU entre a sprint — es el riesgo técnico principal.
- **E1-US-11** (deshacer): la interacción deshacer + cola debe estar coordinada explícitamente con el equipo que implemente E1-US-11.

---

### Nota de diseño para el equipo de arquitectura

El estado conversacional actual modela un único flujo activo por usuario. Esta historia introduce **concurrencia implícita** (múltiples gastos en distintas fases del mismo flujo) dentro del modelo de un único usuario. La solución más limpia es **no cambiar la FSM principal**, sino añadir una estructura de cola separada en el perfil del usuario:

```
user_state: {
  active_flow: { state: EXPENSE_REVIEW, data: {...} },
  expense_queue: [
    { received_at: timestamp, raw_message: "3 pesos en transporte" },
    { received_at: timestamp, raw_message: "5 en un helado" }
  ]
}
```

Cuando `active_flow` se resuelve (confirmación, cancelación o timeout), el orquestador revisa `expense_queue`, extrae el primero en orden de llegada e inicia un nuevo `active_flow` con él. La cola nunca procesa dos gastos en paralelo.
