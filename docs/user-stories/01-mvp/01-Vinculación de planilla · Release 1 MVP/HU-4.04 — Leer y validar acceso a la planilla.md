

**Como** sistema, **quiero** leer el contenido de la hoja seleccionada y validar que tengo permisos de escritura, **para** poder operar sobre ella sin que el usuario descubra un error de permisos recién al intentar guardar su primer gasto.

### Criterios de Aceptación (Gherkin)


Escenario 1: Acceso de lectura y escritura confirmado
  Dado que el usuario seleccionó archivo y hoja
  Cuando el sistema intenta leer las primeras 10 filas de la hoja
  Entonces la lectura es exitosa
  Y el sistema verifica también que tiene permiso de escritura
  Y avanza al análisis de mapeo (HU-4.05) sin notificar al usuario (flujo transparente)

Escenario 2: El sistema tiene solo lectura, no escritura
  Dado que el sistema lee exitosamente la hoja
  Cuando intenta verificar permisos de escritura y no los tiene
  Entonces informa al usuario: "Puedo ver tu planilla pero no tengo permiso para escribir en ella"
  Y explica cómo cambiar los permisos en Google Drive / OneDrive
  Y no avanza hasta confirmar que tiene escritura

Escenario 3: La hoja está vacía
  Dado que el sistema accede a la hoja
  Cuando detecta que no tiene ningún contenido
  Entonces informa al usuario que la hoja parece estar vacía
  Y pregunta si es la hoja correcta o si quiere elegir otra
  Y si el usuario confirma que es la correcta, informa que creará la estructura desde cero (fuera de alcance del MVP, escalar a producto)

Escenario 4: Error de acceso (red, token expirado)
  Dado que el sistema intenta acceder a la hoja
  Cuando falla por razón técnica
  Entonces informa el tipo de problema en lenguaje simple
  Y ofrece reintentar automáticamente una vez
  Y si persiste, sugiere reconectar la cuenta (vuelve a HU-4.01)


### Definición de Done

- [ ]  La lectura de las primeras 10 filas está implementada para Google Sheets y Excel Online
- [ ]  La verificación de permisos de escritura está implementada
- [ ]  El caso de hoja vacía tiene manejo explícito
- [ ]  Los errores de red y token expirado tienen manejo y retry automático
- [ ]  Esta HU es transparente para el usuario cuando todo funciona (no genera mensaje)
- [ ]  QA confirmó los 4 escenarios incluyendo simulación de token expirado

**Story Points: 3** _Justificación: Técnicamente requiere manejo de permisos en dos APIs distintas y gestión de errores robusta. La interfaz conversacional es mínima (solo aparece en error). El retry y la detección de hoja vacía añaden casos de prueba no triviales._

**Dependencias:** HU-4.03 (hoja seleccionada).