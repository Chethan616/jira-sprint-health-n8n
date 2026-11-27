#!/usr/bin/env bash
# Rebuilds and (re)starts the isolated test environment:
#   mock Jira :5698, SMTP sink :2525/:2526, n8n :5699 with N8N_USER_FOLDER=.n8n-test
# Credentials here are FAKE and only valid against the local mocks.
set -e
cd "$(dirname "$0")/.."
stop_port() {
  if command -v powershell >/dev/null 2>&1; then   # Windows (Git Bash)
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $1 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" || true
  elif command -v lsof >/dev/null 2>&1; then        # macOS / Linux
    lsof -ti tcp:"$1" -sTCP:LISTEN | xargs -r kill 2>/dev/null || true
  fi
}
for p in 5699 5698 2525 2526; do stop_port $p; done
mkdir -p .n8n-test/import
node scripts/build-workflows.js --test
cat > .n8n-test/import/credentials.json <<'JSON'
[
  {"id":"credJiraCloud001","name":"Jira Cloud (sprint monitor)","type":"jiraSoftwareCloudApi","data":{"email":"mock@test.local","apiToken":"mock-token","domain":"http://localhost:5698"}},
  {"id":"credSmtpDigest01","name":"SMTP (sprint digest)","type":"smtp","data":{"user":"digest@test.local","password":"mock","host":"localhost","port":2525,"secure":false,"disableStartTls":true}},
  {"id":"credHookToken001","name":"Sprint digest webhook token","type":"httpHeaderAuth","data":{"name":"X-Digest-Token","value":"test-token-123"}}
]
JSON
# Always the project-local folder, never ~/.n8n (cygpath only exists on Windows Git Bash)
export N8N_USER_FOLDER="$(cygpath -w "$PWD/.n8n-test" 2>/dev/null || echo "$PWD/.n8n-test")" N8N_DIAGNOSTICS_ENABLED=false
case "$N8N_USER_FOLDER" in *.n8n-test) ;; *) echo "refusing: N8N_USER_FOLDER not isolated ($N8N_USER_FOLDER)"; exit 1;; esac
n8n import:credentials --input=.n8n-test/import/credentials.json 2>&1 | tail -1
for f in jira-get error-handler jira-sprint-health-monitor test-helpers test-shipped-config; do n8n import:workflow --input=.n8n-test/import/$f.json 2>&1 | tail -1; done
for id in jsHealthJiraGet1 jsHealthErrors01 jsHealthMonitor1 jsHealthTestHlp1 jsHealthTestCfg1; do n8n publish:workflow --id=$id 2>&1 | grep -iv "note\|restart\|ignoring" | tail -1; done
n8n unpublish:workflow --id=smoke0000000001 >/dev/null 2>&1 || true
(node tests/mock-jira.js > .n8n-test/mock-jira.log 2>&1 &)
(node tests/smtp-sink.js > .n8n-test/smtp-sink.log 2>&1 &)
bash tests/start-test-n8n.sh
