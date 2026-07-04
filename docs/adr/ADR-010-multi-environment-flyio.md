# ADR-010 · Infraestructura: Despliegue Multi-Ambiente en Fly.io

**Status:** Accepted

### Contexto

A medida que el equipo crece y las funcionalidades se estabilizan, se hace necesario contar con un entorno de staging aislado donde probar cambios antes de promoverlos a producción. El despliegue único sobre `main` obliga a validar todas las modificaciones directamente en el entorno productivo, incrementando el riesgo de regresiones visibles por los usuarios finales.

Además, el proyecto maneja secretos sensibles (tokens de bots, claves de API, credenciales de base de datos) que deben rotarse y gestionarse de forma independiente por ambiente. Compartir un único conjunto de secretos entre producción y desarrollo viola el principio de mínimo privilegio y dificulta la rotación segura.

La infraestructura actual consiste en un único `Dockerfile` de una etapa, un `fly.toml` que expone el puerto `8080` y un workflow de GitHub Actions que solo escucha `main`. Estos artefactos deben evolucionar para soportar dos ambientes operativos con costo y complejidad controlados.

### Decisión

Se adopta un modelo de **despliegue multi-ambiente sobre Fly.io** con las siguientes decisiones operativas:

**Dos aplicaciones Fly.io independientes**

- `gastto` → ambiente de producción, desplegada desde la rama `main`.
- `gastto-develop` → ambiente de desarrollo (staging), desplegada desde la rama `develop`.

Cada app tiene su propio conjunto de secretos en Fly.io, su propio bot de Telegram y su propia base de datos (o esquema), garantizando aislamiento total.

**Despliegue automático vía GitHub Actions**

El workflow `.github/workflows/fly-deploy.yml` se actualiza para escuchar pushes en `main` y `develop`. Cada rama dispara el despliegue correspondiente mediante pasos condicionales (`if: github.ref == 'refs/heads/...'`), utilizando tokens de API de Fly.io distintos (`FLY_API_TOKEN` y `FLY_API_TOKEN_DEVELOP`). Se mantiene `concurrency: deploy-group` para evitar deploys concurrentes.

**Configuración y secretos en Fly.io, no en GitHub**

Toda la configuración específica de ambiente (incluyendo variables sensibles) se almacena como secretos de Fly.io por app. GitHub Actions solo almacena los tokens de Fly.io necesarios para autenticar el despliegue. Esto simplifica la rotación de credenciales: un único `flyctl secrets set` por app, sin modificar el repositorio.

**Un bot de Telegram por ambiente**

Para evitar colisiones de webhooks y aislar el tráfico de prueba, cada ambiente utiliza su propio bot de Telegram. El bot de desarrollo se registra con el webhook apuntando a `gastto-develop.fly.dev`.

**Dockerfile multi-etapa con pnpm**

El `Dockerfile` se reescribe como construcción multi-etapa:

- Etapa `builder`: instala todas las dependencias (incluyendo dev), compila con `pnpm build` y genera `dist/main.js`.
- Etapa `runner`: copia únicamente `dist/` e instala solo dependencias de producción con `pnpm install --prod --frozen-lockfile`.

Esto reduce drásticamente el tamaño de la imagen final al excluir devDependencies y herramientas de compilación.

**Puerto unificado: 3000**

Se alinea el puerto expuesto en el `Dockerfile`, `fly.toml`, `fly.develop.toml` y el default de `env.schema.ts` a `3000`. Antes, el `Dockerfile` exponía `8080` mientras la aplicación arrancaba en `3000` por defecto, lo que provocaba fallos de ruteo si Fly.io no inyectaba explícitamente `PORT=8080`.

**Recursos ajustados al free tier**

Cada VM se configura con:

- `memory = '256mb'`
- `cpu_kind = 'shared'`
- `cpus = 1`

Esto mantiene el consumo dentro de los límites del tier gratuito de Fly.io (3 VMs compartidas, 256 MB cada una).

**`auto_stop_machines = true` (configuración temporal)**

Ambos archivos `fly.toml` y `fly.develop.toml` configuran `auto_stop_machines = true` y `min_machines_running = 0`. Esta configuración es segura mientras no haya workers de BullMQ ejecutándose en segundo plano. Cuando se introduzcan workers (per ADR-009), `auto_stop_machines` **debe cambiarse a `false`** para evitar que Fly.io detenga la VM mientras hay jobs pendientes en la cola.

### Alternativas descartadas

| Alternativa                                                   | Motivo de descarte                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Una sola app con preview deployments (similares a Vercel)     | Fly.io no ofrece preview deployments nativos por rama. Emularlos con máquinas efímeras añade complejidad operativa comparable a tener dos apps permanentes, pero sin el beneficio del aislamiento completo de secretos y base de datos.        |
| Almacenar variables de entorno en GitHub repository variables | GitHub variables no están encriptadas con el mismo nivel que Fly.io secrets. Además, obligarían a re-desplegar solo para rotar una clave de API. Fly.io secrets permiten rotación inmediata sin tocar el repo.                                 |
| Compartir un único bot de Telegram entre ambiente             | Los webhooks de Telegram solo permiten una URL por bot. Compartirlo obligaría a re-registrar el webhook en cada deploy, con riesgo de que mensajes de producción lleguen al ambiente de desarrollo y viceversa.                                |
| Mantener el puerto 8080                                       | Mantener `8080` en Fly.io mientras la aplicación escucha en `3000` por defecto requiere que Fly.io inyecte siempre `PORT=8080`. Si esa variable falta, el deploy falla silenciosamente. Unificar a `3000` elimina esta dependencia implícita.  |
| Conservar el Dockerfile de una sola etapa                     | La imagen resultante incluye todas las devDependencies (TypeScript, ESLint, Vitest, etc.), aumentando el tamaño final y la superficie de ataque. La construcción multi-etapa es estándar en la industria y no añade complejidad significativa. |

### Consecuencias

**Positivas**

- Aislamiento completo entre producción y staging: un error en `develop` no afecta a los usuarios de producción.
- Despliegue automático y branch-based: mergear a `main` o `develop` despliega automáticamente sin intervención manual.
- Imagen Docker significativamente más pequeña gracias a la construcción multi-etapa, reduciendo tiempos de despliegue y uso de disco en Fly.io.
- Rotación de secretos simplificada: cambios de credenciales se hacen directamente en Fly.io sin commits al repositorio.
- Costo controlado: ambas apps corren dentro del free tier de Fly.io (3 VMs compartidas, 256 MB cada una).

**Negativas**

- Sobrecarga operativa de gestionar dos conjuntos de secretos independientes.
- Necesidad de crear y mantener un segundo bot de Telegram para el ambiente de desarrollo.
- Consumo duplicado de recursos del free tier (dos apps en lugar de una), lo que reduce la capacidad disponible para futuras VMs o workers.
- El cambio de `auto_stop_machines` a `false` cuando lleguen los workers de BullMQ es un paso manual que debe recordarse; se documenta con comentarios en ambos `fly.toml`.
