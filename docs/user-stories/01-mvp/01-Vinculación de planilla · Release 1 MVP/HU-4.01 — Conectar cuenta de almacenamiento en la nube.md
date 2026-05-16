**Como** usuario que quiere empezar a usar FinFlow, **quiero** conectar mi cuenta de Google Drive o OneDrive desde la conversación en WhatsApp/Telegram, **para** que el sistema pueda acceder a mi planilla de gastos sin que yo tenga que copiar y pegar datos manualmente.

### Criterios de Aceptación (Gherkin)

Escenario 1: Onboarding — el usuario elige proveedor
  Dado que el usuario inicia FinFlow por primera vez
  Cuando el sistema le pregunta dónde tiene su planilla
  Entonces el sistema presenta exactamente dos opciones: "Google Drive" y "OneDrive"
  Y el usuario puede responder con el número o el nombre de la opción

Escenario 2: Autorización exitosa con Google Drive
  Dado que el usuario eligió "Google Drive"
  Cuando el sistema le envía el enlace de autorización OAuth
  Y el usuario completa la autorización en su navegador
  Entonces el sistema confirma en el chat "✅ Google Drive conectado correctamente"
  Y el flujo continúa hacia la selección de archivo

Escenario 3: Autorización exitosa con OneDrive
  Dado que el usuario eligió "OneDrive"
  Cuando el sistema le envía el enlace de autorización OAuth
  Y el usuario completa la autorización en su navegador
  Entonces el sistema confirma en el chat "✅ OneDrive conectado correctamente"
  Y el flujo continúa hacia la selección de archivo

Escenario 4: El usuario no completa la autorización
  Dado que el sistema envió el enlace OAuth
  Cuando han pasado 10 minutos sin que el usuario lo complete
  Entonces el sistema envía un recordatorio con el enlace nuevamente
  Y el usuario puede retomar o escribir "cancelar" para abortar

Escenario 5: Error de autorización
  Dado que el usuario intentó autorizar
  Cuando la autorización falla por cualquier razón técnica
  Entonces el sistema informa el error en lenguaje simple ("No pudimos conectar tu cuenta")
  Y ofrece reintentar o elegir el otro proveedor
  Y no avanza al paso siguiente hasta que haya conexión válida

### Definición de Done

- [ ]  El enlace OAuth se genera y envía por el chat sin requerir ninguna app adicional
- [ ]  El token de acceso se almacena de forma segura (nunca visible para el usuario)
- [ ]  El estado de conexión persiste entre sesiones
- [ ]  El flujo funciona en WhatsApp y en Telegram
- [ ]  El recordatorio de 10 minutos está implementado y testeado
- [ ]  Existe manejo de error para todos los casos de fallo de autorización
- [ ]  QA confirmó el flujo completo en ambos proveedores

**Story Points: 5** _Justificación: La interfaz es puramente conversacional (sin UI propia), pero la integración OAuth con dos proveedores distintos, el manejo de estado y el almacenamiento seguro del token añaden complejidad técnica real. No es un 3 porque son dos integraciones, no una._

**Dependencias:** Ninguna. Es la primera HU del flujo de onboarding.