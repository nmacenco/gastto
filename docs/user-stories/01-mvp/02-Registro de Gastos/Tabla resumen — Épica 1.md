
|ID|Título corto|Release|Story Points|Dependencias|
|---|---|---|---|---|
|E1-US-01|Envío de texto libre|MVP|3|E4 (vinculación completa), API canal mensajería|
|E1-US-02|Acuse de recibo inmediato|MVP|2|E1-US-01, infraestructura asíncrona|
|E1-US-03|Detección de monto y moneda|MVP|5|E1-US-01, E1-US-02, perfil usuario (moneda por defecto)|
|E1-US-04|Asignación de categoría por palabras clave|MVP|5|E4-US-06 (vocabulario planilla), E1-US-03|
|E1-US-05|Solicitud de aclaración|MVP|5|E1-US-03, E1-US-04, estado conversacional|
|E1-US-06|Resumen del gasto para revisión|MVP|3|E1-US-03, E1-US-04, E1-US-05|
|E1-US-07|Corrección de campo en lenguaje natural|MVP|5|E1-US-06|
|E1-US-08|Confirmación con respuesta mínima|MVP|2|E1-US-06, E1-US-07|
|E1-US-09|Cancelación sin consecuencias|MVP|3|Estado conversacional, E1-US-05, E1-US-06, E1-US-07|
|E1-US-10|Confirmación de guardado con ubicación|MVP|3|E4 (escritura + metadata), E1-US-08, E1-US-12|
|E1-US-11|Deshacer último gasto|MVP|5|E1-US-10, E4 (operación de eliminación)|
|E1-US-12|Notificación de fallo en guardado|MVP|5|E1-US-10, E4 (tipos de error diferenciados)|
|E1-US-13|Cola de gastos pendientes con procesamiento secuencial|MVP|8|E1-US-01 a E1-US-12, HU-0.04|
|E1-US-14|Interpretación de fechas relativas|R2|5|E1-US-06, zona horaria del usuario|
|E1-US-15|Identificación del medio de pago|R2|3|E4 (mapeo incluye medio de pago), E1-US-04|
|E1-US-16|Recepción y transcripción de voz|R2|5|E1-US-03 a E1-US-10, servicio STT|
|E1-US-17|Manejo de transcripciones con baja confianza|R2|3|E1-US-16|
|E1-US-18|Classify and register linked subcategories|R2|8|HU-4.08, HU-4.07, E1-US-04, E1-US-06 through E1-US-08, E1-US-10, E1-US-12, E1-US-13|
|**Total MVP**|||**54 SP**||
|**Total R2**|||**24 SP**||
|**Total Épica 1**|||**78 SP**||

> **Traceability note:** The historical Release 2 file `E1-US-13 — Registro de varios gastos en un único mensaje.md` remains unchanged. Its identifier conflicts with the implemented MVP pending-expense queue story, so this table uses `E1-US-13` for the queue and does not count the historical multi-expense story again.
