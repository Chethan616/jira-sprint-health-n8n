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

## Task split

| Task | Owner | Status |
|---|---|---|
| Workflow design, Code-node logic, claim protocol | TBD | Done |
| Mock Jira + SMTP sink, 21 e2e + 16 unit tests | TBD | Done (21/21, 16/16) |
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
