# Workflows: reference

Step-by-step setup is in **[INSTRUCTIONS.md](../INSTRUCTIONS.md)**. This page is the short reference.

| File | Workflow | Purpose |
|---|---|---|
| `jira-sprint-health-monitor.json` | Jira Sprint Health Monitor & Daily Digest | Main workflow: daily digest, on-demand webhook and manual runs |
| `jira-get.json` | Jira Sprint Health - Jira GET | Sub-workflow for **every** Jira call: pagination, Retry-After, exponential backoff |
| `error-handler.json` | Jira Sprint Health - Error Handler | Error workflow: emails the `admin` recipients when the monitor fails |

All three are generated from `src/` by `node scripts/build-workflows.js` (which also validates `src/config.js`).
They contain credential **names** only, no secrets and no email addresses.

## Credentials

| Name (must match) | Type | Used by |
|---|---|---|
| `Jira Cloud (sprint monitor)` | Jira SW Cloud API | Jira GET → **Jira Request** |
| `SMTP (sprint digest)` | SMTP | Monitor → **Send Digest Email**; Error Handler → **Email Admins** |
| `Sprint digest webhook token` | Header Auth (`X-Digest-Token`) | Monitor → **Run Now (webhook)** |

## Import

- **CLI** (keeps the ids that link the workflows): `n8n import:workflow --input=workflows/<file>` for `jira-get.json`,
  `error-handler.json`, `jira-sprint-health-monitor.json`, in that order.
- **Editor** (*Import from File*): afterwards re-select **Jira Sprint Health - Jira GET** in the monitor's *Get Scrum Boards*,
  *Get Active Sprints* and *Get Sprint Issues* nodes, and the error workflow in the monitor's Settings.
- Monitor **Settings → Timezone** must equal `Config.timezone`: the Schedule trigger fires in the workflow timezone, and
  the run stops if the two differ.

## Running

| How | Body | Effect |
|---|---|---|
| Schedule `0 9 * * 1-5` (workflow timezone) | | Daily digest |
| *Execute workflow* in the editor | | Same as the schedule (the Error Workflow doesn't fire for editor runs) |
| `POST /webhook/sprint-health/run` + `X-Digest-Token` header | `{"dryRun": true}` | Preview: returns subject and text, sends nothing, writes nothing |
| | `{"force": true}` | Re-send today's digest even if already sent |

The response (and the **Run Summary** node) lists, per sprint: health, issue %, story-point %, the progress used for
health, boards, recipients and the outcome (`sent`, `failed`, `skip_already_sent`, `skip_in_flight`, `skip_no_recipients`,
`lost_race`, `preview`), plus `timezone`, `workflowTimezone` and any `configWarnings`.

## Recipients (`sprint_digest_recipients` Data Table)

| email | name | role | board_id | active |
|---|---|---|---|---|
| team-lead@… | Team lead | digest | 0 | true |
| you@… | You | admin | 0 | true |

`board_id = 0` means every board. A board id means every sprint **shown on** that board: a sprint that appears on several
boards goes to the subscribers of each, once. `role = admin` gets failure alerts.

## Config reference

Edit the `CONFIG` object at the top of the **Config** node. Every key is validated when the run starts
(`src/validate.js`); errors stop the run, warnings appear in the summary.

| Key | Default | Meaning | Validation |
|---|---|---|---|
| `jiraBaseUrl` | `https://your-team.atlassian.net` | Jira site root, same as the credential domain | URL, site root only; placeholder rejected |
| `boardIds` | `[]` | Boards to monitor; empty = every sprint-capable board | positive integers |
| `boardTypes` | `["scrum","simple"]` | `scrum` = company-managed, `simple` = team-managed | non-empty, known types |
| `timezone` | `Asia/Kolkata` | "Today", overdue checks, digest date | IANA Region/City; must equal the workflow timezone |
| `staleInProgressDays` | 3 | In Progress longer than this is flagged | 0–365 |
| `overloadThreshold` | 5 | Unresolved issues per person (by account id) to flag as overloaded | 1–1000 |
| `blockedStatusNames` | `["Blocked"]` | Statuses treated as Blocked | list of names |
| `flaggedField` | `customfield_10021` | Jira "Flagged" field | field id or `''` |
| `storyPointsField` | `customfield_10016` | Story point estimate | field id or `''` |
| `criticalBlockedCount` | 3 | Blocked issues for Critical | 1–1000 |
| `criticalBehindPct` / `atRiskBehindPct` | 30 / 15 | Progress behind elapsed time for Critical / At Risk | 1–100, At Risk ≤ Critical |
| `progressBasis` | `both` | `issues`, `points`, or `both` (the lower of the two) | one of those |
| `minPointsCoveragePct` | 50 | Story points count for health only if this % of issues are estimated | 0–100 |
| `sprintBoardRouting` | `all` | `all` = subscribers of every board showing the sprint; `origin` = its own board only | `all` / `origin` |
| `pageSize` / `maxPages` | 100 / 50 | Jira page size and per-call page cap | 1–100 / 1–1000 |
| `jiraMaxRetries` | 4 | Retries per Jira request on 429/5xx/network errors | 0–10 |
| `jiraRetryBaseDelayMs` | 1000 | Backoff base: `base × 2^attempt`, half fixed + half random | 100–60000 |
| `jiraRetryMaxDelayMs` | 30000 | Longest single wait; a longer `Retry-After` fails the run instead of stalling it | 1000–60000 |
| `jiraPageIntervalMs` | 200 | Pause between pages | 0–10000 |
| `fromEmail` | `n8n Sprint Digest <…@your-domain.com>` | Sender | valid address; placeholder rejected |
| `staleClaimMinutes` | 30 | Age after which an unfinished claim counts as a crashed run | 1–1440 |
| `maxListItems` | 10 | Rows per list in the email | 1–200 |

## Jira retry policy (Jira GET sub-workflow)

| Response | Action |
|---|---|
| 2xx | Keep the page; next page after `jiraPageIntervalMs` (`startAt`/`isLast`, or `nextPageToken`; a repeated token stops) |
| Retryable status (408, 425, 429, 500, 502, 503, 504) **with** `Retry-After` / `X-RateLimit-Reset` | Wait exactly that long (fail if longer than `jiraRetryMaxDelayMs`) |
| Retryable status without those headers, or a network error | Exponential backoff with jitter |
| Any other 4xx (400, 401, 403, 404, …) | Fail at once; retrying can't fix it. A 400 from a Kanban board's sprint list is skipped |
| Retries used up | Fail with the last status and Jira's error message |
