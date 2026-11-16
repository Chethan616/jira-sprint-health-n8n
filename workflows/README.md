# Workflows: import and configuration

| File | Purpose |
|---|---|
| `jira-sprint-health-monitor.json` | Main workflow: daily digest, plus on-demand webhook and manual runs |
| `error-handler.json` | Error workflow: emails the `admin` recipients when the monitor fails |

Both are generated from `src/` by `node scripts/build-workflows.js`. They contain credential **names** only and no secrets.

## 1. Jira Cloud

1. Create a free Jira Cloud site and a **Scrum** project (e.g. key `SCRUM`).
2. Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
3. Optional but recommended: seed the sample sprint.
   ```powershell
   $env:JIRA_BASE_URL="https://your-team.atlassian.net"; $env:JIRA_EMAIL="you@example.com"
   $env:JIRA_API_TOKEN="<token>"; $env:JIRA_PROJECT_KEY="SCRUM"
   node scripts/seed-jira.js
   ```

## 2. n8n credentials (Credentials → Add credential)

| Name (must match) | Type | Values |
|---|---|---|
| `Jira Cloud (sprint monitor)` | Jira SW Cloud API | Email, API token, Domain `https://your-team.atlassian.net` |
| `SMTP (sprint digest)` | SMTP | e.g. Gmail: host `smtp.gmail.com`, port 465, SSL on, user + app password |
| `Sprint digest webhook token` | Header Auth | Name `X-Digest-Token`, Value: a long random string |

## 3. Import

1. Import `error-handler.json`, then `jira-sprint-health-monitor.json` (Workflows → Import from file).
2. Open each node that shows a credential warning and select the credential above.
3. Main workflow → **Settings** → *Error workflow* → `Jira Sprint Health - Error Handler`. Check the timezone.
   In the error handler, set *From Email* on **Email Admins** to your sender address (it can't read the main workflow's Config).
4. Edit the **Config** node: `jiraBaseUrl` (same as the credential domain), `fromEmail`, `timezone`, and optionally `boardIds`, thresholds and the `flaggedField` / `storyPointsField` ids for your site.

## 4. Recipients (no addresses in the workflow)

Run the workflow once (manual run). It creates the Data Tables. Then open **Data tables → sprint_digest_recipients** and add rows:

| email | name | role | board_id | active |
|---|---|---|---|---|
| team-lead@… | Team lead | digest | 0 | true |
| you@… | You | admin | 0 | true |

`board_id = 0` means every board. `role = admin` gets failure alerts.

## 5. Try it

- **Dry run** (no email, no state written; returns subject and text):
  `curl -X POST <n8n>/webhook/sprint-health/run -H "X-Digest-Token: <token>" -H "Content-Type: application/json" -d '{"dryRun":true}'`
- **Real run:** the same call without a body, or *Execute workflow* in the editor.
- **Resend today's digest:** `-d '{"force":true}'`
- **Publish** the workflow to enable the 09:00 Mon-Fri schedule.

## Config reference

| Key | Default | Meaning |
|---|---|---|
| `jiraBaseUrl` | `https://your-team.atlassian.net` | Jira site root |
| `boardIds` | `[]` | Boards to monitor; empty = every sprint-capable board |
| `boardTypes` | `["scrum","simple"]` | `scrum` = company-managed, `simple` = team-managed |
| `timezone` | `Asia/Kolkata` | "Today", overdue checks, digest date |
| `staleInProgressDays` | 3 | In Progress longer than this is flagged |
| `overloadThreshold` | 5 | Unresolved issues per person to flag as overloaded |
| `blockedStatusNames` | `["Blocked"]` | Statuses treated as Blocked |
| `flaggedField` | `customfield_10021` | Jira "Flagged" field |
| `storyPointsField` | `customfield_10016` | Story point estimate (`''` to disable) |
| `criticalBlockedCount` / `criticalBehindPct` / `atRiskBehindPct` | 3 / 30 / 15 | Health thresholds |
| `pageSize` / `maxPages` | 100 / 50 | Jira paging |
| `staleClaimMinutes` | 30 | Age after which an unfinished claim counts as a crashed run |
| `maxListItems` | 10 | Rows per list in the email |
