#!/usr/bin/env bash
# Starts Postgres, Keycloak, and Azurite in Docker, runs migrations, then the API (3000) and the web app (5173).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

command -v docker >/dev/null || { echo "Docker is required but was not found." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start Docker and try again." >&2; exit 1; }

echo "Starting Postgres, Keycloak, and Azurite..."
docker compose up -d --build --wait

# .env.local comes from npm run setup. Anything it does not set falls back to the compose defaults.
set -a
[ -f .env.local ] && . ./.env.local
set +a
export DATABASE_URL="${DATABASE_URL:-postgres://app:app@localhost:5432/app}"
export KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
export STORAGE_ACCOUNT_NAME="${STORAGE_ACCOUNT_NAME:-devstoreaccount1}"
export AZURE_STORAGE_CONNECTION_STRING="${AZURE_STORAGE_CONNECTION_STRING:-UseDevelopmentStorage=true}"
export STORAGE_CONTAINER="${STORAGE_CONTAINER:-uploads}"
export PORT="${PORT:-3000}"
export RUN_MIGRATIONS_ON_START=true

cat <<SUMMARY

  App             http://localhost:5173
  API             http://localhost:${PORT}/healthz
  Keycloak admin  http://localhost:8080/admin   (admin / admin, local only)

  Sign up from the app's login page. Stop with Ctrl+C. Containers keep running: docker compose down

SUMMARY

trap 'kill 0' EXIT
npx tsx watch src/server/main.ts &
npx vite &
wait
