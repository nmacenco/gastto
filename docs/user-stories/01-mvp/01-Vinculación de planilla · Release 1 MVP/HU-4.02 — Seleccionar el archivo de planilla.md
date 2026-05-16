
**Como** usuario con la cuenta de almacenamiento ya conectada, **quiero** indicarle al sistema cuál es mi archivo de planilla desde el chat, **para** que el sistema sepa exactamente dónde tiene que escribir mis gastos.

### Criterios de Aceptación (Gherkin)

Escenario 1: El sistema busca y lista archivos relevantes
  Dado que el usuario tiene Google Drive o OneDrive conectado
  Cuando el sistema le pregunta cuál es su planilla
  Entonces el sistema busca en la cuenta archivos .xlsx, .ods y Google Sheets
  Y presenta una lista numerada con los archivos encontrados (máximo 5)
  Y ofrece la opción "Ninguno de estos / buscar por nombre"

Escenario 2: El usuario elige de la lista
  Dado que el sistema mostró la lista de archivos
  Cuando el usuario responde con el número del archivo
  Entonces el sistema confirma el archivo seleccionado mostrando su nombre completo
  Y pregunta qué hoja contiene los registros (avanza a HU-4.03)

Escenario 3: El usuario busca por nombre
  Dado que el usuario eligió "buscar por nombre" o el archivo no aparecía
  Cuando el usuario escribe parte del nombre del archivo
  Entonces el sistema muestra los resultados que coincidan
  Y el usuario puede elegir de esa lista refinada

Escenario 4: El usuario pega una URL directamente
  Dado que el usuario conoce el enlace de su planilla
  Cuando pega la URL en el chat
  Entonces el sistema valida que es un archivo al que tiene acceso
  Y confirma el archivo o informa si no tiene permisos

Escenario 5: No se encuentran archivos compatibles
  Dado que el sistema busca archivos
  Cuando no encuentra ningún .xlsx, .ods ni Google Sheets
  Entonces informa al usuario de forma clara
  Y sugiere verificar que el archivo está en la cuenta conectada
  Y ofrece la opción de escribir el nombre manualmente

### Definición de Done

- [ ]  La búsqueda funciona para Google Sheets, .xlsx y .ods
- [ ]  La lista no supera 5 ítems (los más recientemente modificados)
- [ ]  La selección por número y la búsqueda por nombre están implementadas
- [ ]  La validación de URL directa está implementada
- [ ]  El archivo seleccionado queda persistido en el perfil del usuario
- [ ]  QA confirmó el flujo en cuenta vacía, cuenta con muchos archivos y acceso por URL

**Story Points: 3** _Justificación: La búsqueda de archivos es una llamada a API estándar de Drive/OneDrive. La complejidad está en normalizar los tres formatos de respuesta, pero la lógica conversacional es lineal. No hay ramificaciones complejas._

**Dependencias:** HU-4.01 (la cuenta debe estar conectada).