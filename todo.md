# To do

Follow `jira_ins.txt` (Parts 1, 2 and 4–14).

1. **Install and get the repo (Parts 1–2):** Node 22, Git, GitHub CLI and n8n, then clone the repo.
2. **Jira (Parts 4–6):** create a free Jira Cloud site with a **Scrum** project and an API token. Run `node scripts/seed-jira.js` with the 4 env vars from Part 6. It creates the active sprint "Payments Sprint 4 (sample)" with 17 issues. Note the board id it prints.
3. **Email (Part 7):** create a Gmail app password.
4. **n8n (Parts 8–12):** start n8n and create the 3 credentials (Jira, SMTP, webhook token). Import both workflows from `workflows/`, link the credentials, and set `jiraBaseUrl` in the Config node. Set `staleInProgressDays = 0` so the "In Progress > 3 days" flag shows the same day. Add recipients to the `sprint_digest_recipients` Data Table.
5. **Run (Part 13):**
   - Execute the workflow. Every node should turn green and the digest email should arrive (check spam).
   - Execute it again. It should show `skip_already_sent` and send no second email.
   - Optional: set `jiraBaseUrl` to a wrong URL, publish, trigger it, and check that the admin error email arrives. Restore the correct URL afterwards.

