// Turns docs/test-results.e2e.json (+ a fresh unit-test run) into docs/test-results.md
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const e2e = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'test-results.e2e.json'), 'utf8'));
let unitOut = '';
try { unitOut = execSync('node --test tests/unit.test.js', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { unitOut = e.stdout || ''; }
const unit = [...unitOut.matchAll(/^(✔|✖) (.+?) \(/gm)].map((m) => ({ pass: m[1] === '✔', name: m[2] }));
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const md = `# Test results

**Environment:** ${e2e.environment}
**Run at:** ${e2e.ranAt}
**End-to-end:** ${e2e.passed}/${e2e.total} passed · **Unit:** ${unit.filter((u) => u.pass).length}/${unit.length} passed

> All end-to-end tests ran against a **local mock Jira Cloud API** (\`tests/mock-jira.js\`) and an **SMTP sink**
> (\`tests/smtp-sink.js\`), driving a real n8n server (${e2e.environment.split(' (')[0]}) through its webhook trigger.
> Live-site results go in the checklist at the end (steps in [INSTRUCTIONS.md](../INSTRUCTIONS.md#live-test-checklist)).
> \`scripts/live-check.js\` runs the same paging/retry and Config-validation code read-only against a live Jira site.

## How to reproduce

\`\`\`bash
node --test tests/unit.test.js     # ${unit.length} unit tests, no n8n needed
./tests/setup-test-env.sh          # isolated n8n (.n8n-test) + mock Jira :5698 + SMTP sink :2525
node tests/run-e2e.js              # ${e2e.total} end-to-end scenarios
node scripts/write-test-report.js  # regenerates this file
\`\`\`

The mock Jira caps agile pages at 1 item and search pages at 5 issues, so every run exercises pagination
(boards: 3 pages, sprint 11: 4 pages of \`/search/jql\` using \`nextPageToken\`).

## End-to-end scenarios

| ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
${e2e.results.map((r) => `| ${r.id} | ${cell(r.name)} | ${cell(r.expected)} | ${cell(r.actual)} | ${r.pass ? 'PASS' : '**FAIL**'} |`).join('\n')}

## Bug found by testing (and fixed)

The first version sent all digests through one Email node with *Retry On Fail*. When the SMTP server rejected
one email, n8n retried the **whole node**, so the digest that had already been delivered was sent again
(observed: Mobile digest delivered twice after a single rejection of the Payments digest).
Fix: a *Loop Over Items* node (batch size 1) in front of the Email node, so a retry only re-sends the one
email that failed. Regression test: **T18**.

## Review follow-ups and the tests that cover them

| Review point | Change | Tests |
|---|---|---|
| Group assignees by Jira account id | Workload keyed by \`accountId\`; same display name shown as \`Name (…1a2b)\` | unit: *workload groups by accountId* |
| Sprint shown on several boards | Collect Sprints keeps every board that lists the sprint; recipients of each board get it once (\`sprintBoardRouting\`) | unit: *sprint on several boards*; e2e **T22** |
| Validate configuration | \`src/validate.js\` runs in the Config node and at build time: required values, ranges, URL, IANA timezone, API limits | unit: *validateConfig* ×3; e2e **T26**, **T27** |
| Story-point progress | \`progressBasis\` (issues / points / both = lower), coverage threshold, points in email and trend | unit: *progress basis*, *story points ignored…*, *delta includes story points* |
| Retry-After and exponential backoff | "Jira GET" sub-workflow (\`src/jira-paging.js\`): waits Retry-After / X-RateLimit-Reset, backoff with jitter on 5xx/network, no retry on other 4xx | unit: *retryAfterMs*, *backoffMs*, *paging*, *rate limits*; e2e **T06**, **T07**, **T23**, **T24**, **T25** |
| Scheduling timezone consistency | Config node compares the workflow timezone (\`$now.zoneName\`, used by the Schedule trigger) with \`Config.timezone\` and stops on a mismatch | unit: *workflow timezone must match*; e2e **T26** |
| Live Jira + real mailbox | \`scripts/live-check.js\` pre-flight + checklist below | manual |

## Unit tests (\`tests/unit.test.js\`)

| Test | Result |
|---|---|
${unit.map((u) => `| ${cell(u.name)} | ${u.pass ? 'PASS' : '**FAIL**'} |`).join('\n')}

## Live run checklist (real Jira site and mailbox)

Steps: [INSTRUCTIONS.md](../INSTRUCTIONS.md#live-test-checklist).

Live run on 27 Nov 2026: the sample sprint was seeded on our Jira Cloud site and the digest arrived in a real Gmail inbox.

- [x] \`scripts/seed-jira.js\` created the sample sprint on our Jira Cloud site (27 Nov 2026)
- [ ] \`scripts/live-check.js\` → "All checks passed"
- [ ] A deliberately wrong Config value and a workflow/Config timezone mismatch each stop the run with a clear message
- [ ] Dry run preview matches the seeded sprint (counts, flags, story points)
- [x] Real digest received in our Gmail inbox (27 Nov 2026)
- [ ] Same-day re-run skipped; \`{"force": true}\` re-sends
- [ ] Error workflow alert received after pointing Config.jiraBaseUrl at a wrong host
- [ ] Recipient subscribed to a second board that shows the sprint receives it once
- [ ] "In Progress > 3 days" verified after 3 real days (Jira can't backdate status changes), or with Config.staleInProgressDays = 0
- [ ] Scheduled 09:00 run fired at 09:00 in the team's timezone
`;
fs.writeFileSync(path.join(ROOT, 'docs', 'test-results.md'), md);
console.log('wrote docs/test-results.md');
