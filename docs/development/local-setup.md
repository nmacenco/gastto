---
title: 'Local Development Setup'
last_updated: '2026-11-08'
source_of_truth: ['.env.example', 'compose.local.yml', 'Dockerfile.dev', 'src/config/env.schema.ts', 'src/bootstrap/registerWorkers.ts']
tags: ['development', 'local', 'setup', 'docker']
---

# Local Development Setup

Docker Compose runs Gastto, PostgreSQL, Redis, a one-shot Drizzle migration, and an ngrok HTTPS tunnel. Source edits restart the app without rebuilding. You need Docker with Compose; Node.js 24 and pnpm 10.34.9 run inside the development image. A hosted PostgreSQL project is not required.

## 1. Prepare private configuration

Copy the template and edit only the ignored `.env` file:

```bash
cp .env.example .env
```

Fill these values before starting:

| Variable | What to provide |
| --- | --- |
| `GASTTO_LOCAL_DB_PASSWORD` | A unique URL-safe password using letters, digits, `_`, or `-`. Compose uses it only for the local database. |
| `TELEGRAM_BOT_TOKEN` | A bot created for this local stack through BotFather. Never reuse a deployed bot: registering a local webhook replaces its current webhook. |
| `TELEGRAM_WEBHOOK_SECRET` | Generate with `openssl rand -hex 32`. |
| `NGROK_AUTHTOKEN` | Your ngrok account authtoken. |
| `WEBHOOK_BASE_URL` | `https://<your-assigned-development-domain>` with no path or trailing slash. Find the assigned domain in your ngrok account. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Web application OAuth client described below. |
| `GOOGLE_REDIRECT_URI` | One exact callback URI described below. |
| `ENCRYPTION_KEY` | Generate with `openssl rand -hex 32`; keep it for as long as the local database contains OAuth tokens. |
| One LLM provider key | For example `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `NVIDIA_API_KEY`, or `GROQ_API_KEY`. |

Keep `COMPOSE_PROFILES=tunnel` for the default stack and `ACCESS_APPROVAL_ENABLED=false` for ordinary onboarding. Compose overrides `DATABASE_URL` with `postgres:5432` and `REDIS_URL` with `redis:6379` inside the app; the migration service uses the same local PostgreSQL credentials. Values in `.env` for host-side database or broker tools do not control these containers. Never run host-side `pnpm db:migrate` against a shared or deployed database.

## 2. Configure Google Drive and Sheets authorization

This OAuth client lets a Telegram user authorize access to their Drive and Sheets during onboarding. It is not a separate website login.

1. Create or select a Google Cloud project, then enable the **Google Drive API** and **Google Sheets API** in **APIs & Services > Library**. See [Google's API setup guide](https://developers.google.com/workspace/guides/enable-apis).
2. Configure the OAuth consent screen in **Google Auth platform**: set the app name, support/contact details and audience. For an External app in Testing, add the Google account that will complete onboarding as a test user. See [Google's consent guide](https://developers.google.com/workspace/guides/configure-oauth-consent).
3. Add the scopes actually requested by Gastto: `https://www.googleapis.com/auth/drive.readonly` and `https://www.googleapis.com/auth/spreadsheets`. `drive.file` is not the requested scope.
4. Under **Google Auth platform > Clients**, create a **Web application** OAuth client. Add your chosen URI below to its **Authorized redirect URIs**, then copy its client ID and secret to `.env`. See [Google's client setup guide](https://developers.google.com/workspace/guides/create-credentials).

| Where you complete consent | Set `GOOGLE_REDIRECT_URI` and register this exact URI |
| --- | --- |
| Browser on the computer running Docker | `http://localhost:3000/auth/google/callback` |
| Browser opened from Telegram on a phone or another device | `https://<your-assigned-development-domain>/auth/google/callback` |

Google requires an exact redirect URI match. `localhost` on a phone points to the phone, so use the HTTPS option for mobile onboarding. `app:3000` is a Docker-only address and must never be registered as a browser callback. After changing the URI in `.env`, recreate the app container. The Google account used for consent must be an allowed test user if the External app remains in Testing. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

## 3. Start and check the stack

```bash
docker compose -f compose.local.yml up --build
```

The app listens at `http://localhost:3000`; the public webhook endpoint is `WEBHOOK_BASE_URL/webhook/telegram`. Compose waits for PostgreSQL health, successful migrations, Redis health, and the configured ngrok endpoint before starting the app. An endpoint being announced does not prove that the app can serve requests through it, because webhook registration occurs before the HTTP listener opens. Check after startup:

```bash
docker compose -f compose.local.yml ps -a
docker compose -f compose.local.yml logs migrate ngrok ngrok-ready app
curl -fsS http://localhost:3000/health
```

The migration service should show `Exited (0)`, the app logs should show workers starting, and local `/health` should return `status: ok`. `/health` alone does not prove that workers initialized. Use these commands to check public reachability and the local bot's webhook without printing the token:

```bash
docker compose -f compose.local.yml exec app node -e 'fetch(process.env.WEBHOOK_BASE_URL + "/health", {headers: {"ngrok-skip-browser-warning": "true"}}).then(async r => { if (!r.ok) throw Error("public health: " + r.status); console.log(await r.text()) }).catch(e => { console.error(e.message); process.exitCode = 1 })'
docker compose -f compose.local.yml exec app node -e 'fetch("https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/getWebhookInfo").then(r => r.json()).then(d => { console.log({url: d.result?.url, pending: d.result?.pending_update_count, lastError: d.result?.last_error_message}); if (!d.ok || d.result?.url !== process.env.WEBHOOK_BASE_URL + "/webhook/telegram") process.exitCode = 1 }).catch(e => { console.error(e.message); process.exitCode = 1 })'
```

Send a message to the local bot. Confirm the app logs show webhook receipt and the worker's response, then complete Google consent using the selected callback URI. Browser-based consent and a real Telegram reply need your accounts; a clean Compose startup cannot verify either.

Swagger UI is at `http://localhost:3000/documentation`.

## 4. Edit, stop, and reset

Editing `src/` triggers `tsx watch` inside the app container. Changing `.env` requires container recreation; changing dependencies or the lockfile requires rebuilding the development image. New migrations must run before the app restarts:

```bash
# Stop while retaining local PostgreSQL data.
docker compose -f compose.local.yml down
# Start again with the retained database.
docker compose -f compose.local.yml up --build
# Apply changed environment or dependencies.
docker compose -f compose.local.yml up --build --force-recreate
# Rerun changed migrations before starting the app.
docker compose -f compose.local.yml up --build --force-recreate migrate
docker compose -f compose.local.yml up --build --force-recreate app
```

The next command **deletes the local PostgreSQL volume**. Confirm the project name is `gastto-local` before running it:

```bash
docker compose -f compose.local.yml down -v
```

To run only PostgreSQL, Redis, migrations, and the app, set `COMPOSE_PROFILES=` and `WEBHOOK_BASE_URL=http://localhost:3000` in `.env`, then use the core override:

```bash
docker compose -f compose.local.yml -f compose.local.core.yml up --build
# Stop that same core-only stack:
docker compose -f compose.local.yml -f compose.local.core.yml down
```

The override removes the app's tunnel dependency. The default command requires a successfully connected ngrok endpoint and does not start the app when the tunnel fails. Telegram auto-registration is skipped in core-only mode. Restore the HTTPS URL and `COMPOSE_PROFILES=tunnel` before testing Telegram delivery. PostgreSQL and Redis have no host ports; if a host tool needs PostgreSQL, use a personal loopback-only Compose override such as `127.0.0.1:5433:5432` with a free port.

## 5. Optional operator approval

The default local flow does not need operator Gmail credentials. `ACCESS_APPROVAL_ENABLED=true` adds a separate Telegram access gate and requires `ADMIN_NOTIFICATION_EMAIL`, `ADMIN_GMAIL_ADDRESS`, `ADMIN_GMAIL_CLIENT_ID`, `ADMIN_GMAIL_CLIENT_SECRET`, and `ADMIN_GMAIL_REFRESH_TOKEN`. Its Gmail sender uses a separate operator OAuth client with `gmail.send`; it does not replace the product user's Drive/Sheets OAuth client. See [Telegram access approval](../features/telegram-access-approval.md).

## 6. Troubleshooting and tests

- If the app does not start, inspect `migrate`, `ngrok-config`, `ngrok`, and `ngrok-ready` logs. Invalid ngrok tokens or domains prevent the configured endpoint from becoming ready. `ngrok-ready` waits 30 seconds and then exits with a diagnostic.
- If PostgreSQL rejects `gastto` with `password authentication failed`, the named volume may have been initialized with an earlier `GASTTO_LOCAL_DB_PASSWORD`. Changing `.env` does not change the password stored in an existing database. To keep the data, run `docker exec -it gastto-local-postgres-1 psql -U gastto -d gastto`, enter `\password gastto`, type the current `.env` password at the hidden prompts, then enter `\q` and run `docker compose -f compose.local.yml up --build --force-recreate`. Do not place the password in a shell command or chat. If the local database is disposable, the documented `down -v` reset creates a fresh database with the current password, but it deletes all local PostgreSQL data.
- If Telegram reports `404 Not Found` and the response has `ngrok-error-code: ERR_NGROK_3200`, the public endpoint is offline. Check that the `ngrok` container is running. `ERR_NGROK_105` in its logs means `NGROK_AUTHTOKEN` is not a valid ngrok agent authtoken; copy the authtoken from your ngrok dashboard into the ignored `.env` and recreate the stack. Do not paste the token into logs or chat.
- If local `/health` works but messages do not arrive, check public `/health`, `getWebhookInfo`, the bot token, and app worker logs in that order. The app can serve `/health` even after some infrastructure or webhook registration errors.
- If Google reports `redirect_uri_mismatch`, compare `GOOGLE_REDIRECT_URI` with the Web application's registered URI character for character. Complete localhost consent on the Docker host; use HTTPS for a phone.
- If a dependency change is not visible, use `up --build --force-recreate`. If only a source edit is not visible, check the app log for a `tsx` restart.
- Run `pnpm test`, `pnpm lint`, and `pnpm typecheck` on a host with Node.js 24 and pnpm 10.34.9. Tests use Testcontainers and require Docker access.

The existing `docker-compose.yml` and `pnpm redis:*` scripts remain a separate Redis-only workflow. Production uses the existing `Dockerfile` and Fly.io configuration.
