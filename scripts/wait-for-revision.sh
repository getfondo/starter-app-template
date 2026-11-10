#!/usr/bin/env bash
# Waits until a Container App's newest revision is the one serving (latest == latest ready).
# A /healthz check alone can pass while the old revision still answers and the new one has failed.
# Usage: wait-for-revision.sh <app-name> <resource-group> [timeout-seconds]
set -euo pipefail
app="$1"
rg="$2"
timeout="${3:-600}"
deadline=$(( $(date +%s) + timeout ))

while :; do
  read -r latest ready < <(az containerapp show -n "$app" -g "$rg" \
    --query "[properties.latestRevisionName, properties.latestReadyRevisionName]" -o tsv | tr '\n' ' '; echo)
  if [ -n "${latest:-}" ] && [ "$latest" = "${ready:-}" ]; then
    echo "$app: revision $latest is ready"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "$app: revision ${latest:-unknown} did not become ready in ${timeout}s (ready: ${ready:-none})" >&2
    exit 1
  fi
  echo "$app: waiting for ${latest:-unknown} (ready: ${ready:-none})"
  sleep "${WAIT_INTERVAL:-10}"
done
