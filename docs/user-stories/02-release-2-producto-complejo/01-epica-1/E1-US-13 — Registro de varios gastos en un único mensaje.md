
**Historia de usuario**

> Como usuario que quiere registrar múltiples gastos de una vez, quiero enviar un único mensaje con varios gastos descritos en lenguaje natural, para no tener que iniciar un flujo de registro separado por cada ítem.

---

**Criterios de aceptación**

Feature: Registro de varios gastos en un único mensaje

  Scenario: Dos gastos en un mensaje con separador natural
    Given que el usuario envía "Almuerzo 12€ y taxi 8€"
    When el sistema procesa el mensaje
    Then detecta dos gastos independientes: (Almuerzo, 12, EUR) y (Taxi, 8, EUR)
    And presenta un resumen consolidado con ambos gastos listados
    And permite confirmar ambos a la vez o revisar cada uno individualmente

  Scenario: Un gasto detectado y otro con datos insuficientes
    Given que el usuario envía "Almuerzo 12€ y también cargué nafta"
    When el sistema procesa el mensaje
    Then detecta el primer gasto completo
    And detecta el segundo gasto con monto faltante
    And solicita aclaración solo para el dato faltante del segundo gasto sin afectar el primero

  Scenario: Más de tres gastos en un mensaje
    Given que el usuario envía cuatro o más gastos en un mensaje
    When el sistema procesa el mensaje
    Then presenta el resumen de todos en una lista
    And permite confirmar todos juntos o navegar individualmente

  Scenario: El usuario cancela uno de varios gastos en el resumen
    Given que el resumen muestra tres gastos
    When el usuario responde "cancela el segundo"
    Then el sistema elimina el segundo ítem del resumen
    And permite confirmar el resto

  Scenario: El usuario confirma todos
    Given que el resumen muestra múltiples gastos sin observaciones
    When el usuario responde "sí" o "confirmar todos"
    Then el sistema guarda todos los registros en la planilla
    And confirma cada uno indicando su ubicación (hoja + fila aproximada)

**Definición de Done**

- El sistema detecta correctamente entre 2 y 5 gastos en un único mensaje.
- El resumen consolidado es legible en el formato del canal (WhatsApp / Telegram) sin superar el límite de caracteres por mensaje.
- La cancelación individual de un ítem del resumen funciona correctamente sin afectar los demás.
- Si alguno de los gastos falla al guardarse, los exitosos se confirman y el fallido se notifica individualmente.

**Story Points: 8**

> Extender el parser para detectar múltiples entidades de gasto en un solo mensaje requiere una revisión significativa de la lógica de interpretación. La gestión de resúmenes consolidados, la cancelación individual de ítems y el manejo de fallos parciales multiplican la superficie de test. Es la historia de mayor complejidad de la Épica 1.

**Dependencias**

- E1-US-03, E1-US-04: la lógica de interpretación individual debe estar consolidada antes de extenderla a múltiples gastos.
- E1-US-06, E1-US-08, E1-US-09: el flujo de resumen-confirmación-cancelación debe soportar listas.