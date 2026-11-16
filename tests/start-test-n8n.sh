#!/usr/bin/env bash
# Starts the isolated n8n test instance (never touches ~/.n8n) and waits until it's ready.
cd "$(dirname "$0")/.."
export N8N_USER_FOLDER="$(cygpath -w "$PWD/.n8n-test" 2>/dev/null || echo "$PWD/.n8n-test")" \
  N8N_DIAGNOSTICS_ENABLED=false N8N_PORT=5699 N8N_PERSONALIZATION_ENABLED=false N8N_SECURE_COOKIE=false \
  GENERIC_TIMEZONE=Asia/Kolkata
mkdir -p .n8n-test
: > .n8n-test/server.log
(n8n start >> .n8n-test/server.log 2>&1 &)
for i in $(seq 1 90); do grep -q "Editor is now accessible" .n8n-test/server.log && { echo READY; exit 0; }; sleep 2; done
echo "TIMEOUT"; tail -20 .n8n-test/server.log; exit 1
