
Esta épica es un **enabler técnico**: no entrega valor directamente al usuario final, pero sin ella ninguna otra épica puede ejecutarse. Las HUs están escritas desde la perspectiva del equipo/sistema, no del usuario de negocio, y los criterios de aceptación validan comportamiento técnico observable.

| ID      | Título corto                       | Story Points | Dependencias     |
| ------- | ---------------------------------- | ------------ | ---------------- |
| HU-0.01 | Registrar bot y configurar webhook | 2            | —                |
| HU-0.02 | Recibir, parsear y rutear mensajes | 3            | HU-0.01          |
| HU-0.03 | Enviar respuestas al usuario       | 2            | HU-0.01          |
| HU-0.04 | Gestionar estado de conversación   | 5            | HU-0.02, HU-0.03 |
|         | **Total Épica 0**                  | **12 SP**    |                  |

---

**Nota de planificación:** HU-0.01 → HU-0.02 y HU-0.03 en paralelo → HU-0.04. Las cuatro HUs caben cómodamente en un sprint dedicado de infraestructura. El cierre de HU-0.04 es el **gate de entrada para Épica 4**: sin gestión de estado, el onboarding de planilla no puede funcionar.

La Épica 0 también aplaza la deuda de WhatsApp: cuando llegue Release 2, se añadirá una **Épica 0b** que replica HU-0.01 a HU-0.03 para WhatsApp Business API — HU-0.04 (estado de conversación) es agnóstica de plataforma y no necesita duplicarse.