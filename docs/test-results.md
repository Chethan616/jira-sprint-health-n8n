# Test results

**Environment:** n8n 2.45.7 (n8n start, isolated user folder) + mock Jira Cloud + SMTP sink
**Run at:** 2026-11-16T06:23:40.409Z
**End-to-end:** 21/21 passed · **Unit:** 16/16 passed

> All end-to-end tests ran against a **local mock Jira Cloud API** (`tests/mock-jira.js`) and an **SMTP sink**
> (`tests/smtp-sink.js`), driving a real n8n 2.45.7 server through its webhook trigger. They have **not** yet been
> run against a live Jira Cloud site or a real mailbox; see "Live run checklist" below.

## How to reproduce

```bash
node --test tests/unit.test.js     # 16 unit tests, no n8n needed
./tests/setup-test-env.sh          # isolated n8n (.n8n-test) + mock Jira :5698 + SMTP sink :2525
node tests/run-e2e.js              # 21 end-to-end scenarios
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
| T04 | Dry run returns a preview without sending or writing state | outcome=preview with subject/text; 0 emails; 0 rows | outcomes=preview,preview; emails=0; rows=0; subject="[Sprint Health] Payments Sprint 4 \| Critical \| 29% done \| 2026-11-16" | PASS |
| T05 | Concurrency: 5 overlapping executions at once | Exactly 1 email per sprint (2 total); 1 sent row per sprint, every other claim marked lost or skipped | emails=2; rows per key={"11:2026-11-16":["1:sent","3:lost","5:lost","7:lost","9:lost"],"21:2026-11-16":["2:sent","4:lost","6:lost","8:lost","10:lost"]}; run outcomes=["sent/sent","lost_race/lost_race","lost_race/lost_race","lost_race/lost_race","lost_race/lost_race"] | PASS |
| T06 | Jira returns HTTP 500 twice on issue search | Node retries (3 tries) and the run still succeeds; 2 emails | HTTP 200; sent=2; emails=2; Jira calls=12 (incl. 2 failed) | PASS |
| T07 | Jira rate limit (HTTP 429) on sprint lookup | Retried after back-off; run succeeds | HTTP 200; sent=2 | PASS |
| T08 | Jira down (HTTP 500 on every call) | Run fails after retries; no digest; Error Workflow emails the admin | HTTP 500; digests=0; admin alert="[Sprint Health] Workflow failure: The service was not able to process your request" | PASS |
| T09 | SMTP rejects the first digest (all 3 attempts) | Payments=failed, Mobile=sent; failed row recorded; run errors; admin alerted | HTTP 500; rows={"Payments Sprint 4":"failed","Mobile Sprint 9":"sent"}; error="Data command failed: 554 5.7.1 mock: message rejected"; admin alert=yes | PASS |
| T10 | Re-run after SMTP failure retries only the failed digest | Payments sent now; Mobile skip_already_sent | outcomes={"Payments Sprint 4":"sent","Mobile Sprint 9":"skip_already_sent"}; new emails=1 | PASS |
| T18 | Regression: one transient SMTP rejection must not re-send other digests | Payments retried and delivered once; Mobile delivered exactly once (no duplicate) | HTTP 200; events=rejected, accepted:Payments, accepted:Mobile | PASS |
| T19 | Team-managed project: boards of type "simple", one of them Kanban | Sprint on the team-managed Scrum board is sent; the Kanban board's HTTP 400 "does not support sprints" is skipped, not an error | HTTP 200; outcomes={"Web Sprint 2":"sent"}; kanban board queried (400)=true | PASS |
| T20 | No sprint-capable boards visible to the API user | Run fails with a clear "No sprint-capable boards" error; admin alerted; no digest | HTTP 500; admin alert="[Sprint Health] Workflow failure: No sprint-capable boards found (types scrum/simple). Check the Jira user can browse the project, or fix Config.boardIds " | PASS |
| T21 | Sprint lookup returns HTTP 500 on every attempt (boards OK) | Not mistaken for a Kanban 400: run fails, admin alerted, no digest | HTTP 500; digests=0; admin alert="=?UTF-8?Q?=5BSprint_Health=5D_Workflow_failure=3A_?= =?UTF-8?Q?Get_Active_Sprints_failed=3A_=7B=22statu?= =?UTF-8?Q?sCode=22=3A500=2C=22error=22=3A=22=7B=5C?= =?UTF-8?Q?=22errorMessages=5C=22=3A=5B=5C=22mock_i?= =?UTF-8?Q?njected_500=5C=22=5D=7D=22=2C=22isAxiosE?= =?UTF-8?Q?rror=22=3Atrue=2C=22?=" | PASS |
| T11 | No active sprint on any board | status=no_active_sprint; no emails; no rows | HTTP 200; status=no_active_sprint; emails=0; rows=0 | PASS |
| T12 | Active sprint with zero issues | Digest still sent with health=Empty, 0% | Payments Sprint 4: Empty 0% sent; Mobile Sprint 9: Empty 0% sent | PASS |
| T13 | Crash recovery: stale pending claim (2h old) does not block today's digest | Stale claim ignored; digest sent | outcomes={"Payments Sprint 4":"sent","Mobile Sprint 9":"sent"} | PASS |
| T14 | In-flight protection: fresh pending claim (1 min old) from another run | Payments skip_in_flight; no duplicate email for it | outcomes={"Payments Sprint 4":"skip_in_flight","Mobile Sprint 9":"sent"}; Payments emails=0 | PASS |
| T15 | Day-over-day trend from yesterday's snapshot | Email shows "+9 pts vs <yesterday>" (29% today vs 20% yesterday) | found "+9 pts vs 2026-11-15" in email | PASS |
| T16 | No active recipients configured | skip_no_recipients; no emails, no claims | outcomes={"Payments Sprint 4":"skip_no_recipients","Mobile Sprint 9":"skip_no_recipients"}; emails=0; rows=0 | PASS |
| T17 | Webhook without the correct token | Rejected (HTTP 403), workflow not executed | HTTP 403; Jira calls=0 | PASS |

## Bug found by testing (and fixed)

The first version sent all digests through one Email node with *Retry On Fail*. When the SMTP server rejected
one email, n8n retried the **whole node**, so the digest that had already been delivered was sent again
(observed: Mobile digest delivered twice after a single rejection of the Payments digest).
Fix: a *Loop Over Items* node (batch size 1) in front of the Email node, so a retry only re-sends the one
email that failed. Regression test: **T18**.

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

## Live run checklist (still to do on a real Jira site)

- [ ] Jira Cloud site + Scrum project created, `scripts/seed-jira.js` run successfully
- [ ] n8n credentials created: Jira Software Cloud API, SMTP, Header Auth (webhook token)
- [ ] Recipients added to the `sprint_digest_recipients` Data Table
- [ ] Dry run (`{"dryRun": true}`) preview matches the seeded sprint
- [ ] Real digest received in the mailbox; same-day re-run skipped
- [ ] Error workflow alert received after pointing Config.jiraBaseUrl at a wrong host
- [ ] "In Progress > 3 days" verified after 3 real days (Jira can't backdate status changes), or with Config.staleInProgressDays = 0
