
**Historia de usuario**

> Como usuario que revisó el resumen de su gasto y está satisfecho con los datos, quiero poder confirmar el registro con una respuesta mínima como "sí", "ok" o "dale", para cerrar el flujo de forma natural sin fricciones adicionales.

---

**Criterios de aceptación**


Feature: Confirmación del registro con respuesta mínima

  Scenario: Confirmación con palabra afirmativa estándar
    Given que el sistema presentó el resumen del gasto
    When el usuario responde "sí", "si", "ok", "dale", "confirmo", "correcto", "listo", "va"
    Then el sistema inicia el proceso de guardado
    And no solicita ninguna confirmación adicional

  Scenario: Confirmación con respuesta afirmativa en variante regional
    Given que el sistema presentó el resumen
    When el usuario responde "bárbaro", "okey", "perfecto", "yep", "sip" u otras variantes coloquiales
    Then el sistema las reconoce como confirmación válida
    And inicia el proceso de guardado

  Scenario: Respuesta ambigua que podría ser confirmación o corrección
    Given que el sistema presentó el resumen con categoría "Comida"
    When el usuario responde "comida sí, pero el monto no"
    Then el sistema interpreta esto como una corrección parcial, no como una confirmación
    And actualiza solo el monto siguiendo el flujo de E1-US-07

  Scenario: Respuesta que no es ni confirmación ni corrección ni cancelación
    Given que el sistema presentó el resumen
    When el usuario responde con algo no interpretable (ej: "🤔")
    Then el sistema responde: "¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?"
    And espera una nueva respuesta sin modificar ningún dato

**Definición de Done**

- El vocabulario de palabras de confirmación está documentado y cubre variantes regionales del español (España, Argentina, México, Chile como mínimo).
- Una confirmación válida dispara el proceso de guardado descrito en E1-US-10.
- Las respuestas ambiguas se enrutan al flujo de corrección (E1-US-07) sin guardar datos incorrectos.
- Las respuestas no interpretables generan una pregunta de orientación, no un error.

**Story Points: 2**

> El vocabulario de confirmación es fijo y acotado. La única complejidad relevante es distinguir una confirmación de una corrección parcial, que se resuelve reutilizando el motor de interpretación ya construido. No hay nueva lógica de negocio significativa.

**Dependencias**

- E1-US-06: el resumen debe estar en estado "pendiente de confirmación".
- E1-US-07: el flujo de corrección debe estar disponible para el caso de ambigüedad.