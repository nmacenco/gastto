**Historia de usuario**

> Como usuario que envió un audio que el sistema no pudo transcribir con suficiente certeza, quiero recibir una notificación clara con la transcripción que el sistema obtuvo, para poder confirmarla o corregirla antes de que se intente interpretar el gasto.

---

**Criterios de aceptación**

Feature: Manejo de transcripciones con baja confianza

  Scenario: Transcripción con confianza por debajo del umbral
    Given que el servicio de transcripción devuelve un score de confianza bajo
    When el sistema recibe la transcripción
    Then muestra el texto transcripto al usuario con una advertencia: "Esto es lo que entendí: '[transcripción]'. ¿Es correcto?"
    And espera confirmación o corrección antes de continuar con la interpretación

  Scenario: El usuario confirma que la transcripción es correcta
    Given que el sistema mostró la transcripción con baja confianza
    When el usuario responde "sí" o confirma el texto
    Then el sistema procede con la interpretación estándar del texto confirmado

  Scenario: El usuario corrige la transcripción
    Given que el sistema mostró la transcripción incorrecta
    When el usuario responde con el texto correcto (ej: "no, fue taxi, no taxy")
    Then el sistema usa el texto corregido para la interpretación
    And continúa el flujo estándar con el texto del usuario

  Scenario: Transcripción completamente ininteligible (vacía o sin palabras reconocibles)
    Given que el sistema no puede extraer ningún texto comprensible del audio
    When detecta este caso
    Then notifica al usuario: "No pude entender el audio. Por favor, envía el gasto como texto."
    And no inicia ningún flujo de interpretación

  Scenario: El usuario cancela desde la pantalla de confirmación de transcripción
    Given que el sistema mostró la transcripción con baja confianza
    When el usuario responde "cancelar"
    Then el sistema descarta el flujo
    And queda listo para recibir un nuevo mensaje


**Definición de Done**

- El umbral de confianza para activar este flujo está configurado y documentado.
- La transcripción con baja confianza nunca pasa automáticamente al flujo de interpretación; siempre pasa por el paso de confirmación.
- Los textos completamente ininteligibles no generan intentos de interpretación.
- El usuario siempre tiene la opción de cancelar desde esta pantalla.

**Story Points: 3**

> Es una rama del flujo de voz (E1-US-16). La lógica es relativamente simple: mostrar la transcripción, esperar confirmación, bifurcar. La complejidad está en el umbral de confianza y en la experiencia de usuario al presentar una transcripción parcialmente incorrecta de forma que no genere frustración.

**Dependencias**

- E1-US-16: la transcripción debe estar disponible junto con el score de confianza del servicio STT.