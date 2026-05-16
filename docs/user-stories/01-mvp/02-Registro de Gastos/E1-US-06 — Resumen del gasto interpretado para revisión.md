
**Historia de usuario**

> Como usuario que acaba de describir un gasto, quiero recibir un resumen estructurado de cómo el sistema interpretó mi mensaje antes de que se guarde nada, para poder verificar que los datos son correctos y tener control real sobre lo que entra en mi planilla.

---

**Criterios de aceptación**

Feature: Resumen del gasto interpretado antes del guardado

  Scenario: Flujo feliz — todos los datos detectados correctamente
    Given que el sistema interpretó correctamente el gasto
    When presenta el resumen al usuario
    Then el resumen incluye: concepto, monto, moneda, categoría y fecha (o "hoy" si no se especificó)
    And el formato es claro y legible dentro del chat
    And el resumen incluye instrucciones para confirmar, corregir o cancelar

  Scenario: Campo categoría con confianza baja
    Given que la categoría asignada tiene confianza baja
    When el sistema presenta el resumen
    Then el campo categoría aparece marcado visualmente (ej: con ❓ o "¿Correcto?")
    And el resto del resumen se muestra con normalidad

  Scenario: Campo fecha no detectado
    Given que el mensaje no mencionó fecha
    When el sistema presenta el resumen
    Then el campo fecha muestra "Hoy" como valor por defecto
    And el usuario puede corregirlo si lo desea antes de confirmar

  Scenario: El usuario no interactúa con el resumen
    Given que el sistema envió el resumen
    When pasan más de 10 minutos sin respuesta del usuario
    Then el sistema envía un recordatorio único: "¿Confirmamos el registro?"
    And si pasan otros 10 minutos sin respuesta, el flujo se cancela automáticamente sin guardar nada

  Scenario: Resumen con información sensible (monto muy alto)
    Given que el monto detectado es inusualmente alto (ej: más de 10 veces el promedio histórico si existe)
    When el sistema presenta el resumen
    Then muestra el monto con un indicador de atención (ej: "⚠️ Monto inusualmente alto")
    And solicita confirmación explícita antes de permitir el guardado

**Definición de Done**

- El resumen siempre incluye los cinco campos mínimos: concepto, monto, moneda, categoría, fecha.
- Los campos con confianza baja están visualmente diferenciados en el mensaje del resumen.
- El resumen siempre muestra las opciones de acción disponibles (confirmar / corregir / cancelar).
- El mecanismo de timeout y recordatorio único está implementado y probado.
- El formato del resumen es consistente entre WhatsApp y Telegram (puede haber diferencias de markdown pero la información es idéntica).

**Story Points: 3**

> Generar el resumen es relativamente directo una vez que los datos están interpretados. La complejidad reside en el manejo del timeout, el recordatorio y los marcadores visuales de baja confianza. No involucra lógica de negocio nueva, sino presentación y gestión de estado.

**Dependencias**

- E1-US-03, E1-US-04, E1-US-05: interpretación completa del gasto.
- Mecanismo de estado conversacional con soporte de timeout.