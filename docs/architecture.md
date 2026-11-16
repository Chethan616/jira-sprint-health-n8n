# Architecture: Jira Sprint Health Monitor

## 1. Components

| Component | Role |
|---|---|
| Jira Cloud | Source of boards, sprints and issues (Agile REST 1.0 + Platform REST v3) |
| n8n Community Edition 2.x | Orchestration: Schedule, Webhook, HTTP Request (pagination + retry), Code, Data Table, Loop Over Items, Email (SMTP) |
| n8n Data Tables | Persistent state: recipients, digest claims, daily snapshots |
| SMTP (e.g. Gmail app password / Outlook) | Digest delivery |
| Error workflow | Emails admins when a run fails |

## 2. Workflow (30 nodes)

```
Triggers: Daily 09:00 (Mon-Fri) | Run Now (manual) | Run Now (webhook, header token)
  → Config                         all tunables; runId; dryRun/force flags from webhook body
  → Ensure Runs Table              Data Table create-if-not-exists
  → Ensure Recipients Table        Data Table create-if-not-exists
  → Get Recipients                 active rows
  → Get Recent History             rows created in the last 8 days (claims + snapshots)
  → Get Scrum Boards               GET /rest/agile/1.0/board                   (startAt / isLast)
  → Select Boards                  keep types scrum + simple, filter Config.boardIds; fail loudly if none
  → Get Active Sprints             GET /rest/agile/1.0/board/{id}/sprint?state=active   (per board)
  → Collect Sprints                skip "does not support sprints" 400s, fail on other errors, dedupe
  → Has Active Sprint? ──no──→ No Active Sprint (summary)
  → Get Sprint Issues              GET /rest/api/3/search/jql?jql=sprint={id}   (nextPageToken)
  → Tag Pages With Sprint          pair every page back to its sprint
  → Analyze Sprints                rules, metrics, health, trend, email HTML/text, dedupe decision
      ├→ Should Send? → Build Claim Rows → Claim Digest (insert pending)
      │     → Read Back Claims → Decide Claims → Won Claim?
      │         ├ won  → Prepare Email → Send One At A Time ⟲ [Send Digest Email → Resolve Claims → Record Result]
      │         └ lost → Mark Lost
      └→ Run Summary               final JSON (webhook response); throws if any email failed → Error Workflow
```

In v1 execution order the branch drawn higher on the canvas runs first, so **Run Summary** runs after the send branch has finished and can report its outcomes.

## 3. Jira REST API usage

| Call | Endpoint | Paging | Notes |
|---|---|---|---|
| Boards | `GET /rest/agile/1.0/board?maxResults=100` | `startAt += maxResults` until `isLast` | Keep `scrum` (company-managed) and `simple` (team-managed). A team-managed Kanban board is also `simple`; its sprint call returns 400, which Collect Sprints skips |
| Active sprints | `GET /rest/agile/1.0/board/{boardId}/sprint?state=active` | same | One call per board |
| Sprint issues | `GET /rest/api/3/search/jql?jql=sprint = {id} ORDER BY key&fields=...&maxResults=100` | pass `nextPageToken` until it's absent or `isLast` | The old `/rest/api/3/search` (startAt/total) has been removed from Jira Cloud |

- **Fields** are requested explicitly (`summary,status,assignee,duedate,priority,issuetype,created,updated,statuscategorychangedate,resolutiondate,issuelinks` + Flagged + story points). `/search/jql` returns only ids unless `fields` is given.
- **Safety:** every paginated call has `maxRequests = Config.maxPages` (50) and a 200 ms gap between pages. n8n also stops if the same response comes back 5 times, which covers the repeated-token bug some users report.
- **Auth:** n8n's *Jira Software Cloud API* credential (email + API token → Basic auth). The HTTP Request node is used instead of the built-in Jira node because the Jira node has no sprint/board endpoints and gives no control over paging.
- **Retries:** 3 tries, 3 s apart, on every Jira call (covers 429 and 5xx).

## 4. Data model (n8n Data Tables)

**`sprint_digest_recipients`**

| Column | Type | Meaning |
|---|---|---|
| email | string | Recipient address |
| name | string | Display name |
| role | string | `digest` (gets the daily email) or `admin` (gets failure alerts) |
| board_id | number | 0 = all boards, else only sprints from this board |
| active | boolean | Turn someone off without deleting the row |

**`sprint_health_runs`**: one row per claim attempt. Each row is both the dedupe record and that day's snapshot.

| Column | Example | Purpose |
|---|---|---|
| digest_key | `11:2026-11-16` | sprint id + local date: the unit of "send once" |
| claim_token | `run-…:k3j9` | identifies which run inserted the claim |
| status | pending / sent / failed / lost | lifecycle |
| claimed_at / sent_at | ISO timestamps | stale-claim detection, audit |
| sprint_id, sprint_name, board_id, run_date, health | | |
| total_issues, todo, in_progress, done, blocked, completion_pct, elapsed_pct, stale_count, overdue_count, unassigned_count, overloaded_count, points_total, points_done | | daily snapshot → trend ("+5 pts vs yesterday") |
| recipients_count, error, run_id | | audit |

**Why Data Tables rather than Postgres?** The reviewer asked us to *evaluate* a database instead of workflow static data.

| | Workflow static data (ServiceNow project) | n8n Data Tables (this project) | External Postgres |
|---|---|---|---|
| Saved by manual/test runs | No (production runs only) | Yes | Yes |
| Visible/editable without code | No | Yes (n8n UI) | Needs a SQL client |
| Concurrent writers | Last write wins on the whole blob | Row inserts with DB-assigned ids | Row locks, unique constraints |
| Unique constraints | n/a | **Not on user columns**, so we use the claim/read-back protocol | Native (`ON CONFLICT DO NOTHING`) |
| Extra infrastructure | None | None | A database server + credential |

Data Tables met every requirement here with no new infrastructure. Their one gap, no unique constraints on user columns, is covered by the claim protocol below. If the team later runs n8n in queue mode with several workers on Postgres, the same table can move to Postgres with a unique index on `digest_key`.

## 5. Exactly-one digest per sprint per day

1. **Analyze** checks today's rows first: `sent` → skip, fresh `pending` (< 30 min) → skip as in-flight, `failed` or stale `pending` → send again.
2. **Claim:** insert our own `pending` row with a random `claim_token`. Data Tables can't put a unique constraint on our columns (in n8n 2.45.7 the only unique indexes are on table and column names), so two runs can both get past step 1.
3. **Read back** every row for the `digest_key`. The database assigns ids in insert order, so all runs see the same order.
4. **Decide:** a `sent` row by someone else → lose. Otherwise the **lowest-id live `pending`** row wins (claims older than `staleClaimMinutes` are ignored, which is crash recovery). Losers mark themselves `lost`.
5. **Send** through *Loop Over Items* (batch size 1) → Email node with 3 retries. Errors continue so they can be recorded.
6. **Record:** `pending → sent` or `failed` (with the SMTP error). A `failed` digest is retried by the next run that day.

Tested with 5 simultaneous executions: one email per sprint, 4 `lost` rows each (T05).

**Delivery guarantee:** at-least-once with a narrow window. If n8n crashes after the email is accepted but before *Record Result*, the row stays `pending`. After 30 minutes a manual re-run would send it again. Nothing can make SMTP exactly-once; we chose a possible duplicate over a silently missed digest.

## 6. Error handling

| Failure | Behaviour |
|---|---|
| Jira 429 / 5xx (transient) | Node retries 3× (T06, T07) |
| Jira down / bad credentials / sprint call 500 | Run fails → Error Workflow emails every `admin` recipient (T08, T21) |
| No sprint-capable boards visible | Explicit error with a hint (check permissions / boardIds) (T20) |
| Team-managed Kanban board | Its 400 "does not support sprints" is skipped; other boards continue (T19) |
| No active sprint | Clean `no_active_sprint` summary, no email (T11) |
| Empty sprint | Digest sent with health `Empty` (T12) |
| SMTP rejects one email | That email retries 3×, then `failed`. Others are unaffected and never re-sent. The run raises an error → admin alert. The next run retries only the failed one (T09, T10, T18). |
| Crash between claim and send | Stale claim ignored after 30 min (T13) |
| Overlapping runs | Claim protocol (T05, T14) |
| Unauthorized webhook call | 403 (T17) |

All executions (success and error) are saved in n8n's execution history, and every run has a `runId` that also appears in the email footer and the Data Table.

## 7. Time zones

- The workflow `timezone` setting drives the Schedule trigger, and `Config.timezone` drives "today".
- `duedate` is a calendar date, so it's compared with today's date in the team's timezone, never with UTC midnight (T: `localDate uses the configured timezone`).
- Jira timestamps like `2026-11-16T09:30:00.000+0530` are normalised to `+05:30` before parsing.
