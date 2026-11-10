#!/usr/bin/env bash
# One-time: read the App Insights connection string from the Dev Container App's env into .env.local using the Azure CLI.
# The founder never runs this. It exists for the engineer they hire.
# Local development always uses the Postgres, Keycloak, and Azurite containers from docker compose.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP="${1:-}"; RG="${2:-}"
if { [ -z "$APP" ] || [ -z "$RG" ]; } && command -v gh >/dev/null; then
  APP="${APP:-$(gh variable get DEV_APP_NAME 2>/dev/null || true)}"
  RG="${RG:-$(gh variable get DEV_RESOURCE_GROUP 2>/dev/null || true)}"
fi
[ -n "$APP" ] && [ -n "$RG" ] || { echo "Usage: npm run setup -- <dev-app-name> <dev-resource-group>   (or set the DEV_APP_NAME and DEV_RESOURCE_GROUP repo variables and install gh)" >&2; exit 1; }

command -v az >/dev/null || { echo "Azure CLI (az) is required. https://learn.microsoft.com/cli/azure/install-azure-cli" >&2; exit 1; }
az account show >/dev/null 2>&1 || az login >/dev/null

# Fetch first, so a failure stops the script before .env.local is touched.
INSIGHTS="$(az containerapp show -n "$APP" -g "$RG" --query "properties.template.containers[0].env[?name=='APPLICATIONINSIGHTS_CONNECTION_STRING'].value | [0]" -o tsv)"
if [ -z "$INSIGHTS" ]; then
  echo "APPLICATIONINSIGHTS_CONNECTION_STRING is empty or missing on $APP in $RG." >&2
  exit 1
fi

NOW="$(date '+%m-%d-%Y %I:%M %p' | tr 'AMP' 'amp')"

umask 077
{
  echo "# Written by npm run setup on $NOW from Container App $APP in $RG"
  echo "# The database, sign-in, and file storage run locally in Docker. npm run dev starts them."
  printf 'APPLICATIONINSIGHTS_CONNECTION_STRING=%q\n' "$INSIGHTS"
} > .env.local
chmod 600 .env.local

echo ".env.local written. Run npm run dev."
