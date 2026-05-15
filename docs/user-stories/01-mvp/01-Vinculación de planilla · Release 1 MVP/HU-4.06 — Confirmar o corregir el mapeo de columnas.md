

**Como** usuario, **quiero** poder revisar el mapeo que el sistema propuso y corregirlo desde el chat si algo está mal, **para** asegurarme de que los gastos se van a guardar en las columnas correctas de mi planilla antes de empezar a usarlo.

### Criterios de Aceptación (Gherkin)


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

### Definición de Done

- [ ]  La confirmación simple ("sí/ok") cierra el mapeo y avanza
- [ ]  La corrección por campo en lenguaje natural está implementada
- [ ]  El sistema muestra el mapeo actualizado tras cada corrección
- [ ]  La validación de columna inexistente está implementada
- [ ]  El estado persiste si el usuario abandona el flujo a mitad
- [ ]  QA confirmó correcciones de 1 campo, 3 campos y corrección de columna inválida

**Story Points: 3** _Justificación: La lógica conversacional de corrección incremental tiene complejidad media. El reto principal es parsear "la categoría está en la columna E" de forma robusta. La persistencia de estado añade un caso de prueba adicional pero no cambia el orden de magnitud._

**Dependencias:** HU-4.05 (el mapeo debe haber sido propuesto).