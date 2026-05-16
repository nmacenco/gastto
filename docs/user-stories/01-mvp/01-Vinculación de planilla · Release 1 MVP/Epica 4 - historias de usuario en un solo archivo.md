
# Épica 4 — Vinculación de planilla · Release 1 MVP

> Antes de redactar, aplico la regla de división. La tarea _"Sistema analiza la planilla y sugiere el mapeo de columnas"_ ya está marcada para partir en tres. Lo hago aquí antes de escribir ninguna HU.

---

## HU-4.01 — Conectar cuenta de almacenamiento en la nube

**Como** usuario que quiere empezar a usar FinFlow, **quiero** conectar mi cuenta de Google Drive o OneDrive desde la conversación en WhatsApp/Telegram, **para** que el sistema pueda acceder a mi planilla de gastos sin que yo tenga que copiar y pegar datos manualmente.

### Criterios de Aceptación (Gherkin)

gherkin

```gherkin
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
```

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

---

## HU-4.02 — Seleccionar el archivo de planilla

**Como** usuario con la cuenta de almacenamiento ya conectada, **quiero** indicarle al sistema cuál es mi archivo de planilla desde el chat, **para** que el sistema sepa exactamente dónde tiene que escribir mis gastos.

### Criterios de Aceptación (Gherkin)

gherkin

```gherkin
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
```

### Definición de Done

- [ ]  La búsqueda funciona para Google Sheets, .xlsx y .ods
- [ ]  La lista no supera 5 ítems (los más recientemente modificados)
- [ ]  La selección por número y la búsqueda por nombre están implementadas
- [ ]  La validación de URL directa está implementada
- [ ]  El archivo seleccionado queda persistido en el perfil del usuario
- [ ]  QA confirmó el flujo en cuenta vacía, cuenta con muchos archivos y acceso por URL

**Story Points: 3** _Justificación: La búsqueda de archivos es una llamada a API estándar de Drive/OneDrive. La complejidad está en normalizar los tres formatos de respuesta, pero la lógica conversacional es lineal. No hay ramificaciones complejas._

**Dependencias:** HU-4.01 (la cuenta debe estar conectada).

---

## HU-4.03 — Seleccionar la hoja de registros

**Como** usuario con el archivo ya identificado, **quiero** indicarle al sistema en qué hoja están mis registros de gastos, **para** que el sistema no escriba en la hoja equivocada ni confunda pestañas de resumen con pestañas de datos.

### Criterios de Aceptación (Gherkin)

gherkin

```gherkin
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
```

### Definición de Done

- [ ]  El caso de hoja única está automatizado (sin pregunta al usuario)
- [ ]  La lista de hojas se muestra con nombres reales del archivo
- [ ]  La descripción por encabezados está implementada para el caso de duda
- [ ]  La selección por número y por nombre están implementadas
- [ ]  La hoja seleccionada queda persistida en el perfil del usuario
- [ ]  QA confirmó los escenarios con 1 hoja, 3 hojas y nombres con tildes/espacios

**Story Points: 2** _Justificación: La lógica es sencilla; es una consulta a la API para listar hojas y un match de string. El mayor riesgo es la normalización de nombres (tildes, mayúsculas), que es manejable. El caso de una sola hoja elimina la interacción._

**Dependencias:** HU-4.02 (el archivo debe estar seleccionado).

---

## HU-4.04 — Leer y validar acceso a la planilla

> _Primera parte del desglose de "Sistema analiza la planilla y sugiere mapeo"._

**Como** sistema, **quiero** leer el contenido de la hoja seleccionada y validar que tengo permisos de escritura, **para** poder operar sobre ella sin que el usuario descubra un error de permisos recién al intentar guardar su primer gasto.

### Criterios de Aceptación (Gherkin)

gherkin

```gherkin
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
```

### Definición de Done

- [ ]  La lectura de las primeras 10 filas está implementada para Google Sheets y Excel Online
- [ ]  La verificación de permisos de escritura está implementada
- [ ]  El caso de hoja vacía tiene manejo explícito
- [ ]  Los errores de red y token expirado tienen manejo y retry automático
- [ ]  Esta HU es transparente para el usuario cuando todo funciona (no genera mensaje)
- [ ]  QA confirmó los 4 escenarios incluyendo simulación de token expirado

**Story Points: 3** _Justificación: Técnicamente requiere manejo de permisos en dos APIs distintas y gestión de errores robusta. La interfaz conversacional es mínima (solo aparece en error). El retry y la detección de hoja vacía añaden casos de prueba no triviales._

**Dependencias:** HU-4.03 (hoja seleccionada).

---

## HU-4.05 — Inferir y proponer el mapeo de columnas

> _Segunda parte del desglose de "Sistema analiza la planilla y sugiere mapeo"._

**Como** sistema, **quiero** analizar los encabezados y datos de la planilla del usuario y sugerir a qué columna corresponde cada campo de FinFlow (fecha, monto, categoría, descripción, medio de pago), **para** que el usuario no tenga que configurar el mapeo desde cero y el proceso de onboarding sea fluido.

### Criterios de Aceptación (Gherkin)

gherkin

```gherkin
Escenario 1: Encabezados claros — mapeo de alta confianza
  Dado que la hoja tiene encabezados en la fila 1
  Cuando los encabezados contienen palabras reconocibles (Fecha, Monto, Categoría, etc.)
  Entonces el sistema propone el mapeo en un mensaje claro:
    "Esto es lo que encontré en tu planilla:
     📅 Fecha → columna A
     💰 Monto → columna B
     🏷️ Categoría → columna C
     📝 Descripción → columna D
     ¿Es correcto?"
  Y el usuario puede responder "sí" o corregir

Escenario 2: Encabezados ambiguos — mapeo de baja confianza
  Dado que los encabezados no son inequívocos (ej: "Col1", "Importe", "Tipo")
  Cuando el sistema infiere con menor certeza
  Entonces presenta el mapeo propuesto indicando su incertidumbre:
    "No estoy seguro de algunos campos, esto es mi mejor intento: [mapeo]"
  Y el usuario puede corregir campo por campo

Escenario 3: Sin encabezados — fila 1 contiene datos
  Dado que la fila 1 parece contener datos (no encabezados)
  Cuando el sistema lo detecta
  Entonces informa al usuario: "Parece que tu planilla no tiene fila de encabezados"
  Y pregunta en qué fila están los datos para asumir esa como inicio

Escenario 4: Campo de FinFlow sin columna equivalente
  Dado que el mapeo está en proceso
  Cuando un campo de FinFlow (ej: "medio de pago") no tiene columna equivalente en la planilla
  Entonces el sistema informa que omitirá ese campo al registrar
  Y el usuario puede indicar una columna manualmente o confirmar la omisión

Escenario 5: Planilla con columnas en idioma distinto al español
  Dado que los encabezados están en otro idioma (inglés, portugués)
  Cuando el sistema los analiza
  Entonces los reconoce correctamente (Date→Fecha, Amount→Monto, Category→Categoría)
  Y propone el mapeo igual que en el escenario 1
```

### Definición de Done

- [ ]  El algoritmo de inferencia cubre español e inglés como mínimo
- [ ]  El sistema distingue entre mapeo de alta y baja confianza y lo comunica distinto
- [ ]  La detección de "sin encabezados" está implementada
- [ ]  Los campos no mapeados tienen manejo explícito (omisión confirmada)
- [ ]  El resultado del mapeo queda persistido para usarse en el guardado
- [ ]  QA probó con al menos 5 planillas reales con estructuras distintas

**Story Points: 5** _Justificación: El algoritmo de inferencia requiere lógica no trivial: normalización de strings, matching fuzzy, detección de tipos por contenido de las primeras filas, y manejo de idiomas. Es la HU técnicamente más compleja del onboarding._

**Dependencias:** HU-4.04 (la planilla debe estar leída y validada).

---

## HU-4.06 — Confirmar o corregir el mapeo de columnas

> _Tercera parte del desglose de "Sistema analiza la planilla y sugiere mapeo"._

**Como** usuario, **quiero** poder revisar el mapeo que el sistema propuso y corregirlo desde el chat si algo está mal, **para** asegurarme de que los gastos se van a guardar en las columnas correctas de mi planilla antes de empezar a usarlo.

### Criterios de Aceptación (Gherkin)

gherkin

```gherkin
Escenario 1: El usuario confirma el mapeo completo
  Dado que el sistema mostró el mapeo propuesto
  Cuando el usuario responde "sí", "ok", "correcto" o equivalente
  Entonces el sistema guarda el mapeo definitivo
  Y avanza a la confirmación de categorías (HU-4.07)

Escenario 2: El usuario corrige un campo en lenguaje natural
  Dado que el sistema mostró el mapeo propuesto
  Cuando el usuario dice "no, la categoría está en la columna E" o similar
  Entonces el sistema actualiza solo ese campo del mapeo
  Y vuelve a mostrar el mapeo completo actualizado para una nueva confirmación

Escenario 3: El usuario corrige varios campos
  Dado que el usuario necesita corregir múltiples campos
  Cuando los corrige de a uno respondiendo en lenguaje natural
  Entonces el sistema acumula los cambios y muestra el mapeo actualizado tras cada corrección
  Y confirma el final cuando el usuario dice "listo" o "ok"

Escenario 4: El usuario indica una columna que no existe
  Dado que el usuario menciona una columna (ej: "columna Z")
  Cuando esa columna no existe en la planilla
  Entonces el sistema informa que no encontró esa columna
  Y muestra las columnas disponibles para que el usuario elija

Escenario 5: El usuario abandona el flujo de corrección
  Dado que el sistema está en el flujo de corrección
  Cuando el usuario no responde en 30 minutos
  Entonces el sistema guarda el estado y al retomar pregunta si quiere continuar desde donde estaba
```

### Definición de Done

- [ ]  La confirmación simple ("sí/ok") cierra el mapeo y avanza
- [ ]  La corrección por campo en lenguaje natural está implementada
- [ ]  El sistema muestra el mapeo actualizado tras cada corrección
- [ ]  La validación de columna inexistente está implementada
- [ ]  El estado persiste si el usuario abandona el flujo a mitad
- [ ]  QA confirmó correcciones de 1 campo, 3 campos y corrección de columna inválida

**Story Points: 3** _Justificación: La lógica conversacional de corrección incremental tiene complejidad media. El reto principal es parsear "la categoría está en la columna E" de forma robusta. La persistencia de estado añade un caso de prueba adicional pero no cambia el orden de magnitud._

**Dependencias:** HU-4.05 (el mapeo debe haber sido propuesto).

---

## HU-4.07 — Confirmar las categorías de la planilla

**Como** usuario, **quiero** que el sistema reconozca las categorías que ya uso en mi planilla y me permita confirmarlas o ajustarlas, **para** que cuando registre un gasto en lenguaje natural, el sistema use mis categorías reales y no invente nombres que no existen en mi planilla.

### Criterios de Aceptación (Gherkin)

gherkin

```gherkin
Escenario 1: El sistema detecta categorías existentes
  Dado que el mapeo de columnas está confirmado
  Cuando el sistema lee los valores únicos de la columna de categoría
  Entonces presenta la lista de categorías encontradas:
    "Encontré estas categorías en tu planilla: Alimentación, Transporte, Servicios, Ocio.
     ¿Las usamos tal cual? Puedes responder 'sí' o agregar/quitar alguna."

Escenario 2: El usuario confirma las categorías sin cambios
  Dado que el sistema mostró las categorías detectadas
  Cuando el usuario responde "sí" o equivalente
  Entonces el sistema guarda ese vocabulario de categorías
  Y el onboarding queda completado
  Y el sistema envía el mensaje de bienvenida final ("Todo listo, podés empezar a registrar")

Escenario 3: El usuario agrega una categoría faltante
  Dado que el sistema mostró las categorías
  Cuando el usuario dice "falta Salud" o "agregá Educación"
  Entonces el sistema añade esa categoría al vocabulario
  Y muestra la lista actualizada para confirmación final

Escenario 4: El usuario corrige el nombre de una categoría
  Dado que el sistema mostró las categorías
  Cuando el usuario dice "Ocio se llama Entretenimiento en realidad"
  Entonces el sistema actualiza el nombre en el vocabulario
  Y muestra la lista actualizada

Escenario 5: La columna de categoría está vacía (planilla nueva)
  Dado que el mapeo apunta a una columna de categoría
  Cuando esa columna no tiene valores (planilla sin historial)
  Entonces el sistema informa que no encontró categorías previas
  Y ofrece un set de categorías sugeridas por defecto (Alimentación, Transporte, Servicios, Ocio, Salud, Otros)
  Y el usuario puede aceptarlas, modificarlas o dictar las propias
```

### Definición de Done

- [ ]  La lectura de valores únicos de la columna de categoría está implementada
- [ ]  La confirmación simple avanza al cierre del onboarding
- [ ]  La adición y corrección de categorías en lenguaje natural funcionan
- [ ]  El caso de columna vacía tiene set de categorías por defecto
- [ ]  El vocabulario de categorías queda persistido y disponible para Épica 1
- [ ]  El mensaje de cierre de onboarding está implementado
- [ ]  QA confirmó planilla con 10+ categorías, sin categorías y con nombres en inglés

**Story Points: 3** _Justificación: La lectura de valores únicos y el matching de lenguaje natural para agregar/corregir son la complejidad principal. El set de defaults reduce el riesgo del caso vacío. Sin ramificaciones técnicas nuevas respecto a HUs anteriores._

**Dependencias:** HU-4.06 (mapeo confirmado). Bloqueante para HU-1.01 (Épica 1 MVP).