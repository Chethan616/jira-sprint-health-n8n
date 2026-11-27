# To do

Follow [INSTRUCTIONS.md](INSTRUCTIONS.md).

1. **Install and get the repo (steps 1–2):** Node 22, Git and n8n, then clone the repo.
2. **Jira (steps 4–7):** create a free Jira Cloud site with a **Scrum** project and an API token. Run `node scripts/seed-jira.js`
   (creates the active sprint "Payments Sprint 4 (sample)" with 17 issues; note the board id), then `node scripts/live-check.js`
   until it says "All checks passed".
3. **Email (step 8):** create a Gmail app password.
4. **n8n (steps 9–13):** start n8n with `GENERIC_TIMEZONE` set, create the 3 credentials (Jira, SMTP, webhook token), import the
   3 workflows from `workflows/`, link the credentials, edit Config (`jiraBaseUrl`, `fromEmail`, `timezone`; `staleInProgressDays = 0`
   for a same-day demo), set the workflow timezone to the same zone, and add recipients to the `sprint_digest_recipients` Data Table.
5. **Run (step 14):**
   - Execute the workflow. Every node should turn green and the digest email should arrive (check spam).
   - Execute it again. It should show `skip_already_sent` and send no second email.
   - Work through the [live test checklist](INSTRUCTIONS.md#live-test-checklist) and record the results in `docs/test-results.md`.
