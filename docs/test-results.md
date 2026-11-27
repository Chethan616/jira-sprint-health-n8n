# Test results

**Environment:** n8n 2.48.8 (n8n start, isolated user folder) + mock Jira Cloud + SMTP sink
**Run at:** 2026-11-27T08:14:56.961Z
**End-to-end:** 27/27 passed · **Unit:** 28/28 passed

> All end-to-end tests ran against a **local mock Jira Cloud API** (`tests/mock-jira.js`) and an **SMTP sink**
> (`tests/smtp-sink.js`), driving a real n8n server (n8n 2.48.8) through its webhook trigger.
> Live-site results go in the checklist at the end (steps in [INSTRUCTIONS.md](../INSTRUCTIONS.md#live-test-checklist)).
> `scripts/live-check.js` runs the same paging/retry and Config-validation code read-only against a live Jira site.

## How to reproduce

```bash
node --test tests/unit.test.js     # 28 unit tests, no n8n needed
./tests/setup-test-env.sh          # isolated n8n (.n8n-test) + mock Jira :5698 + SMTP sink :2525
node tests/run-e2e.js              # 27 end-to-end scenarios
node scripts/write-test-report.js  # regenerates this file
```

The mock Jira caps agile pages at 1 item and search pages at 5 issues, so every run exercises pagination
(boards: 3 pages, sprint 11: 4 pages of `/search/jql` using `nextPageToken`).

## End-to-end scenarios

| ID | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| T01 | Happy path: two active sprints, paginated Jira, digest emailed | Both sprints sent; Payments=Critical 29% (3 blocked, 2 stale, 2 overdue, 2 unassigned, Priya overloaded); Mobile=Healthy; 10 Jira calls incl. 3 board pages and 4 search pages | HTTP 200; sent=2; Payments Critical 29% blocked=3 stale=2 overdue=2 unassigned=2 overloaded=Priya Raman; Jira calls=10 (sprint-11 pages=4); emails=2; rows=sent,sent | PASS |
| T02 | Same-day re-run is deduplicated | Second run sends nothing (skip_already_sent); still 2 emails total | outcomes={"Payments Sprint 4":"skip_already_sent","Mobile Sprint 9":"skip_already_sent"}; emails total=2 | PASS |
| T03 | Manual resend with {"force":true} | Both sprints re-sent; 4 emails total | outcomes={"Payments Sprint 4":"sent","Mobile Sprint 9":"sent"}; emails total=4 | PASS |
| T04 | Dry run returns a preview without sending or writing state | outcome=preview with subject/text; 0 emails; 0 rows | outcomes=preview,preview; emails=0; rows=0; subject="[Sprint Health] Payments Sprint 4 \| Critical \| 29% done \| 2026-11-27" | PASS |
| T05 | Concurrency: 5 overlapping executions at once | Exactly 1 email per sprint (2 total); 1 sent row per sprint, every other claim marked lost or skipped | emails=2; rows per key={"11:2026-11-27":["1:sent","3:lost","5:lost","7:lost","9:lost"],"21:2026-11-27":["2:sent","4:lost","6:lost","8:lost","10:lost"]}; run outcomes=["sent/sent","lost_race/lost_race","lost_race/lost_race","lost_race/lost_race","lost_race/lost_race"] | PASS |
| T06 | Jira returns HTTP 500 twice on issue search | Node retries (3 tries) and the run still succeeds; 2 emails | HTTP 200; sent=2; emails=2; Jira calls=12 (incl. 2 failed) | PASS |
| T07 | Jira rate limit (HTTP 429) on sprint lookup | Retried after back-off; run succeeds | HTTP 200; sent=2 | PASS |
| T08 | Jira down (HTTP 500 on every call) | Run fails after 4 retries with backoff; no digest; Error Workflow emails the admin with Jira error text | HTTP 500; digests=0; admin alert="[Sprint Health] Workflow failure: Get Scrum Boards failed: Jira GET /rest/agile/1.0/board failed after 5 attempts: HTTP 500: mock injected 500 [line 9]" | PASS |
| T09 | SMTP rejects the first digest (all 3 attempts) | Payments=failed, Mobile=sent; failed row recorded; run errors; admin alerted | HTTP 500; rows={"Payments Sprint 4":"failed","Mobile Sprint 9":"sent"}; error="Data command failed: 554 5.7.1 mock: message rejected"; admin alert=yes | PASS |
| T10 | Re-run after SMTP failure retries only the failed digest | Payments sent now; Mobile skip_already_sent | outcomes={"Payments Sprint 4":"sent","Mobile Sprint 9":"skip_already_sent"}; new emails=1 | PASS |
| T18 | Regression: one transient SMTP rejection must not re-send other digests | Payments retried and delivered once; Mobile delivered exactly once (no duplicate) | HTTP 200; events=rejected, accepted:Payments, accepted:Mobile | PASS |
| T19 | Team-managed project: boards of type "simple", one of them Kanban | Sprint on the team-managed Scrum board is sent; the Kanban board's HTTP 400 "does not support sprints" is skipped, not an error | HTTP 200; outcomes={"Web Sprint 2":"sent"}; kanban board queried (400)=true | PASS |
| T20 | No sprint-capable boards visible to the API user | Run fails with a clear "No sprint-capable boards" error; admin alerted; no digest | HTTP 500; admin alert="[Sprint Health] Workflow failure: No sprint-capable boards found (types scrum/simple). Check the Jira user can browse the project, or fix Config.boardIds " | PASS |
| T21 | Sprint lookup returns HTTP 500 on every attempt (boards OK) | Not mistaken for a Kanban 400: run fails, admin alerted, no digest | HTTP 500; digests=0; admin alert="[Sprint Health] Workflow failure: Get Active Sprints failed: Jira GET /rest/agile/1.0/board/1/sprint failed after 5 attempts: HTTP 500: mock injected 500 " | PASS |
| T11 | No active sprint on any board | status=no_active_sprint; no emails; no rows | HTTP 200; status=no_active_sprint; emails=0; rows=0 | PASS |
| T12 | Active sprint with zero issues | Digest still sent with health=Empty, 0% | Payments Sprint 4: Empty 0% sent; Mobile Sprint 9: Empty 0% sent | PASS |
| T13 | Crash recovery: stale pending claim (2h old) does not block today's digest | Stale claim ignored; digest sent | outcomes={"Payments Sprint 4":"sent","Mobile Sprint 9":"sent"} | PASS |
| T14 | In-flight protection: fresh pending claim (1 min old) from another run | Payments skip_in_flight; no duplicate email for it | outcomes={"Payments Sprint 4":"skip_in_flight","Mobile Sprint 9":"sent"}; Payments emails=0 | PASS |
| T15 | Day-over-day trend from yesterday's snapshot | Email shows "+9 pts vs <yesterday>" (29% today vs 20% yesterday) | found "+9 pts vs 2026-11-26" in email | PASS |
| T16 | No active recipients configured | skip_no_recipients; no emails, no claims | outcomes={"Payments Sprint 4":"skip_no_recipients","Mobile Sprint 9":"skip_no_recipients"}; emails=0; rows=0 | PASS |
| T17 | Webhook without the correct token | Rejected (HTTP 403), workflow not executed | HTTP 403; Jira calls=0 | PASS |
| T22 | Sprint shown on two boards (origin board 1 + board 2): recipients of both boards, one email | Payments sent once to team@ AND mobile@ (board 2 subscriber); Mobile sent once; 2 emails, 2 sent rows | HTTP 200; emails=2; Payments to=[<team@test.local>,<mobile@test.local>] boards=[1,2]; sent rows=2 | PASS |
| T23 | HTTP 429 with Retry-After: 2 on issue search | Retried once after waiting >= 2 s (the Retry-After value, not a fixed delay); run succeeds | HTTP 200; sent=2; first-page calls=429,200; wait before retry=2033 ms | PASS |
| T24 | HTTP 503 twice without Retry-After: exponential backoff | Retries after ~0.5-1 s, then ~1-2 s (second wait >= first); run succeeds | HTTP 200; first-page calls=503,503,200; waits=784 ms, 1675 ms | PASS |
| T25 | HTTP 403 on issue search is not retried | Exactly 1 search call per sprint (no pointless retries); run fails with the 403 in the alert; no digest | HTTP 500; search calls per sprint={"11":1,"21":1}; digests=0; admin alert=[Sprint Health] Workflow failure: Get Sprint Issues failed for sprint 11 (Payments Sprint 4): Jira GET /rest/a | PASS |
| T26 | Config validation and timezone check inside n8n | Monitor reports workflow tz = Config tz (Asia/Kolkata); a workflow on America/New_York flags the mismatch; bad values are listed; matching tz passes | monitor tz=Asia/Kolkata/Asia/Kolkata; NY workflow: 1 error ("workflow timezone is America/New_York but Config.timezone is Asia/Kolk..."); matching tz: 0 errors; bad values: 3 errors | PASS |
| T27 | Invalid Config stops the real run before any Jira call | Shipped placeholder config (your-team.atlassian.net) fails in the Config node; 0 Jira calls; admin alerted with the problem list | HTTP 500; Jira calls=0; admin alert="[Sprint Health] Workflow failure: Invalid Config (2 problems; edit the Config node or Work" | PASS |

## Bug found by testing (and fixed)

The first version sent all digests through one Email node with *Retry On Fail*. When the SMTP server rejected
one email, n8n retried the **whole node**, so the digest that had already been delivered was sent again
(observed: Mobile digest delivered twice after a single rejection of the Payments digest).
Fix: a *Loop Over Items* node (batch size 1) in front of the Email node, so a retry only re-sends the one
email that failed. Regression test: **T18**.

## Review follow-ups and the tests that cover them

| Review point | Change | Tests |
|---|---|---|
| Group assignees by Jira account id | Workload keyed by `accountId`; same display name shown as `Name (…1a2b)` | unit: *workload groups by accountId* |
| Sprint shown on several boards | Collect Sprints keeps every board that lists the sprint; recipients of each board get it once (`sprintBoardRouting`) | unit: *sprint on several boards*; e2e **T22** |
| Validate configuration | `src/validate.js` runs in the Config node and at build time: required values, ranges, URL, IANA timezone, API limits | unit: *validateConfig* ×3; e2e **T26**, **T27** |
| Story-point progress | `progressBasis` (issues / points / both = lower), coverage threshold, points in email and trend | unit: *progress basis*, *story points ignored…*, *delta includes story points* |
| Retry-After and exponential backoff | "Jira GET" sub-workflow (`src/jira-paging.js`): waits Retry-After / X-RateLimit-Reset, backoff with jitter on 5xx/network, no retry on other 4xx | unit: *retryAfterMs*, *backoffMs*, *paging*, *rate limits*; e2e **T06**, **T07**, **T23**, **T24**, **T25** |
| Scheduling timezone consistency | Config node compares the workflow timezone (`$now.zoneName`, used by the Schedule trigger) with `Config.timezone` and stops on a mismatch | unit: *workflow timezone must match*; e2e **T26** |
| Live Jira + real mailbox | `scripts/live-check.js` pre-flight + checklist below | manual |

## Unit tests (`tests/unit.test.js`)

| Test | Result |
|---|---|
| parseJiraDate handles +0530 offsets | PASS |
| localDate uses the configured timezone, not UTC | PASS |
| merges pages per sprint and categorises issues | PASS |
| blocked detection: status, flagged field, unresolved blocker link | PASS |
| in progress > 3 days uses statuscategorychangedate and excludes blocked | PASS |
| overdue excludes done issues; unassigned excludes done | PASS |
| workload flags overloaded members at threshold | PASS |
| health: 3 blocked -> Critical; small healthy sprint -> Healthy | PASS |
| recipients: board filter, inactive and admin rows excluded | PASS |
| dedupe: already sent today -> skip; stale pending -> send; fresh pending -> skip | PASS |
| no recipients -> skip; dryRun -> preview | PASS |
| day-over-day delta uses the latest sent snapshot before today | PASS |
| empty sprint -> Empty health, 0% | PASS |
| email escapes HTML and links issues | PASS |
| claims: lowest live pending id wins, others lose | PASS |
| claims: sent row beats any pending; stale pending ignored | PASS |
| workload groups by accountId: two people with the same display name stay separate | PASS |
| sprint on several boards: recipients of every board get it once; origin-only routing is optional | PASS |
| progress basis: both = lower of issue and story-point progress; issues/points on request | PASS |
| story points ignored for health when too few issues are estimated | PASS |
| day-over-day delta includes story points when both snapshots have them | PASS |
| validateConfig: valid config passes; shipped placeholders are rejected | PASS |
| validateConfig: catches bad thresholds, types, timezone, URL and API settings | PASS |
| validateConfig: workflow timezone must match Config.timezone | PASS |
| retryAfterMs: seconds, HTTP-date, X-RateLimit-Reset, absent | PASS |
| backoffMs: exponential with equal jitter, capped | PASS |
| paging: startAt/isLast and nextPageToken, with page cap and repeated-token guard | PASS |
| rate limits: Retry-After honoured, backoff otherwise, 4xx not retried, retries exhausted | PASS |

## Live run checklist (real Jira site and mailbox)

Steps: [INSTRUCTIONS.md](../INSTRUCTIONS.md#live-test-checklist).

Live run on 27 Nov 2026: the sample sprint was seeded on our Jira Cloud site and the digest arrived in a real Gmail inbox.

- [x] `scripts/seed-jira.js` created the sample sprint on our Jira Cloud site (27 Nov 2026)
- [ ] `scripts/live-check.js` → "All checks passed"
- [ ] A deliberately wrong Config value and a workflow/Config timezone mismatch each stop the run with a clear message
- [ ] Dry run preview matches the seeded sprint (counts, flags, story points)
- [x] Real digest received in our Gmail inbox (27 Nov 2026)
- [ ] Same-day re-run skipped; `{"force": true}` re-sends
- [ ] Error workflow alert received after pointing Config.jiraBaseUrl at a wrong host
- [ ] Recipient subscribed to a second board that shows the sprint receives it once
- [ ] "In Progress > 3 days" verified after 3 real days (Jira can't backdate status changes), or with Config.staleInProgressDays = 0
- [ ] Scheduled 09:00 run fired at 09:00 in the team's timezone
