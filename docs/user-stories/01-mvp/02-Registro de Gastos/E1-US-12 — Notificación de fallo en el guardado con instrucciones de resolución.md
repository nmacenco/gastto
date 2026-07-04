
**Historia de usuario**

> Como usuario cuyo gasto no pudo guardarse correctamente, quiero recibir un aviso claro que me indique que el registro falló y qué debo hacer para resolverlo, para no quedar con la falsa certeza de que mis datos están guardados cuando en realidad no lo están.

---

**Criterios de aceptación**

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