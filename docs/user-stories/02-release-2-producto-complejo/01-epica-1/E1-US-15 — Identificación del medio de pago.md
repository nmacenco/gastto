
**Historia de usuario**

> Como usuario que menciona el medio de pago en su mensaje, quiero que el sistema lo detecte y lo registre automáticamente en el campo correspondiente de mi planilla, para no tener que especificarlo en un paso separado.

---

**Criterios de aceptación**

Feature: Identificación del medio de pago mencionado

  Scenario: Medio de pago explícito en el mensaje
    Given que el usuario envía "Cargué nafta, 8.500 pesos, con la tarjeta de crédito"
    When el sistema procesa el mensaje
    Then detecta medio de pago = "Tarjeta de crédito"
    And lo incluye en el resumen para confirmación

  Scenario: Medio de pago expresado coloquialmente
    Given que el usuario envía "Pagué el almuerzo en efectivo"
    When el sistema procesa el mensaje
    Then detecta medio de pago = "Efectivo"

  Scenario: Medio de pago con nombre de banco o tarjeta específica
    Given que el usuario envía "Pagué con Visa"
    When el sistema procesa el mensaje
    Then detecta medio de pago = "Tarjeta de crédito" (o el mapeo que corresponda en la planilla del usuario)
    And si la planilla tiene columna para nombre de banco/tarjeta, lo registra también

  Scenario: No se menciona medio de pago
    Given que el usuario envía "Pagué el almuerzo, 12 euros"
    When el sistema procesa el mensaje
    Then el campo medio de pago queda vacío en el resumen
    And no solicita este dato (en R2 el MVP ya confirmó que puede pedirlo explícitamente; en R2 completo se captura solo si se menciona)

  Scenario: La planilla del usuario no tiene columna de medio de pago
    Given que el mapeo de la planilla no incluye columna para medio de pago
    When el sistema detecta el medio de pago en el mensaje
    Then incluye el dato en el resumen con una nota: "Tu planilla no tiene columna para medio de pago, este dato no se guardará."

**Definición de Done**

- El sistema reconoce al menos los siguientes medios de pago: efectivo, tarjeta de crédito, tarjeta de débito, transferencia, y sus variantes coloquiales regionales más comunes.
- Cuando la planilla no tiene columna para medio de pago, el dato se muestra en el resumen con aviso pero no bloquea el flujo.
- El medio de pago detectado siempre es editable desde el resumen (flujo E1-US-07).

**Story Points: 3**

> El vocabulario de medios de pago es más acotado que el de categorías. La complejidad principal está en el mapeo al campo correcto de la planilla (que puede llamarse diferente por usuario) y en el manejo del caso en que la planilla no tiene esa columna.

**Dependencias**

- E4: el mapeo de la planilla debe incluir el campo de medio de pago (o informar su ausencia).
- E1-US-04: el motor de extracción de campos del texto ya está construido; esta historia lo extiende.