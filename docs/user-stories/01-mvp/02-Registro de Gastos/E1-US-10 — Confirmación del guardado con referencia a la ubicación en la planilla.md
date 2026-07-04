**Historia de usuario**

> Como usuario que confirmó el registro de un gasto, quiero recibir un mensaje de confirmación que indique exactamente dónde quedó guardado el dato en mi planilla (hoja y fila), para tener la certeza de que el proceso se completó correctamente y poder verificarlo si lo deseo.

---

**Criterios de aceptación**

Feature: Confirmación del guardado con referencia a la ubicación

  Scenario: Guardado exitoso con planilla de una sola hoja
    Given que el usuario confirmó el registro de un gasto
    And el guardado en la planilla fue exitoso
    When el sistema envía la confirmación
    Then el mensaje incluye: concepto, monto y moneda del gasto guardado
    And indica la hoja y la fila donde quedó registrado (ej: "Guardado en 'Gastos', fila 47")

  Scenario: Guardado exitoso con planilla de múltiples hojas
    Given que la planilla del usuario tiene varias hojas y el gasto corresponde a una específica
    When el sistema envía la confirmación
    Then indica la hoja correcta y el número de fila
    And el formato es legible dentro del chat

  Scenario: Guardado exitoso pero no se puede determinar el número de fila
    Given que el guardado fue exitoso
    But el sistema no puede determinar el número de fila exacto
    When envía la confirmación
    Then indica la hoja donde se guardó
    And omite el número de fila sin generar un mensaje de error

  Scenario: El guardado falla
    Given que el sistema intentó guardar el gasto
    And el guardado falla por cualquier motivo
    When el sistema detecta el fallo
    Then NO envía el mensaje de confirmación exitosa
    And gestiona el fallo según el flujo de E1-US-12

**Definición de Done**

- El mensaje de confirmación exitosa siempre incluye hoja de destino y número de fila cuando están disponibles.
- El mensaje de confirmación nunca se envía si el guardado no fue confirmado por la planilla de destino.
- El tiempo entre la confirmación del usuario y el mensaje de guardado exitoso es ≤ 3 segundos en condiciones normales.
- El flujo de fallo (E1-US-12) está integrado como rama alternativa de esta historia.

**Story Points: 3**

> El guardado en sí depende de la Épica 4, pero el mensaje de confirmación con referencia a la ubicación requiere que el servicio de escritura en planilla devuelva metadata (hoja + fila). La integración de esa metadata en el mensaje y la gestión del caso en que no está disponible añaden complejidad moderada.

**Dependencias**

- E4: el servicio de escritura en planilla debe retornar metadata de ubicación (hoja, fila) como parte de la respuesta de éxito.
- E1-US-08: la confirmación del usuario debe haber disparado el proceso de guardado.
- E1-US-12: el flujo de fallo debe estar definido como rama alternativa.