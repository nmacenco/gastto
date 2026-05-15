**Historia de usuario**

> Como usuario que no puede escribir en ese momento, quiero enviar un mensaje de voz describiendo mi gasto, para poder registrarlo con la misma naturalidad que tendría al hablar, sin necesidad de escribir nada.

---

**Criterios de aceptación**

Feature: Recepción y transcripción de mensajes de voz

  Scenario: Mensaje de voz claro y bien pronunciado
    Given que el usuario envía un mensaje de voz en su canal de mensajería
    When el sistema recibe el audio
    Then acusa recibo en ≤ 1 segundo
    And transcribe el audio a texto
    And envía el texto transcripto al flujo estándar de interpretación de E1-US-03 en adelante

  Scenario: El sistema transcribe el audio en ≤ 5 segundos
    Given que el audio dura menos de 30 segundos
    When el sistema lo procesa
    Then la transcripción está disponible en ≤ 5 segundos
    And el usuario recibe el resumen del gasto interpretado como en el flujo de texto

  Scenario: Audio demasiado largo (más de 60 segundos)
    Given que el usuario envía un audio de más de 60 segundos
    When el sistema lo recibe
    Then notifica que el audio es demasiado largo
    And solicita que lo reenvíe en un mensaje más corto o lo escriba

  Scenario: Audio inaudible o con mucho ruido de fondo
    Given que el audio tiene calidad insuficiente para transcribir
    When el sistema intenta la transcripción
    Then detecta la baja calidad
    And gestiona el caso según E1-US-17

  Scenario: Formato de audio no soportado
    Given que el usuario envía un archivo de audio en un formato no compatible
    When el sistema lo recibe
    Then notifica que no puede procesar ese tipo de archivo
    And sugiere enviar el gasto como texto

**Definición de Done**

- El sistema acepta mensajes de voz de WhatsApp (formato .ogg/opus) y Telegram (formato .ogg o .mp3).
- El tiempo de transcripción es ≤ 5 segundos para audios de hasta 30 segundos en condiciones normales.
- El texto transcripto pasa exactamente por el mismo flujo de interpretación que un mensaje de texto (reutilización total).
- El usuario recibe el texto transcripto en el resumen para poder verificar que fue entendido correctamente antes de confirmar.

**Story Points: 5**

> La integración con un servicio de transcripción (STT) añade una dependencia externa nueva. El manejo de formatos de audio por canal, tiempos de respuesta y la integración limpia con el flujo de texto existente son los puntos de complejidad. La transcripción en sí está delegada a un servicio externo, pero su integración no es trivial.

**Dependencias**

- E1-US-03 al E1-US-10: el flujo de texto completo debe estar construido (la transcripción lo alimenta).
- Servicio externo de transcripción de voz a texto (STT) integrado.