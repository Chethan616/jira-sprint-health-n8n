// Speaker notes for the Proposed Plan deck, one entry per slide, in order.
// build-deck.js --plan puts them into PowerPoint's speaker notes and writes
// deck/Proposed-Plan-Speaker-Notes.md from the same text.
module.exports = [
  {
    title: 'Jira Sprint Health Monitor & Daily Digest',
    time: '0:30',
    say: [
      'This is our plan for automation assignment 2, use case 2: the Jira Sprint Health Monitor and Daily Digest.',
      'In one line: every morning n8n reads each active Jira sprint and emails the team one digest with progress, blockers and workload.',
      'We\'ll go through what we\'re building, how it works, how it stays reliable, how we\'ll test it, and the roadmap.',
    ],
  },
  {
    title: 'Sprint problems surface at stand-up, not before',
    time: '1:00',
    say: [
      'Today sprint health only lives on the board. Nobody is told when something goes wrong.',
      'Point 1: a blocked or flagged issue only gets attention when someone happens to open the board.',
      'Point 2: tickets sit "In Progress" for days and due dates slip by with no signal.',
      'Point 3: nobody notices one person holding six open issues while others have one.',
      'The assignment asks for an automated daily summary of progress, blockers and workload, by email.',
    ],
  },
  {
    title: 'Proposed solution',
    time: '1:00',
    say: [
      'One scheduled n8n workflow, weekdays at 09:00 IST, one digest per sprint per day.',
      'Three stages. FETCH: pull boards, active sprints and every issue from Jira\'s REST APIs. ANALYZE: apply the rules and build the summary. NOTIFY: email it and record that it was sent.',
      'It can also be run manually, or through a protected webhook with a dry-run preview.',
      'Key promise: exactly one digest per sprint per day, even if two runs overlap or something fails halfway.',
    ],
    ask: [
      'Why weekdays only? Sprints don\'t move at weekends. Switching to every day is one setting.',
    ],
  },
  {
    title: 'All eight steps of the brief, mapped to nodes',
    time: '1:30',
    say: [
      'This maps each of the eight steps in Mukund\'s brief to the part of the workflow that does it.',
      'Steps 1 and 2 are the Jira calls. Steps 3 to 7 all happen in one analysis node. Step 8 is the email.',
      'Footer line: we follow the common requirements too. No credentials in the workflow, sample data only, documentation, testing, clean exports.',
    ],
  },
  {
    title: 'Proposed architecture',
    time: '1:30',
    say: [
      'Read left to right. The trigger starts Config, which loads settings and our two Data Tables.',
      'Then two Jira calls (dark boxes are external systems): boards and sprints from the Agile API, issues from REST v3 search.',
      'Analyze builds the digest. Then the orange diamond: did this run win the right to send today\'s digest? Yes means email, then record the result. No means skip.',
      'Dashed lines: reading saved history and recipients, and the error path. Any failure triggers a separate Error Workflow that emails the admins.',
    ],
  },
  {
    title: 'Twelve stages, one daily cycle',
    time: '1:30',
    say: [
      'The same flow at node level, grouped into twelve stages (about thirty nodes in total).',
      'Blue is talking to Jira or setup, orange is state and decisions, teal is analysis and sending.',
      'Worth calling out: stage 7 handles "no active sprint" cleanly; stage 10 is the claim step that prevents duplicates; stage 11 sends one email at a time.',
      'All the logic in Code nodes lives in separate JS files with unit tests, then gets packed into the workflow.',
    ],
  },
  {
    title: 'Three calls per run',
    time: '1:30',
    say: [
      'Only three kinds of Jira call. Boards, active sprints per board, and the issues in each sprint.',
      'Auth uses n8n\'s built-in Jira credential: email plus API token. The token never appears in the workflow.',
      'Watch-outs from the table: team-managed boards report type "simple", not "scrum", so we keep both. A sprint can show on two boards, so we de-duplicate. Search returns only ids unless we ask for fields.',
      'Every call retries 3 times, 3 seconds apart, which covers rate limits (429) and temporary errors.',
    ],
    ask: [
      'Why not the built-in Jira node? It has no board or sprint operations and no control over paging.',
    ],
  },
  {
    title: 'No 200-record ceiling this time',
    time: '1:30',
    say: [
      'Direct response to last review: our ServiceNow monitor stopped at 200 records.',
      'Two paging styles. The Agile API pages by offset (startAt) until isLast. The new search API uses a cursor (nextPageToken) until there\'s no token.',
      'Both use n8n\'s built-in HTTP pagination, so no custom loops.',
      'Guards: a page cap, a short gap between pages, and n8n stops if the same page repeats. That matters because people have reported the new search API repeating tokens.',
    ],
  },
  {
    title: 'Four buckets, four flags',
    time: '1:30',
    say: [
      'The business rules. Buckets use Jira\'s status category, so they work with any custom status names.',
      'Blocked is three checks: a "Blocked" status, the Flagged field, or an open "is blocked by" link. Default Jira has no Blocked status, which is why.',
      '"In Progress more than 3 days" uses the time the issue entered In Progress, not "last updated". A comment would reset "updated".',
      'Overdue compares the due date with today in our timezone, IST. Overloaded is 5 or more open issues.',
      'Every threshold lives in one Config node.',
    ],
  },
  {
    title: 'Completion is judged against the calendar',
    time: '1:00',
    say: [
      '29% done is fine on day 2 and bad on day 13, so we compare completion with how much of the sprint has passed.',
      'Critical: 3 or more blocked, or 30+ points behind the calendar. At Risk: anything blocked, overdue or overloaded, or 15+ behind. Otherwise Healthy. Empty if the sprint has no issues.',
      'Right box: each digest is saved as a daily snapshot, so tomorrow\'s email shows the change, like "+5 points vs yesterday".',
    ],
  },
  {
    title: 'Sample sprint: what the rules will flag',
    time: '1:00',
    say: [
      'A sample sprint we designed to hit every rule: 17 issues.',
      'Result: 29% done with 43% of the sprint gone, 3 blocked, 2 stale, 2 overdue, 2 unassigned, so it rates Critical.',
      'Right chart: Priya has 6 open issues, over the threshold of 5, so she\'s flagged as overloaded.',
      'We\'ll seed this same sprint into our Jira site for the demo.',
    ],
  },
  {
    title: 'What the team will receive at 09:00',
    time: '1:30',
    say: [
      'This is the digest format.',
      '1: the subject line alone tells you sprint, health and completion, so you can triage from the inbox.',
      '2: numbers first. Completion, time elapsed, days left, change since yesterday.',
      '3: every issue links straight to Jira, grouped by Blocked, stale, overdue and unassigned, with owner and reason.',
      '4 and 5: the workload table, and both HTML and plain-text versions. The run id in the footer lets us trace any email back to its run.',
    ],
  },
  {
    title: 'What we will change since the ServiceNow review',
    time: '1:30',
    say: [
      'The feedback from 10 Nov, and what we\'re doing about each point.',
      'Database instead of static data: two n8n Data Tables. Concurrency and failure testing: a full test matrix, coming up later. Pagination: covered earlier.',
      'The last three were feedback to the other pair, but they apply to us too: no hard-coded emails (recipients live in a table), proper timezones, and duplicate prevention that survives a failed step.',
    ],
  },
  {
    title: 'Why n8n Data Tables (and where Postgres would win)',
    time: '1:30',
    say: [
      'The reviewer asked us to evaluate a database. We compared three options.',
      'Static data, what we used before, only saves on production runs and can\'t be viewed. Data Tables save on every run, show up in the n8n UI, and need no extra server.',
      'The one gap, in orange: Data Tables can\'t enforce a unique column. That\'s why the claim protocol on the next slide exists.',
      'Bottom: two tables. sprint_health_runs holds claims plus the daily snapshot. sprint_digest_recipients holds who gets the email, so changing recipients needs no workflow edit.',
    ],
    ask: [
      'When would Postgres be better? If n8n runs with several workers. A unique index would then do the dedupe for us.',
    ],
  },
  {
    title: 'Insert a claim, read it back, lowest id wins',
    time: '2:00',
    say: [
      'The problem: if two runs overlap, for example a manual run during the 9 am schedule, both can see "not sent yet" and both send. Without a unique constraint, check-then-insert can race.',
      'Our approach, the four pills: every run inserts its own "pending" claim, reads back all claims for that sprint and day, and the lowest id wins. Only the winner sends, then records sent or failed.',
      'Why it\'s safe: the database hands out ids in order, so every run sees the same order and reaches the same answer.',
      'Self-healing: a claim stuck pending for 30 minutes (a crashed run) is ignored. A failed email gets retried next run. A manual "force" can resend.',
    ],
    ask: [
      'Can it ever send twice? Only if n8n crashes in the split second after the email is accepted and before it records "sent". We chose possible-duplicate over a silently missed digest.',
    ],
  },
  {
    title: 'One email per pass, so a retry never repeats a sent digest',
    time: '1:00',
    say: [
      'A subtle n8n detail. "Retry On Fail" repeats the whole node, not just the failed item.',
      'Left: with two digests in one Email node, if Payments is rejected, the retry also re-sends Mobile, which already went out.',
      'Right: we\'ll send through a Loop with one email per pass, so a retry only ever re-sends the one that failed.',
      'Our mail-server mock can reject a chosen email, so this exact case is in the test plan.',
    ],
  },
  {
    title: 'Every failure will have a defined outcome',
    time: '1:30',
    say: [
      'Our error-handling plan, row by row. The theme: nothing fails silently, and one failure doesn\'t take down the rest.',
      'Temporary Jira errors retry. A real outage or bad credentials fails the run and emails the admins.',
      'A team-managed Kanban board answers the sprint call with an error. We skip it and carry on with the other boards.',
      'No active sprint is a clean "nothing to do". An empty sprint still gets a digest marked Empty.',
      'If one email fails, only that one is retried, and only that one gets re-sent on the next run.',
    ],
  },
  {
    title: 'Real n8n, fake Jira, fake mailbox',
    time: '1:00',
    say: [
      'How we\'ll test. A real n8n server, driven by a test script through the webhook.',
      'Instead of real Jira and email: a mock Jira that returns tiny pages (to force paging) and a mock mail server that can accept or reject on demand.',
      'The script also tells the mocks to fail on purpose: 500s, rate limits, outages, empty sprints, rejected emails.',
      'Same workflow build as we ship, isolated n8n data, fake credentials. After that, we repeat the key cases live on our Jira site.',
    ],
  },
  {
    title: '21 end-to-end scenarios, grouped by risk',
    time: '1:30',
    say: [
      'The test plan, grouped by risk.',
      'Core flow: the happy path, same-day re-run skipped, forced resend, dry run, trend vs yesterday.',
      'Concurrency and recovery: five runs at once must give exactly one email per sprint, crash recovery, in-flight protection, and only the failed email retried.',
      'Jira failures and edge cases: 500s, rate limits, outage, team-managed boards, no boards, no sprint, empty sprint. Delivery and access: rejected email, no recipients, wrong webhook token.',
      'Plus 16 unit checks on the rules, timezones and claim logic. Each scenario records expected vs actual.',
    ],
  },
  {
    title: 'Four phases from setup to demo',
    time: '1:30',
    say: [
      'Phase 1, environment: Jira Cloud site and Scrum project, the three credentials, seed the sample sprint, confirm the API calls work.',
      'Phase 2, build: fetching, rules, the digest email, the recipients table.',
      'Phase 3, reliability: claim protocol, per-email retries, the error workflow, daily snapshots.',
      'Phase 4, test and hand-in: run the test matrix, a live run on the Jira site, docs and clean exports, and the short demo video.',
      'Possible extensions afterwards: personal nudges per assignee, Teams or Slack delivery, an end-of-sprint report.',
    ],
  },
  {
    title: 'What we will hand in',
    time: '1:00',
    say: [
      'The deliverables, all in one repository.',
      'The two importable workflows (no secrets) and a setup guide. The logic as separate tested files, plus a build script.',
      'A seed script that creates the sample sprint in Jira. The test kit: mock Jira, mock mail server, scenario runner.',
      'Docs: architecture, data model, error handling, and test results with expected vs actual.',
      'Close: happy to take questions.',
    ],
  },
];
