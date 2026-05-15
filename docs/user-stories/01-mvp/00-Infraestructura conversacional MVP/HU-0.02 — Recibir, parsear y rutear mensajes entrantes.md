
**Como** sistema, **quiero** recibir el payload de Telegram, extraer los datos relevantes del mensaje y rutearlo al módulo correcto, **para** que cada mensaje llegue al handler adecuado independientemente de su tipo o contenido.

### Criterios de Aceptación (Gherkin)


Escenario 1: Mensaje de texto entrante
  Dado que un usuario envía un mensaje de texto al bot
  Cuando el webhook recibe el payload
  Entonces el sistema extrae: chat_id, user_id, texto del mensaje y timestamp
  Y rutea el mensaje al handler de texto con esos datos normalizados

Escenario 2: Mensaje de tipo no soportado en MVP (audio, imagen, sticker)
  Dado que un usuario envía un tipo de mensaje no soportado
  Cuando el webhook recibe el payload
  Entonces el sistema identifica el tipo como no soportado
  Y responde al usuario: "Por ahora solo proceso mensajes de texto. Contame tu gasto escribiéndolo."
  Y no genera error ni excepción interna

Escenario 3: Payload malformado o inesperado
  Dado que el webhook recibe un payload que no cumple el esquema esperado
  Cuando el parser intenta procesarlo
  Entonces el sistema registra el error en el log con el payload completo
  Y responde 200 a Telegram (para evitar reintentos infinitos)
  Y no propaga la excepción al resto del sistema

Escenario 4: Múltiples mensajes en rápida sucesión del mismo usuario
  Dado que un usuario envía 3 mensajes en menos de 2 segundos
  Cuando el sistema los recibe
  Entonces los procesa en orden de llegada sin perder ninguno
  Y cada uno recibe su respuesta correspondiente

### Definición de Done

- [ ]  El parser extrae chat_id, user_id, texto y timestamp de forma confiable
- [ ]  El ruteo por tipo de mensaje está implementado (texto / no soportado / desconocido)
- [ ]  Los tipos no soportados devuelven mensaje amigable al usuario
- [ ]  Los payloads malformados loggean y responden 200 sin excepción
- [ ]  El procesamiento en orden está garantizado (cola o procesamiento sincrónico)
- [ ]  Tests unitarios cubren los 4 escenarios

**Story Points: 3** _Justificación: El parsing del payload de Telegram está bien documentado, pero el ruteo robusto con manejo de errores, tipos no soportados y orden de procesamiento requiere diseño cuidadoso. Es la pieza sobre la que se construye todo lo demás._

**Dependencias:** HU-0.01


