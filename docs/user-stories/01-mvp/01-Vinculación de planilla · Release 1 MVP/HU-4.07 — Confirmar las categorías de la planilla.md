

**Como** usuario, **quiero** que el sistema reconozca las categorías que ya uso en mi planilla y me permita confirmarlas o ajustarlas, **para** que cuando registre un gasto en lenguaje natural, el sistema use mis categorías reales y no invente nombres que no existen en mi planilla.

### Criterios de Aceptación (Gherkin)


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