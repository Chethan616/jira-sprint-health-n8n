# Plan and status: Jira Sprint Health Monitor & Daily Digest

Team: **Sanjna J** and **Manikonda Chethan Krishna**. Assigned 11 Nov 2026 (use case 2).

> The owner column below is a **placeholder**. Agree the split between you before sharing this.

## Requirements → implementation

| # | Requirement (from the assignment) | Where | Status |
|---|---|---|---|
| 1 | Retrieve active sprints via Jira REST | Get Scrum Boards → Get Active Sprints (Agile API, paginated) | Done, tested on mock |
| 2 | Fetch all issues in the active sprint | Get Sprint Issues (`/search/jql`, `nextPageToken`) | Done, tested on mock |
| 3 | Categorise: To Do / In Progress / Done / Blocked | Analyze Sprints (`src/analyze.js`) | Done |
| 4 | Flag In Progress > 3 days, overdue, unassigned, Blocked | Analyze Sprints | Done |
| 5 | Sprint completion % | Analyze Sprints (+ elapsed %, trend) | Done |
| 6 | Team members with many unresolved issues | Analyze Sprints, workload table | Done |
| 7 | Daily sprint health summary | HTML + text digest, health rating | Done |
| 8 | Send summary by email | Loop Over Items → Send Digest Email (SMTP) | Done, tested on SMTP sink |
| | Common: credentials not in workflow, sample data, docs, tests, exports, demo | README, docs/, tests/, workflows/ | Done except demo video |

## Review follow-ups

| Review point | Where | Status |
|---|---|---|
| Group assignees by Jira account id | `src/analyze.js` (workload, labels) | Done, unit-tested |
| Sprint shown on several boards: recipient routing | Collect Sprints + `src/analyze.js`, `sprintBoardRouting` | Done, unit + e2e T22 |
| Validate mandatory parameters, thresholds, timezone, API settings | `src/validate.js` in the Config node and the build | Done, unit + e2e T26, T27 |
| Story-point progress alongside issue count | `src/analyze.js` (`progressBasis`, coverage guard, trend) | Done, unit-tested |
| Retry-After and exponential backoff | Jira GET sub-workflow, `src/jira-paging.js` | Done, unit + e2e T23–T25 |
| Scheduling timezone consistency | Config node: workflow timezone vs `Config.timezone` | Done, unit + e2e T26 |
| End-to-end test on a live Jira site and a real mailbox | Our Jira Cloud site + Gmail; `scripts/live-check.js`, [INSTRUCTIONS.md checklist](INSTRUCTIONS.md#live-test-checklist) | Done (27 Nov 2026) |

## Task split

| Task | Owner | Status |
|---|---|---|
| Workflow design, Code-node logic, claim protocol | TBD | Done |
| Mock Jira + SMTP sink, 27 e2e + 28 unit tests | TBD | Done (27/27, 28/28) |
| Docs (README, architecture, test results) and deck | TBD | Done |
| Create Jira Cloud site + Scrum project, run `scripts/seed-jira.js` | TBD | To do |
| SMTP credential (Gmail app password, as in the ServiceNow project) | TBD | To do |
| Live run: dry run → real digest → same-day dedupe → error alert | Shared | To do |
| Record the short demo video | Shared | To do |

## Known limits

- Jira can't backdate status changes, so on a freshly seeded site "In Progress > 3 days" only shows after 3 days. For a same-day demo, set `staleInProgressDays` to 0.
- Default Jira workflows have no "Blocked" status. The rules also accept the Flagged field and "is blocked by" links, and the seeder flags the issue instead.
- The schedule is Mon–Fri 09:00; the brief says "daily". Change the cron to `0 9 * * *` for every day.
- The brief text after step 8 wasn't in the screenshots; check the email for any extra "n8n concepts" or deliverable lines.
- Delivery is at-least-once (see docs/architecture.md §5).
