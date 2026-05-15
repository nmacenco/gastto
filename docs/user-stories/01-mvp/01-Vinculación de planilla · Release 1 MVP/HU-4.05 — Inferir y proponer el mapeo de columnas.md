
**Como** sistema, **quiero** analizar los encabezados y datos de la planilla del usuario y sugerir a qué columna corresponde cada campo de FinFlow (fecha, monto, categoría, descripción, medio de pago), **para** que el usuario no tenga que configurar el mapeo desde cero y el proceso de onboarding sea fluido.

### Criterios de Aceptación (Gherkin)

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

### Definición de Done

- [ ]  El algoritmo de inferencia cubre español e inglés como mínimo
- [ ]  El sistema distingue entre mapeo de alta y baja confianza y lo comunica distinto
- [ ]  La detección de "sin encabezados" está implementada
- [ ]  Los campos no mapeados tienen manejo explícito (omisión confirmada)
- [ ]  El resultado del mapeo queda persistido para usarse en el guardado
- [ ]  QA probó con al menos 5 planillas reales con estructuras distintas

**Story Points: 5** _Justificación: El algoritmo de inferencia requiere lógica no trivial: normalización de strings, matching fuzzy, detección de tipos por contenido de las primeras filas, y manejo de idiomas. Es la HU técnicamente más compleja del onboarding._

**Dependencias:** HU-4.04 (la planilla debe estar leída y validada). 

