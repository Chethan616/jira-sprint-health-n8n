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
> (\`tests/smtp-sink.js\`), driving a real n8n 2.45.7 server through its webhook trigger. They have **not** yet been
> run against a live Jira Cloud site or a real mailbox; see "Live run checklist" below.

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

## Unit tests (\`tests/unit.test.js\`)

| Test | Result |
|---|---|
${unit.map((u) => `| ${cell(u.name)} | ${u.pass ? 'PASS' : '**FAIL**'} |`).join('\n')}

## Live run checklist (still to do on a real Jira site)

- [ ] Jira Cloud site + Scrum project created, \`scripts/seed-jira.js\` run successfully
- [ ] n8n credentials created: Jira Software Cloud API, SMTP, Header Auth (webhook token)
- [ ] Recipients added to the \`sprint_digest_recipients\` Data Table
- [ ] Dry run (\`{"dryRun": true}\`) preview matches the seeded sprint
- [ ] Real digest received in the mailbox; same-day re-run skipped
- [ ] Error workflow alert received after pointing Config.jiraBaseUrl at a wrong host
- [ ] "In Progress > 3 days" verified after 3 real days (Jira can't backdate status changes), or with Config.staleInProgressDays = 0
`;
fs.writeFileSync(path.join(ROOT, 'docs', 'test-results.md'), md);
console.log('wrote docs/test-results.md');
