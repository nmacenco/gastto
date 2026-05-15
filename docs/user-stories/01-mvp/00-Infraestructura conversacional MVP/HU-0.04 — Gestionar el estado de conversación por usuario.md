
**Como** sistema, **quiero** mantener el estado de la conversación de cada usuario entre mensajes, **para** que FinFlow sepa en qué paso del flujo está cada usuario y pueda responder con el contexto correcto (ej: si está en el onboarding, en el flujo de registro o en el flujo de consulta).

Criterios de Aceptación (Gherkin)

Escenario 1: Usuario nuevo — estado inicial
  Dado que un usuario escribe al bot por primera vez
  Cuando el sistema recibe su mensaje
  Entonces crea un registro de estado para ese user_id con estado "onboarding_inicio"
  Y lo persiste en almacenamiento

Escenario 2: Transición de estado correcta
  Dado que un usuario está en estado "onboarding_cuenta"
  Cuando completa la acción esperada en ese estado
  Entonces el sistema actualiza su estado al siguiente paso del flujo
  Y el siguiente mensaje del usuario es procesado con el nuevo contexto

Escenario 3: Persistencia entre sesiones
  Dado que un usuario estaba en estado "onboarding_mapeo" ayer
  Cuando vuelve a escribir hoy
  Entonces el sistema recupera su estado persistido
  Y retoma el flujo desde donde lo dejó, no desde el inicio

Escenario 4: Estado corrompido o no reconocido
  Dado que el sistema recupera un estado que no existe en el mapa de estados válidos
  Cuando intenta procesarlo
  Entonces loggea la anomalía
  Y resetea al usuario a un estado de recuperación seguro
  Y le informa: "Parece que algo falló. Vamos a empezar de nuevo."

Escenario 5: Timeout de sesión activa
  Dado que un usuario inició un flujo (ej: registro de gasto)
  Cuando no envía ningún mensaje en 30 minutos
  Entonces el sistema marca ese flujo como interrumpido
  Y cuando el usuario vuelve, le pregunta si quiere continuar o empezar de nuevo

### Definición de Done

- [ ]  El estado se persiste por user_id en almacenamiento durable (no en memoria)
- [ ]  Las transiciones de estado están definidas en un mapa explícito (no lógica ad hoc)
- [ ]  La recuperación entre sesiones funciona correctamente
- [ ]  El estado corrompido tiene manejo de recuperación segura
- [ ]  El timeout de 30 minutos está implementado
- [ ]  La estructura de estado es extensible para soportar Épica 1 y siguientes sin refactor
- [ ]  Tests de integración cubren los 5 escenarios

**Story Points: 5** _Justificación: Es la pieza de infraestructura más crítica y transversal del sistema. Un diseño deficiente aquí genera deuda técnica que afecta todas las épicas. El mapa de estados, la persistencia durable y el manejo de timeouts y estados corruptos requieren diseño deliberado, no solo código._

**Dependencias:** HU-0.02 y HU-0.03 (necesita poder recibir y enviar para ser testeable end-to-end)