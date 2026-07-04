
**Historia de usuario**

> Como usuario que envió un mensaje con información incompleta o ambigua, quiero que el sistema me pida exactamente el dato que falta en una sola pregunta, para poder completar el registro sin tener que reenviar el mensaje desde cero.

---

**Criterios de aceptación**

Feature: Solicitud de aclaración ante datos ambiguos o faltantes

  Scenario: Falta un único dato — moneda
    Given que el sistema procesó el mensaje "Pagué 30 por el café"
    And no pudo determinar la moneda
    When el sistema necesita aclaración
    Then envía exactamente una pregunta: "¿En qué moneda fue ese gasto?"
    And espera la respuesta antes de continuar

  Scenario: Falta un único dato — monto
    Given que el sistema procesó el mensaje "Fui al supermercado"
    And no encontró ningún monto
    When el sistema necesita aclaración
    Then envía exactamente una pregunta: "¿Cuánto gastaste?"
    And espera la respuesta antes de continuar

  Scenario: Ambigüedad en la categoría
    Given que el sistema procesó el mensaje "Compré algo en el kiosco, 8 euros"
    And la categoría inferida tiene confianza baja
    When el sistema arma el resumen
    Then muestra la categoría propuesta como editable
    And no hace una pregunta adicional; la corrección se gestiona en el paso de revisión (E1-US-06)

  Scenario: Faltan varios datos a la vez
    Given que el mensaje es "Gasté algo"
    And no hay monto, ni moneda, ni concepto reconocible
    When el sistema procesa el mensaje
    Then solicita primero el dato más bloqueante (el monto)
    And espera la respuesta antes de pedir el siguiente dato
    And no bombardea al usuario con múltiples preguntas en un mismo mensaje

  Scenario: El usuario no responde la aclaración y manda otro gasto
    Given que el sistema esperaba una respuesta de aclaración
    When el usuario envía un nuevo mensaje de gasto sin responder la pregunta anterior
    Then el sistema descarta el flujo anterior (sin guardarlo)
    And procesa el nuevo mensaje como un registro nuevo
    And notifica brevemente que el registro anterior fue cancelado

  Scenario: El usuario responde la aclaración con un valor inválido
    Given que el sistema preguntó "¿En qué moneda fue ese gasto?"
    When el usuario responde "no sé"
    Then el sistema reformula la pregunta con opciones concretas basadas en las monedas usadas previamente o en la moneda por defecto

**Definición de Done**

- El sistema nunca hace más de una pregunta por mensaje de aclaración.
- El orden de prioridad para solicitar datos faltantes está definido y documentado: monto > moneda > categoría.
- El flujo de aclaración tiene un timeout configurado: si el usuario no responde en X tiempo y manda otro mensaje de gasto, el flujo anterior se cancela limpiamente.
- El estado del flujo en curso (gasto pendiente de aclaración) persiste entre mensajes del mismo usuario.
- Existe un test de integración que cubre el escenario de "nuevo gasto interrumpe aclaración previa".

**Story Points: 5**

> La gestión de estado conversacional (mantener el contexto de un gasto a medio completar entre turnos de conversación) es la mayor complejidad de esta historia. Las preguntas en sí son simples, pero el manejo del contexto, el timeout y la interrupción por nuevo gasto requieren una solución de estado persistente.

**Dependencias**

- E1-US-03: detección de monto y moneda (es el disparador principal de aclaraciones).
- E1-US-04: asignación de categoría (puede generar necesidad de aclaración secundaria).
- Mecanismo de estado conversacional persistente por usuario.