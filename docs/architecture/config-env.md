---
title: "Configuration & Environment"
last_updated: ""
source_of_truth: []
tags: ["architecture", "config", "env"]
---

# Configuration & Environment

This document describes the configuration and environment setup for this project.

## What belongs here

### Environment variables
A table listing all environment variables the project uses, with the following columns:
- **Variable** — the env var name (e.g. `DATABASE_URL`)
- **Scope** — where it's available: `Server`, `Client`, or `Client + Server`
- **Required** — whether the app fails without it
- **Description** — what it does and any relevant format notes

Include a security note if any secrets are exposed client-side and why.

### Environment files
List the `.env*` files in the project:
- Which are committed vs. gitignored
- Which is the template for local setup
- Which holds production credentials

### Framework / build config
Document the main config file (e.g. `next.config.mjs`, `vite.config.ts`):
- Key options enabled and why (output mode, i18n, trailing slash, rewrites, headers, image rules, etc.)

### NPM / package scripts
List the scripts defined in `package.json` with a one-line description of each:
- Dev, build, start, lint, format, test, typecheck, deploy, etc.
