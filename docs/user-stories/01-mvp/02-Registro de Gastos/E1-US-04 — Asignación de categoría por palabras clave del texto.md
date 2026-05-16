
**Historia de usuario**

> Como sistema que interpreta un gasto, quiero asignar automáticamente una categoría basándome en las palabras clave del mensaje del usuario, para que el registro quede organizado en la planilla sin que el usuario tenga que especificar la categoría manualmente.

---

> **Nota de corte:** Esta historia cubre únicamente la asignación por palabras clave del texto. La mejora mediante historial previo del usuario se aborda en E1-US-05 (Release 2). Esta separación es intencional: en el MVP no existe historial, por lo que el mecanismo basado en historial no es aplicable.


Criterios de aceptación

Feature: Asignación de categoría por palabras clave

  Scenario: Palabra clave inequívoca presente en el mensaje
    Given que el sistema tiene un vocabulario de categorías configurado para el usuario
    And el mensaje es "Pagué el almuerzo, 12 euros"
    When el sistema procesa el texto
    Then asigna la categoría "Comida" (o su equivalente en la planilla del usuario)
    And incluye la categoría en el resumen para confirmación

  Scenario: Varias palabras clave posibles, todas apuntan a la misma categoría
    Given que el mensaje es "Cargué combustible para el auto"
    When el sistema procesa el texto
    Then asigna la categoría "Transporte" con alta confianza

  Scenario: Palabras clave ambiguas que pueden corresponder a más de una categoría
    Given que el mensaje es "Compré algo en el kiosco"
    When el sistema procesa el texto
    And la ambigüedad supera el umbral de confianza configurado
    Then el sistema propone la categoría más probable
    And indica al usuario que puede corregirla antes de confirmar

  Scenario: No se detecta ninguna palabra clave relevante
    Given que el mensaje es "Gasté 50 euros hoy"
    When el sistema procesa el texto
    And no encuentra coincidencia con ninguna categoría
    Then incluye el campo categoría como "Sin categoría" o equivalente en la planilla del usuario
    And en el resumen muestra el campo vacío con la opción de completarlo

  Scenario: La categoría inferida no existe en la planilla del usuario
    Given que el sistema infiere "Entretenimiento"
    But esa categoría no está en el vocabulario confirmado de la planilla del usuario
    When el sistema arma el resumen
    Then propone la categoría más cercana disponible en la planilla
    And lo señala en el resumen para que el usuario pueda corregir

**Definición de Done**

- El sistema tiene un vocabulario de categorías base multiidioma (español) ampliable.
- El vocabulario de categorías del usuario está tomado del proceso de vinculación de planilla (E4-US-06).
- La asignación por palabras clave cubre al menos los rubros más comunes: alimentación, transporte, vivienda, salud, entretenimiento, servicios.
- Cuando la confianza es baja o nula, el campo categoría queda visible en el resumen con indicación de corrección pendiente, pero no bloquea el flujo.
- Tests unitarios cubren los escenarios de alta confianza, baja confianza y sin coincidencia.

**Story Points: 5**

> Requiere construir el motor de clasificación por palabras clave y su integración con el vocabulario de la planilla del usuario. No es trivial porque el vocabulario es heterogéneo por usuario, pero tampoco es ML avanzado en esta historia. La complejidad está en los casos borde (ambigüedad, categoría inexistente en la planilla).

**Dependencias**

- E4-US-06: vocabulario de categorías de la planilla del usuario confirmado.
- E1-US-03: monto detectado (el flujo de interpretación debe estar en curso).