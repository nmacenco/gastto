

**Como** usuario con el archivo ya identificado, **quiero** indicarle al sistema en qué hoja están mis registros de gastos, **para** que el sistema no escriba en la hoja equivocada ni confunda pestañas de resumen con pestañas de datos.

### Criterios de Aceptación (Gherkin)


Escenario 1: Archivo con una sola hoja
  Dado que el archivo seleccionado tiene una única hoja
  Cuando el sistema lo detecta
  Entonces confirma automáticamente esa hoja sin preguntar
  Y informa al usuario: "Solo encontré una hoja: '[nombre]'. La usaré para registrar."
  Y avanza al análisis de estructura (HU-4.04)

Escenario 2: Archivo con múltiples hojas — el usuario elige
  Dado que el archivo tiene más de una hoja
  Cuando el sistema lista los nombres de las hojas
  Entonces el usuario puede responder con el número o el nombre de la hoja
  Y el sistema confirma la selección antes de avanzar

Escenario 3: El usuario no sabe cuál es la hoja correcta
  Dado que el sistema mostró la lista de hojas
  Cuando el usuario responde "no sé" o una variante similar
  Entonces el sistema describe brevemente el contenido de cada hoja (primera fila como encabezado)
  Y el usuario elige con esa información adicional

Escenario 4: El usuario escribe el nombre de la hoja
  Dado que el usuario escribe el nombre de la hoja directamente
  Cuando el nombre coincide exactamente o con variación menor (mayúsculas/tildes)
  Entonces el sistema confirma la hoja seleccionada
  Y avanza al análisis

Escenario 5: Nombre de hoja no encontrado
  Dado que el usuario escribe un nombre que no existe
  Cuando el sistema no encuentra coincidencia
  Entonces informa "No encontré una hoja con ese nombre" y muestra la lista nuevamente


### Definición de Done

- [ ]  El caso de hoja única está automatizado (sin pregunta al usuario)
- [ ]  La lista de hojas se muestra con nombres reales del archivo
- [ ]  La descripción por encabezados está implementada para el caso de duda
- [ ]  La selección por número y por nombre están implementadas
- [ ]  La hoja seleccionada queda persistida en el perfil del usuario
- [ ]  QA confirmó los escenarios con 1 hoja, 3 hojas y nombres con tildes/espacios

**Story Points: 2** _Justificación: La lógica es sencilla; es una consulta a la API para listar hojas y un match de string. El mayor riesgo es la normalización de nombres (tildes, mayúsculas), que es manejable. El caso de una sola hoja elimina la interacción._

**Dependencias:** HU-4.02 (el archivo debe estar seleccionado).