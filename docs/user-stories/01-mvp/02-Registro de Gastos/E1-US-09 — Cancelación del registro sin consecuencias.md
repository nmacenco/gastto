
**Historia de usuario**

> Como usuario que está en medio de un flujo de registro de gasto, quiero poder cancelar el proceso en cualquier momento con una respuesta simple, para salir del flujo sin que ningún dato sea guardado y sin efectos secundarios en mi planilla.

---

**Criterios de aceptación**


Feature: Cancelación del registro en cualquier punto del flujo

  Scenario: Cancelación explícita durante el resumen
    Given que el sistema presentó el resumen del gasto
    When el usuario responde "no", "cancelar", "cancela", "no registres", "para"
    Then el sistema descarta todos los datos del gasto en curso
    And confirma la cancelación: "Registro cancelado. No se guardó nada."
    And el sistema queda listo para recibir un nuevo mensaje

  Scenario: Cancelación durante una solicitud de aclaración
    Given que el sistema esperaba una aclaración del usuario
    When el usuario responde "cancelar"
    Then el sistema descarta el gasto en curso
    And confirma la cancelación
    And el sistema queda listo para recibir un nuevo mensaje

  Scenario: Cancelación con comando global ("stop", "salir")
    Given que el usuario está en cualquier punto del flujo de registro
    When el usuario envía "stop" o "salir"
    Then el sistema cancela el flujo activo (si existe)
    And responde confirmando que no se guardó nada

  Scenario: El usuario intenta cancelar cuando no hay flujo activo
    Given que no hay ningún flujo de registro en curso
    When el usuario envía "cancelar"
    Then el sistema responde amigablemente que no hay ningún registro pendiente
    And no genera ningún error

  Scenario: Cancelación seguida de un nuevo gasto inmediatamente
    Given que el usuario canceló un registro
    When inmediatamente envía un nuevo mensaje de gasto
    Then el sistema procesa el nuevo mensaje como un registro completamente nuevo
    And no hay rastros del flujo cancelado anteriormente

**Definición de Done**

- La cancelación funciona en todos los estados del flujo: durante aclaración, durante resumen, durante corrección.
- Al cancelar, ningún dato del gasto en curso queda persistido en ninguna capa del sistema.
- El comando "stop" funciona como cancelación global en cualquier punto.
- El sistema queda en estado limpio y listo para recibir un nuevo mensaje inmediatamente después de la cancelación.
- Existe un test de integración que verifica que la cancelación no deja datos huérfanos en el sistema.

**Story Points: 3**

> La cancelación parece simple pero requiere que el sistema implemente correctamente el rollback del estado conversacional en cualquier punto del flujo. La cobertura de todos los estados posibles y la limpieza de datos son los puntos de complejidad principales.

**Dependencias**

- Mecanismo de estado conversacional con soporte de limpieza completa del contexto activo.
- E1-US-05, E1-US-06, E1-US-07: los estados del flujo donde puede activarse la cancelación deben estar definidos.