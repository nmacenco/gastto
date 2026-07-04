
**Historia de usuario**

> Como sistema que recibe un mensaje de gasto, necesito detectar automáticamente el monto numérico y la moneda mencionados, para tener los datos mínimos indispensables de cualquier registro financiero.

---

**Criterios de aceptación**

Feature: Detección de monto y moneda en el texto del usuario

  Scenario: Monto y moneda explícitos en formato estándar
    Given que el sistema recibe el mensaje "Pagué 45,50 EUR en el supermercado"
    When el sistema procesa el texto
    Then extrae monto = 45.50 y moneda = EUR
    And continúa el flujo de interpretación

  Scenario: Moneda expresada como símbolo
    Given que el sistema recibe el mensaje "Gasté $1.200 en el taxi"
    When el sistema procesa el texto
    Then extrae monto = 1200 y moneda = la configurada por defecto del usuario (o solicita aclaración si no está definida)

  Scenario: Monto con separadores de miles y decimales variables según locale
    Given que el sistema recibe "Cargué nafta por 8.500,00 pesos"
    When el sistema procesa el texto
    Then extrae monto = 8500.00 y moneda = pesos (o la moneda por defecto del usuario)

  Scenario: Monto presente pero moneda ausente y sin configuración por defecto
    Given que el usuario no tiene moneda por defecto configurada
    And el mensaje dice "Pagué 30 por el café"
    When el sistema procesa el texto
    Then detecta monto = 30 pero no puede determinar la moneda
    And solicita aclaración al usuario: "¿En qué moneda fue ese gasto?"

  Scenario: Sin monto reconocible en el mensaje
    Given que el usuario envía "Fui al supermercado"
    When el sistema procesa el texto
    Then no detecta monto válido
    And solicita aclaración: "¿Cuánto gastaste?"

  Scenario: Monto negativo o cero
    Given que el usuario envía "Gasté 0 pesos en algo"
    When el sistema procesa el texto
    Then detecta monto = 0
    And solicita confirmación antes de continuar: "¿Querías registrar un gasto de $0?"

**Definición de Done**

- El extractor de monto y moneda funciona correctamente para las siguientes variantes documentadas: símbolo antes del número ($, €, £), código ISO después del número (EUR, ARS, USD), separadores de miles con punto o coma, decimales con punto o coma.
- Cuando la moneda no puede inferirse, el sistema siempre solicita aclaración antes de continuar, sin asumir valores incorrectos.
- El campo `moneda_por_defecto` del perfil de usuario es consultado como fallback antes de solicitar aclaración.
- Cobertura de tests unitarios ≥ 90% para la función de extracción de monto/moneda.

**Story Points: 5**

> La detección de montos parece simple, pero los formatos regionales (puntos vs. comas, símbolos vs. códigos ISO, monedas ambiguas como "$" que puede ser ARS, USD, MXN, etc.) añaden complejidad real. Requiere diseñar una lógica de fallback a moneda por defecto y el flujo de solicitud de aclaración cuando no hay suficiente información.

**Dependencias**

- E1-US-01 y E1-US-02: mensaje recibido y acuse enviado.
- Perfil del usuario con campo `moneda_por_defecto` disponible (puede venir de la configuración inicial de Épica 4).