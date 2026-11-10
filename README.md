# Starter

A starting point. Built by Fondo and running on Azure.

## Run it on your machine

You need Docker and Node.js 22 or later.

    npm install
    npm run dev

Open http://localhost:5173. Sign up or sign in on the login page. Postgres, Keycloak, and Azurite run in Docker. The API runs on port 3000 and the web app on 5173.

## What is inside

- `src/web` is the web app (React). One list and one detail page per thing the app keeps track of.
- `src/server` is the API (Fastify). Sign in is checked on every request. Permissions follow `plan.json`.
- `src/server/db/schema.ts` is the database layout. Migrations live in `drizzle/`.
- `keycloak/` is the sign in service, with your product name and color on the login page.
- `plan.json` is the plan Fondo built this app from.

## Deploy

Every push to `main` builds the app and deploys it to Dev through GitHub Actions. Going live is approved in the Fondo web app, which runs the `promote-live` workflow with the exact image tag from Dev.

## Settings for Dev

    npm run setup

Signs in with the Azure CLI, pulls Dev settings from Key Vault into `.env.local`, and never commits them. Only needed if you want local code to talk to Dev services.

## Ask Fondo

Open this folder in VS Code with GitHub Copilot. The Fondo tools are already connected through `.vscode/mcp.json`. Describe a change in plain words.
