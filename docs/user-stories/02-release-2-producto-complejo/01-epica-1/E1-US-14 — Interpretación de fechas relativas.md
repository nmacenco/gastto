
**Historia de usuario**

> Como usuario que describe un gasto que no ocurrió hoy, quiero que el sistema entienda expresiones de fecha relativa como "ayer", "el martes" o "la semana pasada", para no tener que especificar la fecha en formato numérico.

---

**Criterios de aceptación**


Feature: Interpretación de fechas relativas

  Scenario: "Ayer" en un mensaje
    Given que hoy es miércoles 15 de mayo
    When el usuario envía "Pagué el almuerzo ayer, 12 euros"
    Then el sistema interpreta la fecha como martes 14 de mayo
    And la muestra en el resumen como "14 de mayo" (no como "ayer")

  Scenario: Día de la semana sin especificar si fue pasado o próximo
    Given que hoy es miércoles
    When el usuario envía "El lunes gasté 30 euros en el médico"
    Then el sistema asume que se refiere al lunes más reciente (pasado)
    And si el lunes más reciente está a más de 7 días, solicita confirmación del año/mes

  Scenario: "La semana pasada" sin día específico
    Given que el usuario envía "La semana pasada gasté mucho en supermercado, 150€"
    When el sistema procesa el mensaje
    Then asigna la fecha como el lunes de la semana anterior (inicio de semana por defecto)
    And lo muestra en el resumen para que el usuario pueda corregirlo si prefiere otro día

  Scenario: Fecha relativa no reconocida
    Given que el usuario envía "El otro día gasté 20 euros"
    When el sistema no puede resolver "el otro día" a una fecha concreta
    Then solicita aclaración: "¿Cuándo fue ese gasto? Puedes decirme el día o la fecha."

  Scenario: Fecha relativa que resulta en una fecha futura
    Given que el usuario envía "El viernes gasté 50 euros" y hoy es miércoles
    When el sistema resuelve la fecha
    Then detecta que el viernes más próximo es futuro
    And solicita confirmación: "¿Te referís al viernes pasado ([fecha]) o al próximo ([fecha])?"

**Definición de Done**

- El sistema interpreta correctamente: "ayer", "anteayer", días de la semana (lunes a domingo), "la semana pasada", "este mes", "el mes pasado".
- Las fechas resueltas siempre se muestran en formato explícito en el resumen (nunca como "ayer"), para que el usuario pueda verificarlas.
- Cuando la ambigüedad es inevitable (fecha futura vs. pasada), el sistema siempre solicita confirmación antes de asumir.
- La zona horaria del usuario se considera en la resolución de fechas (configurada en el onboarding).

**Story Points: 5**

> La resolución de fechas relativas tiene múltiples edge cases (zonas horarias, semanas que cruzan meses o años, ambigüedad pasado/futuro). No es trivial pero es un problema conocido y acotado. El mayor riesgo es la zona horaria.

**Dependencias**

- E1-US-06: las fechas resueltas se muestran en el resumen; el formato de presentación debe soportarlo.
- Configuración de zona horaria del usuario (definida en el onboarding de Épica 4).