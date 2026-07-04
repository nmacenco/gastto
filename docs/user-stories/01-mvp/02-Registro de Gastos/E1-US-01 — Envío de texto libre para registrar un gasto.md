
**Historia de usuario**

> Como usuario que quiere registrar un gasto, quiero enviar un mensaje de texto en lenguaje natural dentro de mi chat de WhatsApp o Telegram, para iniciar el registro sin tener que aprender ningún formato ni abrir ninguna otra aplicación.

---

**Criterios de aceptación**

Feature: Envío de texto libre para registrar un gasto

  Scenario: Flujo feliz — mensaje con monto y concepto claros
    Given que el usuario tiene FinFlow activo en su canal de mensajería
    And la planilla del usuario ya está vinculada y configurada
    When el usuario envía un mensaje como "Pagué el almuerzo, 12 euros"
    Then el sistema acusa recibo en menos de 1 segundo
    And inicia el flujo de interpretación del gasto

  Scenario: Mensaje con información parcial
    Given que el usuario tiene FinFlow activo
    When el usuario envía un mensaje como "Almuerzo 12" sin especificar moneda
    Then el sistema acusa recibo en menos de 1 segundo
    And inicia el flujo de interpretación, solicitando aclaración en el paso correspondiente

  Scenario: Mensaje vacío o sin contenido financiero reconocible
    Given que el usuario tiene FinFlow activo
    When el usuario envía un mensaje como "Hola" o "👋"
    Then el sistema responde con un mensaje amigable indicando cómo registrar un gasto
    And no inicia ningún flujo de guardado

  Scenario: Mensaje muy largo (más de 500 caracteres)
    Given que el usuario tiene FinFlow activo
    When el usuario envía un mensaje que supera los 500 caracteres
    Then el sistema acusa recibo
    And intenta extraer la información del gasto del contenido relevante
    And si no puede interpretarlo, solicita que lo reformule en una sola frase


**Definición de Done**

- El sistema recibe mensajes de texto en WhatsApp y Telegram y acusa recibo en ≤ 1 segundo en condiciones normales de red.
- Los mensajes sin contenido financiero reconocible generan una respuesta orientativa, no un error.
- Los mensajes con información parcial pasan al flujo de interpretación sin bloquearse en esta etapa.
- El comportamiento está cubierto por tests de integración para ambos canales.
- No existe ninguna interfaz web o pantalla adicional involucrada en este paso.

**Story Points: 3**

> El canal de entrada ya existe (WhatsApp / Telegram). La complejidad real está en el acuse de recibo inmediato y el enrutamiento correcto del mensaje. No hay lógica de interpretación en esta historia; eso se resuelve en historias siguientes. El manejo de edge cases (mensajes vacíos, mensajes largos) añade superficie de prueba pero no complejidad de negocio.

**Dependencias**

- Épica 4 — Vinculación de planilla completada (E4-US-01 a E4-US-05): el sistema debe saber a qué planilla pertenece el usuario antes de que cualquier mensaje tenga destino.
- Integración con la API del canal de mensajería (WhatsApp Business API / Telegram Bot API) operativa.