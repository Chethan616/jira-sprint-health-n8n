# Setup instructions

From a fresh Windows laptop to a real sprint digest in your inbox. Allow 60–90 minutes the first time.
On macOS/Linux, use the same steps with Terminal instead of PowerShell.

> **Secrets:** the Jira API token and the email app password go **only** into n8n's Credentials screen
> (and, for the helper scripts, into a terminal window you close afterwards). Never put them in a file in
> this repo, a workflow node, chat or email.

| # | Step | Time |
|---|---|---|
| 1 | [Install the tools](#1-install-the-tools) | 15 min |
| 2 | [Get the project](#2-get-the-project) | 2 min |
| 3 | [Run the automated tests (optional)](#3-run-the-automated-tests-optional) | 10 min |
| 4 | [Create the Jira site and Scrum project](#4-create-the-jira-site-and-scrum-project) | 10 min |
| 5 | [Create a Jira API token](#5-create-a-jira-api-token) | 2 min |
| 6 | [Fill Jira with the sample sprint](#6-fill-jira-with-the-sample-sprint) | 3 min |
| 7 | [Check the live Jira site](#7-check-the-live-jira-site) | 2 min |
| 8 | [Create an email app password](#8-create-an-email-app-password) | 5 min |
| 9 | [Start n8n](#9-start-n8n) | 3 min |
| 10 | [Create the 3 credentials](#10-create-the-3-credentials) | 5 min |
| 11 | [Import the 3 workflows](#11-import-the-3-workflows) | 5 min |
| 12 | [Connect credentials and edit Config](#12-connect-credentials-and-edit-config) | 10 min |
| 13 | [Add the recipients](#13-add-the-recipients) | 3 min |
| 14 | [First runs](#14-first-runs) | 10 min |
| 15 | [Turn on the daily schedule](#15-turn-on-the-daily-schedule) | 1 min |
| | [Troubleshooting](#troubleshooting) · [Live test checklist](#live-test-checklist) | |

---

## 1. Install the tools

1. **Node.js 22 LTS** from <https://nodejs.org>, default options. Open a **new** PowerShell window:
   ```powershell
   node -v      # v22.x or newer
   npm -v
   ```
2. **Git** from <https://git-scm.com/download/win>, default options. This also installs **Git Bash**, which the end-to-end tests need.
   ```powershell
   git --version
   ```
3. **n8n** (Community Edition, 2.x):
   ```powershell
   npm install -g n8n
   n8n --version
   ```

## 2. Get the project

```powershell
cd D:\projects            # any folder
git clone https://github.com/Chethan616/jira-sprint-health-n8n.git
cd jira-sprint-health-n8n
```

The repo is private: if the clone asks for a login, sign in with your GitHub account (or use `gh auth login` from the
GitHub CLI). If it says *not found*, ask the repo owner to add you under **Settings → Collaborators**.

## 3. Run the automated tests (optional)

These use a fake Jira and a fake mail server, so no accounts are needed. They run in their own n8n folder
(`.n8n-test`) and never touch your real n8n.

```powershell
npm test                  # unit tests: expect "pass 28", "fail 0"
```

End-to-end tests need **Git Bash** (Start menu → Git Bash):

```bash
cd /d/projects/jira-sprint-health-n8n
bash tests/setup-test-env.sh     # wait for READY (about 1 minute)
node tests/run-e2e.js            # 27 scenarios, about 5 minutes; last line "27/27 passed"
node scripts/write-test-report.js   # refreshes docs/test-results.md
```

Setup stops any old test servers first, so you can simply re-run it next time.

## 4. Create the Jira site and Scrum project

1. Go to <https://www.atlassian.com/software/jira/free> → **Get it free**, sign up and verify your email.
2. Pick a site name, e.g. `sprinthealth-demo`. Your site is `https://sprinthealth-demo.atlassian.net`.
   **Write this URL down**: it is the *Jira base URL* / *domain* used everywhere below.
3. Choose *Software development*. Skip "invite teammates".
4. **Projects → Create project → Software development → Scrum → Use template.**
   Either *Team-managed* or *Company-managed* works. Name `Sprint Health Demo`, key `SCRUM` (note the key if it differs) → **Create**.
5. Optional: invite teammates under **Settings (gear) → User management → Invite users** (Free plan: up to 10 users).

Notes
- No *Backlog/Sprints* view? **Project settings → Features → Sprints: on**.
- Default workflows have no "Blocked" status. That is fine: the *Flagged* field and "is blocked by" links also count as Blocked.

## 5. Create a Jira API token

1. Open <https://id.atlassian.com/manage-profile/security/api-tokens> (same login as Jira).
2. **Create API token** (the plain one, *without scopes*). Label `n8n sprint monitor`, longest expiry allowed.
3. **Copy it now**: it is shown only once. Keep it in a password manager.

You now have three Jira values: **email** (your Atlassian login), **API token**, **domain** `https://<site>.atlassian.net`.

## 6. Fill Jira with the sample sprint

Creates an active sprint "Payments Sprint 4 (sample)" with 17 issues: done, in progress, flagged, blocked-by link,
overdue and unassigned ones. PowerShell in the project folder, replace the `< >` values:

```powershell
$env:JIRA_BASE_URL="https://<your-site>.atlassian.net"
$env:JIRA_EMAIL="<your jira login email>"
$env:JIRA_API_TOKEN="<your api token>"
$env:JIRA_PROJECT_KEY="SCRUM"
node scripts/seed-jira.js
```

- It ends with `Done.` and prints the **board id**: note it.
- Check in Jira: **Project → Backlog/Board** shows the active sprint with the issues.
- Every issue is assigned to you (a new site has no other users). To spread work, set
  `$env:JIRA_ASSIGNEES="accountId1,accountId2"` before running.
- "In Progress for more than 3 days" can only appear after 3 real days (Jira can't backdate status changes).
  For a same-day demo set `staleInProgressDays: 0` in Config (step 12).

Keep this window open for step 7.

## 7. Check the live Jira site

A read-only pre-flight check. It uses the same paging, rate-limit and Config-validation code as the workflow, and never
writes to Jira. In the same PowerShell window:

```powershell
$env:TIMEZONE="Asia/Kolkata"          # the team's timezone (IANA name, not "IST")
node scripts/live-check.js
```

It checks:

| Check | What to do if it fails |
|---|---|
| Config values valid | Fix the value it names |
| Login works | Re-copy the token; email must be your Atlassian login; URL must be the site root |
| Jira profile timezone vs `TIMEZONE` | Usually set both to the team's zone |
| *Flagged* and *Story points* field ids exist | Use the ids it suggests for `flaggedField` / `storyPointsField` in step 12 |
| Sprint-capable boards and active sprints, incl. sprints shown on several boards | Start a sprint / check project access |
| Issues per sprint, story-point coverage, people sharing a display name | Information only |

Exit code 0 and "All checks passed" means Jira is ready. **Close the PowerShell window afterwards** so the token isn't left in it.

## 8. Create an email app password

The digest is sent over SMTP. With Gmail:

1. Turn on **2-Step Verification**: <https://myaccount.google.com/security>.
2. Create an app password: <https://myaccount.google.com/apppasswords> → name `n8n sprint digest` → **Create**.
   Copy the 16-character password (ignore spaces).
   (If app passwords aren't available, the account is managed by an organisation that blocks them; use another account.)
3. You now have: **user** = the full Gmail address, **password** = the app password, host `smtp.gmail.com`, port `465`, SSL on.

Outlook / Microsoft 365 or a company relay work too: use their SMTP host, port and login.

## 9. Start n8n

Set the instance timezone to the team's timezone, then start n8n:

```powershell
$env:GENERIC_TIMEZONE="Asia/Kolkata"
n8n start
```

Open <http://localhost:5678>. The first time, create the local owner account (only for this n8n, not Jira or Google).
Keep the window open: closing it stops n8n.

## 10. Create the 3 credentials

**Credentials → Add credential.** Use **exactly** these names:

| Name (must match) | Type | Values |
|---|---|---|
| `Jira Cloud (sprint monitor)` | *Jira SW Cloud API* | Email, API token, Domain `https://<site>.atlassian.net` (no trailing slash). Save: "Connection tested successfully" |
| `SMTP (sprint digest)` | *SMTP* | User, app password, host `smtp.gmail.com`, port `465`, SSL/TLS **on** |
| `Sprint digest webhook token` | *Header Auth* | Name `X-Digest-Token`, Value: a long random string (30+ characters). Keep a copy for step 14 |

## 11. Import the 3 workflows

| File | Workflow name | Purpose |
|---|---|---|
| `workflows/jira-get.json` | Jira Sprint Health - Jira GET | Every Jira call: pagination, Retry-After, exponential backoff |
| `workflows/error-handler.json` | Jira Sprint Health - Error Handler | Emails the admins when a run fails |
| `workflows/jira-sprint-health-monitor.json` | Jira Sprint Health Monitor & Daily Digest | The monitor itself |

**Option A: command line (recommended, keeps the links between the workflows).** Stop n8n (Ctrl+C), then:

```powershell
n8n import:workflow --input=workflows/jira-get.json
n8n import:workflow --input=workflows/error-handler.json
n8n import:workflow --input=workflows/jira-sprint-health-monitor.json
$env:GENERIC_TIMEZONE="Asia/Kolkata"; n8n start
```

**Option B: editor.** For each file, in the order above: **Create workflow → ⋯ → Import from File… → Save.**
The editor gives imported workflows new ids, so step 12 includes re-linking them.

## 12. Connect credentials and edit Config

Nodes with a warning triangle need a credential: double-click → pick it from the dropdown → close.

**a) "Jira Sprint Health - Jira GET"**
- **Jira Request** → `Jira Cloud (sprint monitor)`. This is the only node that talks to Jira.
- Save, then **Publish** it (the test setup also publishes it; it has no schedule of its own and only runs when the monitor calls it).

**b) "Jira Sprint Health - Error Handler"**
- **Email Admins** → `SMTP (sprint digest)`, and set its *From Email* to your sender address.
- Save.

**c) "Jira Sprint Health Monitor & Daily Digest"**
- **Send Digest Email** → `SMTP (sprint digest)`; **Run Now (webhook)** → `Sprint digest webhook token`.
- Only after an editor import (Option B): open **Get Scrum Boards**, **Get Active Sprints** and **Get Sprint Issues**, and in
  *Workflow* choose **Jira Sprint Health - Jira GET** from the list.
- Open **Config** and edit the values at the top:
  ```js
  jiraBaseUrl: 'https://<your-site>.atlassian.net',   // site root, same as the credential domain
  boardIds: [<board id from step 6>],                  // or [] for every board
  timezone: 'Asia/Kolkata',                            // IANA name
  fromEmail: 'Sprint Digest <your-address@gmail.com>',
  staleInProgressDays: 3,                              // 0 for a same-day demo
  flaggedField: 'customfield_10021',                   // ids from step 7, if different
  storyPointsField: 'customfield_10016',
  ```
  Everything else can stay as is (see [workflows/README.md](workflows/README.md#config-reference) for every key).
- **⋯ → Settings**: *Error workflow* → **Jira Sprint Health - Error Handler**; *Timezone* → the **same zone as
  `Config.timezone`** → Save.
- **Save** the workflow.

Every run checks Config first. A wrong value (a typo in the URL, `timezone: 'IST'`, a threshold that isn't a number,
`pageSize` above 100, …) or a **workflow timezone different from `Config.timezone`** stops the run in the Config node,
before any Jira call or email, with a list of what to fix. The admins also get that list by email.

## 13. Add the recipients

Recipients live in an n8n Data Table, never in the workflow.

1. In the monitor, click **Execute workflow** once. The first run creates the Data Tables. With no recipients yet it sends nothing (expected).
2. **Overview → Data tables → `sprint_digest_recipients`** → add rows:

   | email | name | role | board_id | active |
   |---|---|---|---|---|
   | team-lead@… | Team lead | digest | 0 | true |
   | you@… | You | digest | 0 | true |
   | you@… | You | admin | 0 | true |

   - `role`: `digest` gets the daily digest, `admin` gets failure alerts.
   - `board_id`: `0` = every board; a board id = only sprints shown on that board. A sprint that appears on several boards
     goes to the subscribers of each of them, once (`Config.sprintBoardRouting: 'origin'` limits it to the sprint's own board).
   - `active: false` pauses someone without deleting the row.

## 14. First runs

**a) Real run from the editor.** **Execute workflow.** Every node turns green. Open **Run Summary**: each sprint shows
health, issue and story-point progress and `"outcome": "sent"`. Check the inbox (and spam) for
`[Sprint Health] Payments Sprint 4 (sample) | Critical | 29% done | <date>`. The `sprint_health_runs` table now has a `sent` row.

**b) Same-day re-run.** **Execute workflow** again → `"outcome": "skip_already_sent"`, no second email.

**c) Dry run and forced resend through the webhook** (needs the workflow published, step 15):

```powershell
$h = @{ "X-Digest-Token" = "<your webhook token>" }
$u = "http://localhost:5678/webhook/sprint-health/run"
Invoke-RestMethod -Method Post -Uri $u -Headers $h -ContentType "application/json" -Body '{"dryRun": true}'   # preview only
Invoke-RestMethod -Method Post -Uri $u -Headers $h -ContentType "application/json" -Body '{"force": true}'    # resend today's digest
```

A wrong token returns 403 (expected).

**d) Failure alert (optional).** Set `jiraBaseUrl` to `https://wrong-site.atlassian.net`, publish, trigger the webhook →
the admins get `[Sprint Health] Workflow failure: …`. Put the right URL back. (Runs started with *Execute workflow* in the
editor don't trigger the error workflow; only published runs do.)

## 15. Turn on the daily schedule

1. Monitor → **Publish**.
2. It now runs **Monday–Friday at 09:00 in the workflow timezone**, and the webhook works.
3. Every day instead: open **Daily 09:00 (Mon-Fri)** and change `0 9 * * 1-5` to `0 9 * * *`.
4. n8n must be running at 09:00 (window open, laptop awake), or host it on a server.
5. **Executions** (left sidebar) lists every run.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `n8n` is not recognized | Open a new PowerShell after installing, or `npm install -g n8n` again |
| Port 5678 in use | Another n8n is running: close it, or `$env:N8N_PORT="5679"; n8n start` |
| **Invalid Config (N problems …)** | The message lists each bad value. Fix them in the **Config** node |
| **workflow timezone is X but Config.timezone is Y** | Workflow **Settings → Timezone** = `Config.timezone` (or set `GENERIC_TIMEZONE` and leave Settings on *Default*) |
| **jiraBaseUrl / fromEmail is still the placeholder** | Step 12c: put in your site URL and sender address |
| Jira credential test fails / 401 | Email = Atlassian login; re-copy the token; domain without trailing slash |
| **Jira GET … failed: HTTP 401/403/404** (no retries) | Credential or permissions: these are not retried because retrying can't fix them |
| **rate-limited: Jira asked to retry after N s** | Jira is throttling heavily. Run later, or raise `jiraRetryMaxDelayMs` (max 60000) |
| "Workflow does not exist" / sub-workflow not found | Step 12c: re-select **Jira Sprint Health - Jira GET** in the three *Get …* nodes, and publish it |
| "No sprint-capable boards found" | The user can't see the project, the project isn't Scrum, or `boardIds` is wrong. Try `boardIds: []` |
| `no_active_sprint` | Start a sprint: Jira → Backlog → Start sprint |
| `skip_no_recipients` | Add `digest` rows with `active = true` (step 13) |
| Email "Invalid login" | Use the app password, not the normal password; SSL on with port 465 |
| Health uses issue count although story points exist | Fewer than `minPointsCoveragePct` (50%) of the issues are estimated; the email says so |
| Two people with the same name | Shown as `Name (…1a2b)`: the digest groups people by Jira account id |

## Live test checklist

Tick these off on the real Jira site and mailbox. Record the results in `docs/test-results.md`.

- [ ] `scripts/seed-jira.js` created the sample sprint
- [ ] `scripts/live-check.js` → "All checks passed"
- [ ] Config edited; a deliberately wrong value (e.g. `timezone: 'IST'`) stops the run with a clear message, then reverted
- [ ] Workflow Settings timezone set to a different zone → run stops with the timezone-mismatch message, then reverted
- [ ] Dry run preview matches the seeded sprint (counts, flags, story points)
- [ ] Real digest received in the mailbox, readable in both HTML and plain text
- [ ] Same-day re-run → `skip_already_sent`, no second email
- [ ] `{"force": true}` → digest re-sent
- [ ] Wrong `jiraBaseUrl` → admin alert email received
- [ ] Recipient with `board_id` of a second board that shows the sprint → receives it once
- [ ] Two Jira users with the same display name (optional) → listed separately in Workload
- [ ] "In Progress > 3 days" verified after 3 days, or with `staleInProgressDays: 0`
- [ ] Scheduled 09:00 run fired at 09:00 in the team's timezone (Executions list)
