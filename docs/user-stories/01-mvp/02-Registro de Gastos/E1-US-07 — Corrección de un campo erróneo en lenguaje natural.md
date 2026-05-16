**Historia de usuario**

> Como usuario que está revisando el resumen de un gasto antes de guardarlo, quiero poder corregir cualquier campo equivocado respondiendo en lenguaje natural, para no tener que cancelar el registro y empezar desde cero por un simple error de interpretación.

---

**Criterios de aceptación**


Feature: Corrección de campos del resumen en lenguaje natural

  Scenario: Corrección del monto
    Given que el sistema mostró un resumen con monto = 12 EUR
    When el usuario responde "no, fueron 15"
    Then el sistema actualiza el monto a 15 EUR
    And presenta el resumen actualizado para una nueva confirmación

  Scenario: Corrección de la categoría
    Given que el sistema asignó categoría "Comida"
    When el usuario responde "ponlo en transporte"
    Then el sistema actualiza la categoría a "Transporte" (o el equivalente en la planilla del usuario)
    And presenta el resumen actualizado

  Scenario: Corrección de la fecha
    Given que el sistema asumió fecha = hoy
    When el usuario responde "fue ayer"
    Then el sistema actualiza la fecha al día anterior
    And presenta el resumen actualizado

  Scenario: Corrección de varios campos en un solo mensaje
    Given que el resumen tiene monto = 12 y categoría = "Comida"
    When el usuario responde "no, fueron 15 y es transporte"
    Then el sistema actualiza ambos campos simultáneamente
    And presenta el resumen actualizado una sola vez (no dos mensajes separados)

  Scenario: Corrección con valor inválido
    Given que el resumen muestra monto = 12 EUR
    When el usuario responde "cambia el monto a veinte mil millones"
    Then el sistema detecta el valor como inusualmente alto
    And solicita confirmación explícita antes de aplicar el cambio

  Scenario: Mensaje de corrección no interpretable
    Given que el sistema mostró el resumen
    When el usuario responde algo no relacionado con ningún campo (ej: "ajá")
    Then el sistema solicita aclaración: "¿Querías confirmar, corregir o cancelar el registro?"
    And no modifica ningún dato ni guarda nada

**Definición de Done**

- Las correcciones de monto, moneda, categoría y fecha están implementadas y probadas.
- El sistema puede aplicar correcciones de más de un campo en un único mensaje del usuario.
- Después de cada corrección se presenta un resumen actualizado; el ciclo de corrección puede repetirse hasta que el usuario confirme o cancele.
- El número máximo de ciclos de corrección está definido (recomendado: 5 ciclos) para evitar loops infinitos; al superarse, el sistema ofrece cancelar o confirmar el estado actual.
- Las correcciones no se guardan en la planilla hasta que el usuario confirme explícitamente (E1-US-08).

**Story Points: 5**

> Interpretar una corrección en lenguaje natural es similar a interpretar el gasto original, pero con el contexto adicional del resumen previo. La capacidad de corregir múltiples campos en un mensaje y la gestión del ciclo de corrección añaden complejidad incremental sobre la base ya construida.

**Dependencias**

- E1-US-06: el resumen debe existir y estar en estado "pendiente de confirmación".
- El motor de interpretación de E1-US-03 y E1-US-04 es reutilizable para interpretar los mensajes de corrección.