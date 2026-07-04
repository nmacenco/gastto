
**Historia de usuario**

> Como usuario que acaba de registrar un gasto y se da cuenta de que cometió un error, quiero poder deshacerlo con un comando simple desde el chat, para que el registro sea eliminado de mi planilla sin que tenga que abrirla manualmente.

---

**Criterios de aceptación**

Feature: Deshacer el último gasto registrado

  Scenario: Deshacer inmediatamente después del guardado
    Given que el sistema acaba de confirmar el guardado de un gasto
    When el usuario envía "deshacer", "undo" o "borrar el último"
    Then el sistema elimina el registro de la planilla
    And confirma: "Listo, se eliminó el último registro ([concepto], [monto])."

  Scenario: Deshacer cuando ya pasó tiempo (nuevo mensaje enviado después)
    Given que el usuario registró un gasto hace varios minutos
    And desde entonces envió otros mensajes (no de gasto) al bot
    When el usuario envía "deshacer"
    Then el sistema confirma cuál es el último gasto registrado
    And pide confirmación explícita antes de eliminarlo: "¿Elimino '[concepto], [monto]' registrado a las [hora]?"

  Scenario: Deshacer cuando ya se registraron dos o más gastos después
    Given que el usuario tiene múltiples gastos registrados
    When el usuario envía "deshacer"
    Then el sistema solo ofrece deshacer el más reciente
    And no ofrece deshacer múltiples registros en esta historia (eso es backlog)

  Scenario: No hay ningún gasto registrado para deshacer
    Given que el usuario no tiene registros en la sesión actual o la planilla está vacía
    When el usuario envía "deshacer"
    Then el sistema responde: "No encontré ningún registro reciente para deshacer."
    And no realiza ninguna acción sobre la planilla

  Scenario: El sistema no puede eliminar el registro (error de escritura en planilla)
    Given que el usuario solicitó deshacer
    And el sistema no puede modificar la planilla en ese momento
    When intenta realizar la eliminación
    Then notifica al usuario del fallo con instrucciones claras
    And no deja el sistema en un estado inconsistente

**Definición de Done**

- "Deshacer" elimina el último registro de la planilla y confirma la operación con el concepto y monto del registro eliminado.
- El alcance de esta historia es exclusivamente el último registro. Múltiples "deshacer" en cadena no están incluidos en este scope.
- Cuando ya se registraron gastos posteriores, el sistema pide confirmación explícita antes de eliminar para evitar errores accidentales.
- La operación de deshacer genera una entrada de log interno (auditoría mínima: qué se eliminó, cuándo, por qué usuario).
- El fallo en la eliminación genera una notificación útil, no un error técnico expuesto al usuario.

**Story Points: 5**

> Requiere que el sistema mantenga referencia al último registro guardado (ID de fila + hoja) por usuario y que el servicio de escritura en planilla soporte operaciones de eliminación. La confirmación explícita cuando hay registros intermedios y el manejo de fallos en la eliminación añaden complejidad más allá del caso feliz.

**Dependencias**

- E1-US-10: el sistema debe guardar la referencia al último registro exitoso por usuario.
- E4: el servicio de escritura en planilla debe soportar la operación de eliminación por referencia.