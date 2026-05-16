
# Épica 1 — Registro de Gastos

## 🟢 Release 1 — MVP

---

### E1-US-01 — Envío de texto libre para registrar un gasto

**Historia de usuario**

> Como usuario que quiere registrar un gasto, quiero enviar un mensaje de texto en lenguaje natural dentro de mi chat de WhatsApp o Telegram, para iniciar el registro sin tener que aprender ningún formato ni abrir ninguna otra aplicación.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Envío de texto libre para registrar un gasto

  Scenario: Flujo feliz — mensaje con monto y concepto claros
    Given que el usuario tiene FinFlow activo en su canal de mensajería
    And la planilla del usuario ya está vinculada y configurada
    When el usuario envía un mensaje como "Pagué el almuerzo, 12 euros"
    Then el sistema acusa recibo en menos de 1 segundo
    And inicia el flujo de interpretación del gasto

  Scenario: Mensaje con información parcial
    Given que el usuario tiene FinFlow activo
    When el usuario envía un mensaje como "Almuerzo 12" sin especificar moneda
    Then el sistema acusa recibo en menos de 1 segundo
    And inicia el flujo de interpretación, solicitando aclaración en el paso correspondiente

  Scenario: Mensaje vacío o sin contenido financiero reconocible
    Given que el usuario tiene FinFlow activo
    When el usuario envía un mensaje como "Hola" o "👋"
    Then el sistema responde con un mensaje amigable indicando cómo registrar un gasto
    And no inicia ningún flujo de guardado

  Scenario: Mensaje muy largo (más de 500 caracteres)
    Given que el usuario tiene FinFlow activo
    When el usuario envía un mensaje que supera los 500 caracteres
    Then el sistema acusa recibo
    And intenta extraer la información del gasto del contenido relevante
    And si no puede interpretarlo, solicita que lo reformule en una sola frase
```

---

**Definición de Done**

- El sistema recibe mensajes de texto en WhatsApp y Telegram y acusa recibo en ≤ 1 segundo en condiciones normales de red.
- Los mensajes sin contenido financiero reconocible generan una respuesta orientativa, no un error.
- Los mensajes con información parcial pasan al flujo de interpretación sin bloquearse en esta etapa.
- El comportamiento está cubierto por tests de integración para ambos canales.
- No existe ninguna interfaz web o pantalla adicional involucrada en este paso.

**Story Points: 3**

> El canal de entrada ya existe (WhatsApp / Telegram). La complejidad real está en el acuse de recibo inmediato y el enrutamiento correcto del mensaje. No hay lógica de interpretación en esta historia; eso se resuelve en historias siguientes. El manejo de edge cases (mensajes vacíos, mensajes largos) añade superficie de prueba pero no complejidad de negocio.

**Dependencias**

- Épica 4 — Vinculación de planilla completada (E4-US-01 a E4-US-05): el sistema debe saber a qué planilla pertenece el usuario antes de que cualquier mensaje tenga destino.
- Integración con la API del canal de mensajería (WhatsApp Business API / Telegram Bot API) operativa.

---

### E1-US-02 — Acuse de recibo inmediato

**Historia de usuario**

> Como usuario que acaba de enviar un mensaje con un gasto, quiero recibir una señal visual o textual de que el sistema lo recibió en menos de un segundo, para no quedar en la incertidumbre ni reenviar el mensaje por error.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Acuse de recibo inmediato al recibir un mensaje

  Scenario: Flujo feliz — mensaje recibido dentro del tiempo límite
    Given que el usuario envió un mensaje describiendo un gasto
    When el sistema lo recibe
    Then el sistema envía un acuse de recibo en ≤ 1 segundo
    And el acuse es un mensaje breve y no invasivo (ej: "Recibido, procesando tu gasto…")
    And no bloquea al usuario para enviar otro mensaje mientras espera

  Scenario: Carga alta — el sistema tarda más de 1 segundo en procesar
    Given que el sistema está bajo carga elevada
    When el usuario envía un mensaje
    Then el acuse de recibo se envía de todos modos en ≤ 1 segundo
    And el procesamiento de interpretación continúa en segundo plano
    And el usuario recibe el resumen interpretado cuando esté listo, sin reenvíos solicitados

  Scenario: El sistema no puede acusar recibo (fallo total de conectividad)
    Given que el sistema pierde la conexión con el canal de mensajería
    When el usuario envía un mensaje
    Then el sistema no envía acuse de recibo
    And cuando la conexión se restablece, el sistema evalúa si el mensaje quedó pendiente de procesamiento
    And no genera un registro duplicado
```

---

**Definición de Done**

- El tiempo de acuse de recibo está medido en entorno de staging y cumple ≤ 1 segundo en el percentil 95.
- El acuse de recibo es un mensaje diferenciado visualmente del resumen final (no se confunden).
- El flujo de procesamiento es asíncrono: el acuse no bloquea la interpretación ni viceversa.
- Existe un mecanismo de idempotencia que evita procesar el mismo mensaje dos veces si llega duplicado.

**Story Points: 2**

> La funcionalidad es concreta y acotada: enviar un mensaje en ≤ 1 segundo. La complejidad reside en garantizar la asincronía y la idempotencia, pero no involucra lógica de negocio compleja. No tiene ramificaciones de flujo significativas.

**Dependencias**

- E1-US-01: el mensaje debe estar llegando correctamente al sistema.
- Infraestructura de mensajería asíncrona operativa (cola de mensajes o equivalente).

---

### E1-US-03 — Detección de monto y moneda

**Historia de usuario**

> Como sistema que recibe un mensaje de gasto, necesito detectar automáticamente el monto numérico y la moneda mencionados, para tener los datos mínimos indispensables de cualquier registro financiero.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Detección de monto y moneda en el texto del usuario

  Scenario: Monto y moneda explícitos en formato estándar
    Given que el sistema recibe el mensaje "Pagué 45,50 EUR en el supermercado"
    When el sistema procesa el texto
    Then extrae monto = 45.50 y moneda = EUR
    And continúa el flujo de interpretación

  Scenario: Moneda expresada como símbolo
    Given que el sistema recibe el mensaje "Gasté $1.200 en el taxi"
    When el sistema procesa el texto
    Then extrae monto = 1200 y moneda = la configurada por defecto del usuario (o solicita aclaración si no está definida)

  Scenario: Monto con separadores de miles y decimales variables según locale
    Given que el sistema recibe "Cargué nafta por 8.500,00 pesos"
    When el sistema procesa el texto
    Then extrae monto = 8500.00 y moneda = pesos (o la moneda por defecto del usuario)

  Scenario: Monto presente pero moneda ausente y sin configuración por defecto
    Given que el usuario no tiene moneda por defecto configurada
    And el mensaje dice "Pagué 30 por el café"
    When el sistema procesa el texto
    Then detecta monto = 30 pero no puede determinar la moneda
    And solicita aclaración al usuario: "¿En qué moneda fue ese gasto?"

  Scenario: Sin monto reconocible en el mensaje
    Given que el usuario envía "Fui al supermercado"
    When el sistema procesa el texto
    Then no detecta monto válido
    And solicita aclaración: "¿Cuánto gastaste?"

  Scenario: Monto negativo o cero
    Given que el usuario envía "Gasté 0 pesos en algo"
    When el sistema procesa el texto
    Then detecta monto = 0
    And solicita confirmación antes de continuar: "¿Querías registrar un gasto de $0?"
```

---

**Definición de Done**

- El extractor de monto y moneda funciona correctamente para las siguientes variantes documentadas: símbolo antes del número ($, €, £), código ISO después del número (EUR, ARS, USD), separadores de miles con punto o coma, decimales con punto o coma.
- Cuando la moneda no puede inferirse, el sistema siempre solicita aclaración antes de continuar, sin asumir valores incorrectos.
- El campo `moneda_por_defecto` del perfil de usuario es consultado como fallback antes de solicitar aclaración.
- Cobertura de tests unitarios ≥ 90% para la función de extracción de monto/moneda.

**Story Points: 5**

> La detección de montos parece simple, pero los formatos regionales (puntos vs. comas, símbolos vs. códigos ISO, monedas ambiguas como "$" que puede ser ARS, USD, MXN, etc.) añaden complejidad real. Requiere diseñar una lógica de fallback a moneda por defecto y el flujo de solicitud de aclaración cuando no hay suficiente información.

**Dependencias**

- E1-US-01 y E1-US-02: mensaje recibido y acuse enviado.
- Perfil del usuario con campo `moneda_por_defecto` disponible (puede venir de la configuración inicial de Épica 4).

---

### E1-US-04 — Asignación de categoría por palabras clave del texto

**Historia de usuario**

> Como sistema que interpreta un gasto, quiero asignar automáticamente una categoría basándome en las palabras clave del mensaje del usuario, para que el registro quede organizado en la planilla sin que el usuario tenga que especificar la categoría manualmente.

---

> **Nota de corte:** Esta historia cubre únicamente la asignación por palabras clave del texto. La mejora mediante historial previo del usuario se aborda en E1-US-05 (Release 2). Esta separación es intencional: en el MVP no existe historial, por lo que el mecanismo basado en historial no es aplicable.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Asignación de categoría por palabras clave

  Scenario: Palabra clave inequívoca presente en el mensaje
    Given que el sistema tiene un vocabulario de categorías configurado para el usuario
    And el mensaje es "Pagué el almuerzo, 12 euros"
    When el sistema procesa el texto
    Then asigna la categoría "Comida" (o su equivalente en la planilla del usuario)
    And incluye la categoría en el resumen para confirmación

  Scenario: Varias palabras clave posibles, todas apuntan a la misma categoría
    Given que el mensaje es "Cargué combustible para el auto"
    When el sistema procesa el texto
    Then asigna la categoría "Transporte" con alta confianza

  Scenario: Palabras clave ambiguas que pueden corresponder a más de una categoría
    Given que el mensaje es "Compré algo en el kiosco"
    When el sistema procesa el texto
    And la ambigüedad supera el umbral de confianza configurado
    Then el sistema propone la categoría más probable
    And indica al usuario que puede corregirla antes de confirmar

  Scenario: No se detecta ninguna palabra clave relevante
    Given que el mensaje es "Gasté 50 euros hoy"
    When el sistema procesa el texto
    And no encuentra coincidencia con ninguna categoría
    Then incluye el campo categoría como "Sin categoría" o equivalente en la planilla del usuario
    And en el resumen muestra el campo vacío con la opción de completarlo

  Scenario: La categoría inferida no existe en la planilla del usuario
    Given que el sistema infiere "Entretenimiento"
    But esa categoría no está en el vocabulario confirmado de la planilla del usuario
    When el sistema arma el resumen
    Then propone la categoría más cercana disponible en la planilla
    And lo señala en el resumen para que el usuario pueda corregir
```

---

**Definición de Done**

- El sistema tiene un vocabulario de categorías base multiidioma (español) ampliable.
- El vocabulario de categorías del usuario está tomado del proceso de vinculación de planilla (E4-US-06).
- La asignación por palabras clave cubre al menos los rubros más comunes: alimentación, transporte, vivienda, salud, entretenimiento, servicios.
- Cuando la confianza es baja o nula, el campo categoría queda visible en el resumen con indicación de corrección pendiente, pero no bloquea el flujo.
- Tests unitarios cubren los escenarios de alta confianza, baja confianza y sin coincidencia.

**Story Points: 5**

> Requiere construir el motor de clasificación por palabras clave y su integración con el vocabulario de la planilla del usuario. No es trivial porque el vocabulario es heterogéneo por usuario, pero tampoco es ML avanzado en esta historia. La complejidad está en los casos borde (ambigüedad, categoría inexistente en la planilla).

**Dependencias**

- E4-US-06: vocabulario de categorías de la planilla del usuario confirmado.
- E1-US-03: monto detectado (el flujo de interpretación debe estar en curso).

---

### E1-US-05 — Solicitud de aclaración ante datos ambiguos o faltantes

**Historia de usuario**

> Como usuario que envió un mensaje con información incompleta o ambigua, quiero que el sistema me pida exactamente el dato que falta en una sola pregunta, para poder completar el registro sin tener que reenviar el mensaje desde cero.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Solicitud de aclaración ante datos ambiguos o faltantes

  Scenario: Falta un único dato — moneda
    Given que el sistema procesó el mensaje "Pagué 30 por el café"
    And no pudo determinar la moneda
    When el sistema necesita aclaración
    Then envía exactamente una pregunta: "¿En qué moneda fue ese gasto?"
    And espera la respuesta antes de continuar

  Scenario: Falta un único dato — monto
    Given que el sistema procesó el mensaje "Fui al supermercado"
    And no encontró ningún monto
    When el sistema necesita aclaración
    Then envía exactamente una pregunta: "¿Cuánto gastaste?"
    And espera la respuesta antes de continuar

  Scenario: Ambigüedad en la categoría
    Given que el sistema procesó el mensaje "Compré algo en el kiosco, 8 euros"
    And la categoría inferida tiene confianza baja
    When el sistema arma el resumen
    Then muestra la categoría propuesta como editable
    And no hace una pregunta adicional; la corrección se gestiona en el paso de revisión (E1-US-06)

  Scenario: Faltan varios datos a la vez
    Given que el mensaje es "Gasté algo"
    And no hay monto, ni moneda, ni concepto reconocible
    When el sistema procesa el mensaje
    Then solicita primero el dato más bloqueante (el monto)
    And espera la respuesta antes de pedir el siguiente dato
    And no bombardea al usuario con múltiples preguntas en un mismo mensaje

  Scenario: El usuario no responde la aclaración y manda otro gasto
    Given que el sistema esperaba una respuesta de aclaración
    When el usuario envía un nuevo mensaje de gasto sin responder la pregunta anterior
    Then el sistema descarta el flujo anterior (sin guardarlo)
    And procesa el nuevo mensaje como un registro nuevo
    And notifica brevemente que el registro anterior fue cancelado

  Scenario: El usuario responde la aclaración con un valor inválido
    Given que el sistema preguntó "¿En qué moneda fue ese gasto?"
    When el usuario responde "no sé"
    Then el sistema reformula la pregunta con opciones concretas basadas en las monedas usadas previamente o en la moneda por defecto
```

---

**Definición de Done**

- El sistema nunca hace más de una pregunta por mensaje de aclaración.
- El orden de prioridad para solicitar datos faltantes está definido y documentado: monto > moneda > categoría.
- El flujo de aclaración tiene un timeout configurado: si el usuario no responde en X tiempo y manda otro mensaje de gasto, el flujo anterior se cancela limpiamente.
- El estado del flujo en curso (gasto pendiente de aclaración) persiste entre mensajes del mismo usuario.
- Existe un test de integración que cubre el escenario de "nuevo gasto interrumpe aclaración previa".

**Story Points: 5**

> La gestión de estado conversacional (mantener el contexto de un gasto a medio completar entre turnos de conversación) es la mayor complejidad de esta historia. Las preguntas en sí son simples, pero el manejo del contexto, el timeout y la interrupción por nuevo gasto requieren una solución de estado persistente.

**Dependencias**

- E1-US-03: detección de monto y moneda (es el disparador principal de aclaraciones).
- E1-US-04: asignación de categoría (puede generar necesidad de aclaración secundaria).
- Mecanismo de estado conversacional persistente por usuario.

---

### E1-US-06 — Resumen del gasto interpretado para revisión

**Historia de usuario**

> Como usuario que acaba de describir un gasto, quiero recibir un resumen estructurado de cómo el sistema interpretó mi mensaje antes de que se guarde nada, para poder verificar que los datos son correctos y tener control real sobre lo que entra en mi planilla.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Resumen del gasto interpretado antes del guardado

  Scenario: Flujo feliz — todos los datos detectados correctamente
    Given que el sistema interpretó correctamente el gasto
    When presenta el resumen al usuario
    Then el resumen incluye: concepto, monto, moneda, categoría y fecha (o "hoy" si no se especificó)
    And el formato es claro y legible dentro del chat
    And el resumen incluye instrucciones para confirmar, corregir o cancelar

  Scenario: Campo categoría con confianza baja
    Given que la categoría asignada tiene confianza baja
    When el sistema presenta el resumen
    Then el campo categoría aparece marcado visualmente (ej: con ❓ o "¿Correcto?")
    And el resto del resumen se muestra con normalidad

  Scenario: Campo fecha no detectado
    Given que el mensaje no mencionó fecha
    When el sistema presenta el resumen
    Then el campo fecha muestra "Hoy" como valor por defecto
    And el usuario puede corregirlo si lo desea antes de confirmar

  Scenario: El usuario no interactúa con el resumen
    Given que el sistema envió el resumen
    When pasan más de 10 minutos sin respuesta del usuario
    Then el sistema envía un recordatorio único: "¿Confirmamos el registro?"
    And si pasan otros 10 minutos sin respuesta, el flujo se cancela automáticamente sin guardar nada

  Scenario: Resumen con información sensible (monto muy alto)
    Given que el monto detectado es inusualmente alto (ej: más de 10 veces el promedio histórico si existe)
    When el sistema presenta el resumen
    Then muestra el monto con un indicador de atención (ej: "⚠️ Monto inusualmente alto")
    And solicita confirmación explícita antes de permitir el guardado
```

---

**Definición de Done**

- El resumen siempre incluye los cinco campos mínimos: concepto, monto, moneda, categoría, fecha.
- Los campos con confianza baja están visualmente diferenciados en el mensaje del resumen.
- El resumen siempre muestra las opciones de acción disponibles (confirmar / corregir / cancelar).
- El mecanismo de timeout y recordatorio único está implementado y probado.
- El formato del resumen es consistente entre WhatsApp y Telegram (puede haber diferencias de markdown pero la información es idéntica).

**Story Points: 3**

> Generar el resumen es relativamente directo una vez que los datos están interpretados. La complejidad reside en el manejo del timeout, el recordatorio y los marcadores visuales de baja confianza. No involucra lógica de negocio nueva, sino presentación y gestión de estado.

**Dependencias**

- E1-US-03, E1-US-04, E1-US-05: interpretación completa del gasto.
- Mecanismo de estado conversacional con soporte de timeout.

---

### E1-US-07 — Corrección de un campo erróneo en lenguaje natural

**Historia de usuario**

> Como usuario que está revisando el resumen de un gasto antes de guardarlo, quiero poder corregir cualquier campo equivocado respondiendo en lenguaje natural, para no tener que cancelar el registro y empezar desde cero por un simple error de interpretación.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Corrección de campos del resumen en lenguaje natural

  Scenario: Corrección del monto
    Given que el sistema mostró un resumen con monto = 12 EUR
    When el usuario responde "no, fueron 15"
    Then el sistema actualiza el monto a 15 EUR
    And presenta el resumen actualizado para una nueva confirmación

  Scenario: Corrección de la categoría
    Given que el sistema asignó categoría "Comida"
    When el usuario responde "ponlo en transporte"
    Then el sistema actualiza la categoría a "Transporte" (o el equivalente en la planilla del usuario)
    And presenta el resumen actualizado

  Scenario: Corrección de la fecha
    Given que el sistema asumió fecha = hoy
    When el usuario responde "fue ayer"
    Then el sistema actualiza la fecha al día anterior
    And presenta el resumen actualizado

  Scenario: Corrección de varios campos en un solo mensaje
    Given que el resumen tiene monto = 12 y categoría = "Comida"
    When el usuario responde "no, fueron 15 y es transporte"
    Then el sistema actualiza ambos campos simultáneamente
    And presenta el resumen actualizado una sola vez (no dos mensajes separados)

  Scenario: Corrección con valor inválido
    Given que el resumen muestra monto = 12 EUR
    When el usuario responde "cambia el monto a veinte mil millones"
    Then el sistema detecta el valor como inusualmente alto
    And solicita confirmación explícita antes de aplicar el cambio

  Scenario: Mensaje de corrección no interpretable
    Given que el sistema mostró el resumen
    When el usuario responde algo no relacionado con ningún campo (ej: "ajá")
    Then el sistema solicita aclaración: "¿Querías confirmar, corregir o cancelar el registro?"
    And no modifica ningún dato ni guarda nada
```

---

**Definición de Done**

- Las correcciones de monto, moneda, categoría y fecha están implementadas y probadas.
- El sistema puede aplicar correcciones de más de un campo en un único mensaje del usuario.
- Después de cada corrección se presenta un resumen actualizado; el ciclo de corrección puede repetirse hasta que el usuario confirme o cancele.
- El número máximo de ciclos de corrección está definido (recomendado: 5 ciclos) para evitar loops infinitos; al superarse, el sistema ofrece cancelar o confirmar el estado actual.
- Las correcciones no se guardan en la planilla hasta que el usuario confirme explícitamente (E1-US-08).

**Story Points: 5**

> Interpretar una corrección en lenguaje natural es similar a interpretar el gasto original, pero con el contexto adicional del resumen previo. La capacidad de corregir múltiples campos en un mensaje y la gestión del ciclo de corrección añaden complejidad incremental sobre la base ya construida.

**Dependencias**

- E1-US-06: el resumen debe existir y estar en estado "pendiente de confirmación".
- El motor de interpretación de E1-US-03 y E1-US-04 es reutilizable para interpretar los mensajes de corrección.

---

### E1-US-08 — Confirmación del registro con respuesta mínima

**Historia de usuario**

> Como usuario que revisó el resumen de su gasto y está satisfecho con los datos, quiero poder confirmar el registro con una respuesta mínima como "sí", "ok" o "dale", para cerrar el flujo de forma natural sin fricciones adicionales.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Confirmación del registro con respuesta mínima

  Scenario: Confirmación con palabra afirmativa estándar
    Given que el sistema presentó el resumen del gasto
    When el usuario responde "sí", "si", "ok", "dale", "confirmo", "correcto", "listo", "va"
    Then el sistema inicia el proceso de guardado
    And no solicita ninguna confirmación adicional

  Scenario: Confirmación con respuesta afirmativa en variante regional
    Given que el sistema presentó el resumen
    When el usuario responde "bárbaro", "okey", "perfecto", "yep", "sip" u otras variantes coloquiales
    Then el sistema las reconoce como confirmación válida
    And inicia el proceso de guardado

  Scenario: Respuesta ambigua que podría ser confirmación o corrección
    Given que el sistema presentó el resumen con categoría "Comida"
    When el usuario responde "comida sí, pero el monto no"
    Then el sistema interpreta esto como una corrección parcial, no como una confirmación
    And actualiza solo el monto siguiendo el flujo de E1-US-07

  Scenario: Respuesta que no es ni confirmación ni corrección ni cancelación
    Given que el sistema presentó el resumen
    When el usuario responde con algo no interpretable (ej: "🤔")
    Then el sistema responde: "¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?"
    And espera una nueva respuesta sin modificar ningún dato
```

---

**Definición de Done**

- El vocabulario de palabras de confirmación está documentado y cubre variantes regionales del español (España, Argentina, México, Chile como mínimo).
- Una confirmación válida dispara el proceso de guardado descrito en E1-US-10.
- Las respuestas ambiguas se enrutan al flujo de corrección (E1-US-07) sin guardar datos incorrectos.
- Las respuestas no interpretables generan una pregunta de orientación, no un error.

**Story Points: 2**

> El vocabulario de confirmación es fijo y acotado. La única complejidad relevante es distinguir una confirmación de una corrección parcial, que se resuelve reutilizando el motor de interpretación ya construido. No hay nueva lógica de negocio significativa.

**Dependencias**

- E1-US-06: el resumen debe estar en estado "pendiente de confirmación".
- E1-US-07: el flujo de corrección debe estar disponible para el caso de ambigüedad.

---

### E1-US-09 — Cancelación del registro sin consecuencias

**Historia de usuario**

> Como usuario que está en medio de un flujo de registro de gasto, quiero poder cancelar el proceso en cualquier momento con una respuesta simple, para salir del flujo sin que ningún dato sea guardado y sin efectos secundarios en mi planilla.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Cancelación del registro en cualquier punto del flujo

  Scenario: Cancelación explícita durante el resumen
    Given que el sistema presentó el resumen del gasto
    When el usuario responde "no", "cancelar", "cancela", "no registres", "para"
    Then el sistema descarta todos los datos del gasto en curso
    And confirma la cancelación: "Registro cancelado. No se guardó nada."
    And el sistema queda listo para recibir un nuevo mensaje

  Scenario: Cancelación durante una solicitud de aclaración
    Given que el sistema esperaba una aclaración del usuario
    When el usuario responde "cancelar"
    Then el sistema descarta el gasto en curso
    And confirma la cancelación
    And el sistema queda listo para recibir un nuevo mensaje

  Scenario: Cancelación con comando global ("stop", "salir")
    Given que el usuario está en cualquier punto del flujo de registro
    When el usuario envía "stop" o "salir"
    Then el sistema cancela el flujo activo (si existe)
    And responde confirmando que no se guardó nada

  Scenario: El usuario intenta cancelar cuando no hay flujo activo
    Given que no hay ningún flujo de registro en curso
    When el usuario envía "cancelar"
    Then el sistema responde amigablemente que no hay ningún registro pendiente
    And no genera ningún error

  Scenario: Cancelación seguida de un nuevo gasto inmediatamente
    Given que el usuario canceló un registro
    When inmediatamente envía un nuevo mensaje de gasto
    Then el sistema procesa el nuevo mensaje como un registro completamente nuevo
    And no hay rastros del flujo cancelado anteriormente
```

---

**Definición de Done**

- La cancelación funciona en todos los estados del flujo: durante aclaración, durante resumen, durante corrección.
- Al cancelar, ningún dato del gasto en curso queda persistido en ninguna capa del sistema.
- El comando "stop" funciona como cancelación global en cualquier punto.
- El sistema queda en estado limpio y listo para recibir un nuevo mensaje inmediatamente después de la cancelación.
- Existe un test de integración que verifica que la cancelación no deja datos huérfanos en el sistema.

**Story Points: 3**

> La cancelación parece simple pero requiere que el sistema implemente correctamente el rollback del estado conversacional en cualquier punto del flujo. La cobertura de todos los estados posibles y la limpieza de datos son los puntos de complejidad principales.

**Dependencias**

- Mecanismo de estado conversacional con soporte de limpieza completa del contexto activo.
- E1-US-05, E1-US-06, E1-US-07: los estados del flujo donde puede activarse la cancelación deben estar definidos.

---

### E1-US-10 — Confirmación del guardado con referencia a la ubicación en la planilla

**Historia de usuario**

> Como usuario que confirmó el registro de un gasto, quiero recibir un mensaje de confirmación que indique exactamente dónde quedó guardado el dato en mi planilla (hoja y fila), para tener la certeza de que el proceso se completó correctamente y poder verificarlo si lo deseo.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Confirmación del guardado con referencia a la ubicación

  Scenario: Guardado exitoso con planilla de una sola hoja
    Given que el usuario confirmó el registro de un gasto
    And el guardado en la planilla fue exitoso
    When el sistema envía la confirmación
    Then el mensaje incluye: concepto, monto y moneda del gasto guardado
    And indica la hoja y la fila donde quedó registrado (ej: "Guardado en 'Gastos', fila 47")

  Scenario: Guardado exitoso con planilla de múltiples hojas
    Given que la planilla del usuario tiene varias hojas y el gasto corresponde a una específica
    When el sistema envía la confirmación
    Then indica la hoja correcta y el número de fila
    And el formato es legible dentro del chat

  Scenario: Guardado exitoso pero no se puede determinar el número de fila
    Given que el guardado fue exitoso
    But el sistema no puede determinar el número de fila exacto
    When envía la confirmación
    Then indica la hoja donde se guardó
    And omite el número de fila sin generar un mensaje de error

  Scenario: El guardado falla
    Given que el sistema intentó guardar el gasto
    And el guardado falla por cualquier motivo
    When el sistema detecta el fallo
    Then NO envía el mensaje de confirmación exitosa
    And gestiona el fallo según el flujo de E1-US-12
```

---

**Definición de Done**

- El mensaje de confirmación exitosa siempre incluye hoja de destino y número de fila cuando están disponibles.
- El mensaje de confirmación nunca se envía si el guardado no fue confirmado por la planilla de destino.
- El tiempo entre la confirmación del usuario y el mensaje de guardado exitoso es ≤ 3 segundos en condiciones normales.
- El flujo de fallo (E1-US-12) está integrado como rama alternativa de esta historia.

**Story Points: 3**

> El guardado en sí depende de la Épica 4, pero el mensaje de confirmación con referencia a la ubicación requiere que el servicio de escritura en planilla devuelva metadata (hoja + fila). La integración de esa metadata en el mensaje y la gestión del caso en que no está disponible añaden complejidad moderada.

**Dependencias**

- E4: el servicio de escritura en planilla debe retornar metadata de ubicación (hoja, fila) como parte de la respuesta de éxito.
- E1-US-08: la confirmación del usuario debe haber disparado el proceso de guardado.
- E1-US-12: el flujo de fallo debe estar definido como rama alternativa.

---

### E1-US-11 — Deshacer el último gasto registrado

**Historia de usuario**

> Como usuario que acaba de registrar un gasto y se da cuenta de que cometió un error, quiero poder deshacerlo con un comando simple desde el chat, para que el registro sea eliminado de mi planilla sin que tenga que abrirla manualmente.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Deshacer el último gasto registrado

  Scenario: Deshacer inmediatamente después del guardado
    Given que el sistema acaba de confirmar el guardado de un gasto
    When el usuario envía "deshacer", "undo" o "borrar el último"
    Then el sistema elimina el registro de la planilla
    And confirma: "Listo, se eliminó el último registro ([concepto], [monto])."

  Scenario: Deshacer cuando ya pasó tiempo (nuevo mensaje enviado después)
    Given que el usuario registró un gasto hace varios minutos
    And desde entonces envió otros mensajes (no de gasto) al bot
    When el usuario envía "deshacer"
    Then el sistema confirma cuál es el último gasto registrado
    And pide confirmación explícita antes de eliminarlo: "¿Elimino '[concepto], [monto]' registrado a las [hora]?"

  Scenario: Deshacer cuando ya se registraron dos o más gastos después
    Given que el usuario tiene múltiples gastos registrados
    When el usuario envía "deshacer"
    Then el sistema solo ofrece deshacer el más reciente
    And no ofrece deshacer múltiples registros en esta historia (eso es backlog)

  Scenario: No hay ningún gasto registrado para deshacer
    Given que el usuario no tiene registros en la sesión actual o la planilla está vacía
    When el usuario envía "deshacer"
    Then el sistema responde: "No encontré ningún registro reciente para deshacer."
    And no realiza ninguna acción sobre la planilla

  Scenario: El sistema no puede eliminar el registro (error de escritura en planilla)
    Given que el usuario solicitó deshacer
    And el sistema no puede modificar la planilla en ese momento
    When intenta realizar la eliminación
    Then notifica al usuario del fallo con instrucciones claras
    And no deja el sistema en un estado inconsistente
```

---

**Definición de Done**

- "Deshacer" elimina el último registro de la planilla y confirma la operación con el concepto y monto del registro eliminado.
- El alcance de esta historia es exclusivamente el último registro. Múltiples "deshacer" en cadena no están incluidos en este scope.
- Cuando ya se registraron gastos posteriores, el sistema pide confirmación explícita antes de eliminar para evitar errores accidentales.
- La operación de deshacer genera una entrada de log interno (auditoría mínima: qué se eliminó, cuándo, por qué usuario).
- El fallo en la eliminación genera una notificación útil, no un error técnico expuesto al usuario.

**Story Points: 5**

> Requiere que el sistema mantenga referencia al último registro guardado (ID de fila + hoja) por usuario y que el servicio de escritura en planilla soporte operaciones de eliminación. La confirmación explícita cuando hay registros intermedios y el manejo de fallos en la eliminación añaden complejidad más allá del caso feliz.

**Dependencias**

- E1-US-10: el sistema debe guardar la referencia al último registro exitoso por usuario.
- E4: el servicio de escritura en planilla debe soportar la operación de eliminación por referencia.

---

### E1-US-12 — Notificación de fallo en el guardado con instrucciones de resolución

**Historia de usuario**

> Como usuario cuyo gasto no pudo guardarse correctamente, quiero recibir un aviso claro que me indique que el registro falló y qué debo hacer para resolverlo, para no quedar con la falsa certeza de que mis datos están guardados cuando en realidad no lo están.

---

**Criterios de aceptación**

gherkin

```gherkin
Feature: Notificación de fallo en el guardado

  Scenario: Fallo por pérdida de conexión con la planilla
    Given que el usuario confirmó el registro de un gasto
    And el sistema no puede alcanzar la planilla en ese momento
    When se detecta el fallo
    Then el sistema notifica al usuario: "No pude guardar tu gasto. Parece que hay un problema de conexión con tu planilla."
    And ofrece una opción para reintentar: "Responde 'reintentar' para intentarlo de nuevo."
    And conserva los datos del gasto en memoria para el reintento (sin perderlos)

  Scenario: Fallo por permisos revocados en la planilla
    Given que el token de acceso del usuario a su planilla expiró o fue revocado
    When el sistema intenta guardar
    Then notifica: "No tengo acceso a tu planilla. Necesito que vuelvas a autorizar el acceso."
    And provee instrucciones concretas para re-autorizar (un paso, no un manual técnico)

  Scenario: Fallo por estructura de planilla modificada (columna eliminada)
    Given que la estructura de la planilla cambió desde la última configuración del mapeo
    When el sistema intenta guardar en una columna que ya no existe
    Then notifica: "La estructura de tu planilla cambió. Necesito que actualicemos la configuración."
    And provee el comando para iniciar la reconfiguración

  Scenario: Reintento exitoso después de un fallo
    Given que el usuario respondió "reintentar" después de un fallo de conexión
    And la conexión está disponible nuevamente
    When el sistema reintenta el guardado
    Then guarda el gasto correctamente
    And envía la confirmación estándar de E1-US-10

  Scenario: Reintento fallido (el problema persiste)
    Given que el usuario respondió "reintentar"
    And el problema persiste
    When el segundo intento también falla
    Then el sistema notifica que no pudo completarse
    And ofrece guardar los datos del gasto en un mensaje para que el usuario los copie manualmente como último recurso
```

---

**Definición de Done**

- El sistema nunca envía un mensaje de confirmación exitosa (E1-US-10) si el guardado no fue exitoso.
- Los mensajes de error distinguen entre al menos tres causas: problema de red, permisos revocados, estructura de planilla modificada.
- Los datos del gasto se conservan en memoria durante al menos 10 minutos después de un fallo para permitir el reintento.
- El usuario siempre tiene un camino claro de resolución; ningún mensaje de error termina en un callejón sin salida.
- El fallo silencioso (guardado no completado sin aviso al usuario) está explícitamente cubierto por un test de integración que verifica que no ocurre.

**Story Points: 5**

> La variedad de causas de fallo, la conservación de datos en memoria para reintento y la lógica de distinción entre tipos de error añaden complejidad real. El caso más crítico (fallo silencioso) requiere cobertura de test específica. Es una historia de manejo de errores de nivel medio-alto.

**Dependencias**

- E1-US-10: es la rama alternativa de esa historia.
- E4: los servicios de acceso a planilla deben exponer tipos de error distinguibles (red, permisos, estructura).

Perfecto. Decisiones de diseño cerradas, redacto.

---

## E1-US-13 — Cola de gastos pendientes con aviso de procesamiento secuencial

### Historia de usuario

Como usuario que envía varios gastos en mensajes separados y rápidos, quiero que el sistema los encole en orden y me avise cuántos tengo pendientes al terminar cada confirmación, para poder registrarlos todos sin perder ninguno y sin tener que esperar entre mensaje y mensaje.

> **Nota de alcance:** Esta historia cubre exclusivamente gastos enviados como mensajes de texto independientes en rápida sucesión. El registro de múltiples gastos en un único mensaje es un caso de uso distinto cubierto en Release 2. El límite de cola es 2 gastos pendientes además del activo (3 en total). Si se supera ese límite, el sistema bloquea nuevos ingresos y notifica al usuario.

---

### Criterios de aceptación

```gherkin
Feature: Cola de gastos pendientes con aviso de procesamiento secuencial

  Background:
    Given que el usuario tiene FinFlow activo en su canal de mensajería
    And la planilla del usuario está vinculada y configurada
    And no hay ningún flujo de registro activo al inicio

  # ─── FLUJO FELIZ ────────────────────────────────────────────────────────

  Scenario: El usuario envía tres gastos en mensajes separados antes de confirmar el primero
    Given que el sistema no tiene ningún gasto en cola ni activo
    When el usuario envía "gasté 10 pesos en comida"
    Then el sistema acusa recibo en ≤ 1 segundo
    And procesa el primer gasto y presenta su resumen
    And el estado del usuario pasa a EXPENSE_REVIEW

    When el usuario envía "3 pesos en transporte" antes de confirmar el primero
    Then el sistema acusa recibo en ≤ 1 segundo
    And encola el segundo gasto sin interrumpir el flujo activo
    And no presenta el resumen del segundo gasto todavía

    When el usuario envía "5 en un helado" antes de confirmar el primero
    Then el sistema acusa recibo en ≤ 1 segundo
    And encola el tercer gasto
    And la cola tiene ahora 2 gastos pendientes (máximo permitido)

    When el usuario confirma el primer gasto con "sí"
    Then el sistema guarda el primer gasto y envía la confirmación de ubicación
    And a continuación envía el aviso de cola:
      """
      Tenés 2 gastos pendientes. Vamos con el siguiente:
      """
    And presenta inmediatamente el resumen del segundo gasto para revisión
    And el estado del usuario pasa a EXPENSE_REVIEW para el segundo gasto

  Scenario: El usuario cancela el gasto activo con gastos pendientes en cola
    Given que el usuario tiene 1 gasto en revisión y 1 gasto en cola
    When el usuario cancela el gasto activo con "cancelar"
    Then el sistema descarta el gasto activo sin guardarlo
    And envía:
      """
      Registro cancelado. Tenés 1 gasto pendiente. Vamos con el siguiente:
      """
    And presenta el resumen del gasto que estaba en cola
    And el estado del usuario pasa a EXPENSE_REVIEW para ese gasto

  Scenario: El usuario procesa y confirma todos los gastos en cola de forma secuencial
    Given que el usuario tiene 1 gasto en revisión y 2 gastos en cola
    When el usuario confirma el gasto activo
    Then el sistema guarda el gasto y notifica la ubicación
    And presenta el siguiente gasto de la cola con el aviso correspondiente
    When el usuario confirma ese gasto
    Then el sistema guarda el gasto y notifica la ubicación
    And presenta el último gasto de la cola
    When el usuario confirma ese gasto
    Then el sistema guarda el gasto y notifica la ubicación
    And envía un mensaje de cierre:
      """
      ¡Listo! Registré los 3 gastos. No tenés más pendientes.
      """
    And el estado del usuario vuelve a IDLE

  # ─── LÍMITE DE COLA ─────────────────────────────────────────────────────

  Scenario: El usuario intenta enviar un cuarto gasto cuando la cola está llena
    Given que el usuario tiene 1 gasto en revisión y 2 gastos en cola (límite alcanzado)
    When el usuario envía un nuevo mensaje de gasto
    Then el sistema NO encola el nuevo mensaje
    And responde:
      """
      Ya tenés 3 gastos en proceso. Confirmá o cancelá el actual antes de agregar más.
      """
    And el nuevo mensaje de gasto se descarta sin guardarse
    And el flujo activo no se interrumpe

  Scenario: El usuario envía un quinto gasto después de que la cola se libera
    Given que el usuario tenía la cola llena y acaba de confirmar el gasto activo
    And la cola ahora tiene 1 gasto pendiente (por debajo del límite)
    When el usuario envía un nuevo mensaje de gasto
    Then el sistema lo encola sin problema
    And acusa recibo normalmente

  # ─── MENSAJES NO FINANCIEROS CON COLA ACTIVA ────────────────────────────

  Scenario: El usuario envía un mensaje no financiero mientras hay gastos en cola
    Given que el usuario tiene 1 gasto en revisión y 1 gasto en cola
    And el sistema está esperando confirmación del gasto activo
    When el usuario envía "gracias"
    Then el sistema no interpreta el mensaje como confirmación ni corrección
    And responde recordando el estado actual:
      """
      Todavía tenés un gasto pendiente de confirmar y 1 más en cola.
      ¿Confirmamos, corregimos o cancelamos el actual?
      """
    And no modifica la cola ni el gasto activo

  Scenario: El usuario repite un mensaje no financiero por segunda vez consecutiva
    Given que el sistema ya envió el aviso de pendientes una vez
    When el usuario vuelve a enviar un mensaje no financiero sin responder al aviso
    Then el sistema repite el aviso con el mismo formato
    And no escala a ningún otro comportamiento ni cancela la cola

  # ─── TIMEOUT CON COLA ACTIVA ────────────────────────────────────────────

  Scenario: El usuario no responde al gasto activo y hay gastos en cola
    Given que el usuario tiene 1 gasto en revisión y 1 gasto en cola
    When pasan 10 minutos sin respuesta del usuario
    Then el sistema envía el recordatorio estándar de E1-US-06:
      """
      ¿Confirmamos el registro tal como está?
      """
    And añade al mismo mensaje:
      """
      (También tenés 1 gasto más en cola esperando.)
      """

  Scenario: El usuario no responde después del recordatorio con cola activa
    Given que el sistema ya envió el recordatorio de timeout con mención de cola
    When pasan otros 10 minutos sin respuesta
    Then el sistema cancela el gasto activo sin guardarlo
    And presenta automáticamente el siguiente gasto de la cola con el mensaje:
      """
      El registro anterior venció sin confirmación y fue cancelado.
      Vamos con el siguiente gasto pendiente:
      """
    And el estado del usuario pasa a EXPENSE_REVIEW para ese gasto

  # ─── DESHACER CON COLA ACTIVA ────────────────────────────────────────────

  Scenario: El usuario solicita deshacer mientras hay gastos en cola
    Given que el usuario acaba de confirmar un gasto y tiene 1 más en cola
    And el sistema ya presentó el resumen del siguiente gasto
    When el usuario envía "deshacer"
    Then el sistema interpreta "deshacer" como referido al último gasto guardado
    And pausa la presentación del gasto en cola
    And ejecuta el flujo estándar de E1-US-11 para el último gasto guardado
    And una vez completado el deshacer, retoma la presentación del gasto en cola
```

---

### Definición de Done

- El sistema encola mensajes de gasto entrantes cuando el usuario está en `EXPENSE_REVIEW`, `EXPENSE_CLARIFYING` o `EXPENSE_CORRECTING`, sin interrumpir el flujo activo.
- El límite de 2 gastos en cola (3 en total incluyendo el activo) está implementado y el mensaje de bloqueo está probado.
- El aviso de cola aparece siempre después del mensaje de confirmación de guardado o de cancelación, nunca antes ni durante el flujo activo.
- Los mensajes no financieros con cola activa generan el aviso de recordatorio; el comportamiento es idéntico en el segundo y sucesivo intento.
- El timeout de 10 minutos con cola activa cancela el gasto activo y avanza automáticamente al siguiente, sin perder los gastos en cola.
- La operación de deshacer pausa la cola, ejecuta el flujo de E1-US-11 y retoma la cola al completarse.
- Los gastos descartados por límite de cola no dejan rastro en ninguna capa del sistema.
- El mensaje de cierre ("Registré los N gastos") se envía únicamente cuando la cola queda vacía y el último gasto fue confirmado.
- Existe un test de integración que cubre el flujo completo de 3 gastos en cola procesados secuencialmente hasta `IDLE`.
- El comportamiento es consistente en WhatsApp y Telegram.

---

### Story Points: 8

La complejidad no está en ninguna pieza individual sino en la **intersección de la cola con todos los flujos ya definidos**: timeout, cancelación, corrección, deshacer y mensajes no financieros. Cada uno de esos flujos existentes tiene que saber que puede haber una cola activa y comportarse de forma coherente. Eso convierte esta historia en la más transversal del MVP hasta ahora. Se asigna 8 (en lugar de 5+5) porque es una única historia de infraestructura conversacional que no tiene sentido partir: su valor está en la consistencia del comportamiento completo, no en las piezas por separado.

---

### Dependencias

- **E1-US-01 a E1-US-12**: todos los flujos existentes son dependencias, porque esta historia modifica el comportamiento de cada uno cuando hay cola activa.
- **HU-0.04** (gestión de estado conversacional): la FSM debe extenderse con los estados `EXPENSE_QUEUE_ACTIVE` como flag transversal, o bien el modelo de estado debe soportar una cola por usuario como campo de primer nivel. Esta decisión de implementación debe tomarse antes de que esta HU entre a sprint — es el riesgo técnico principal.
- **E1-US-11** (deshacer): la interacción deshacer + cola debe estar coordinada explícitamente con el equipo que implemente E1-US-11.

---

### Nota de diseño para el equipo de arquitectura

El estado conversacional actual modela un único flujo activo por usuario. Esta historia introduce **concurrencia implícita** (múltiples gastos en distintas fases del mismo flujo) dentro del modelo de un único usuario. La solución más limpia es **no cambiar la FSM principal**, sino añadir una estructura de cola separada en el perfil del usuario:

```
user_state: {
  active_flow: { state: EXPENSE_REVIEW, data: {...} },
  expense_queue: [
    { received_at: timestamp, raw_message: "3 pesos en transporte" },
    { received_at: timestamp, raw_message: "5 en un helado" }
  ]
}
```

Cuando `active_flow` se resuelve (confirmación, cancelación o timeout), el orquestador revisa `expense_queue`, extrae el primero en orden de llegada e inicia un nuevo `active_flow` con él. La cola nunca procesa dos gastos en paralelo.
