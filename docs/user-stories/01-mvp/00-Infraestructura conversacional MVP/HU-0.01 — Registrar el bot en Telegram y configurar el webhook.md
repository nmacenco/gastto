
**Como** equipo de desarrollo, **quiero** registrar un bot en Telegram y configurar el webhook que recibe los mensajes entrantes, **para** que FinFlow pueda recibir y procesar los mensajes de los usuarios en tiempo real.

### Criterios de Aceptación (Gherkin)

Escenario 1: Bot registrado y activo
  Dado que el equipo ejecuta el proceso de registro con BotFather
  Cuando el registro se completa
  Entonces el bot tiene nombre público, username y token de API válido
  Y el bot responde al comando /start con un mensaje de bienvenida básico

Escenario 2: Webhook configurado y verificado
  Dado que el servidor de FinFlow tiene un endpoint HTTPS público
  Cuando se configura el webhook con la API de Telegram
  Entonces Telegram confirma el webhook con status "ok"
  Y un mensaje enviado al bot llega al endpoint en menos de 2 segundos

Escenario 3: El webhook falla y Telegram reintenta
  Dado que el endpoint no está disponible momentáneamente
  Cuando Telegram intenta entregar un mensaje
  Entonces Telegram reintenta con backoff exponencial según su comportamiento nativo
  Y cuando el endpoint se recupera, el mensaje llega correctamente

Escenario 4: Validación de origen del mensaje
  Dado que el endpoint recibe una llamada
  Cuando la llamada no proviene de Telegram (token inválido o IP no esperada)
  Entonces el endpoint rechaza la llamada con 403
  Y no procesa el contenido del mensaje

### Definición de Done

- [ ]  Bot registrado en Telegram con nombre y username definitivos del producto
- [ ]  Token almacenado en vault/secrets manager, nunca en el código
- [ ]  Webhook configurado apuntando al endpoint de producción con HTTPS
- [ ]  Validación de origen implementada (verificación del token en header)
- [ ]  Mensaje de bienvenida básico al /start funcional en producción
- [ ]  Latencia webhook < 2 segundos verificada con prueba real

**Story Points: 2** _Justificación: El proceso de registro con BotFather es trivial. La complejidad real está en la configuración del webhook con HTTPS y la validación de origen, pero son tareas bien documentadas sin ambigüedad de diseño._

**Dependencias:** Ninguna. Primera HU del proyecto.