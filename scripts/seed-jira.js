// Seeds a real Jira Cloud Scrum project with the same sample sprint the tests use
// (tests/fixtures.js): an active sprint with To Do / In Progress / Done / Blocked
// issues, overdue and unassigned issues, a flagged issue and an "is blocked by" link.
//
// Usage (PowerShell):
//   $env:JIRA_BASE_URL="https://your-team.atlassian.net"; $env:JIRA_EMAIL="you@example.com"
//   $env:JIRA_API_TOKEN="<token>"; $env:JIRA_PROJECT_KEY="SCRUM"
//   node scripts/seed-jira.js
// Optional: JIRA_ASSIGNEES="accountId1,accountId2" (otherwise everything assigned is assigned to you)
//
// Limits of seeding (Jira sets these server-side, they can't be backdated):
//   * statuscategorychangedate = now, so "In Progress > 3 days" only appears after
//     3 real days. For a same-day demo set Config.staleInProgressDays to 0.
//   * A "Blocked" status doesn't exist in default workflows; the seeder uses the
//     Flagged field instead when no "Blocked" transition is available.
//
// NOTE: written against the Jira Cloud REST v3 + Agile 1.0 docs; it has NOT been run
// against a live site yet (none was available when this was written).
const { SPRINT_1 } = require('../tests/fixtures.js');

const BASE = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_API_TOKEN;
const PROJECT = process.env.JIRA_PROJECT_KEY;
if (!BASE || !EMAIL || !TOKEN || !PROJECT) {
  console.error('Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const DAY = 864e5;

async function jira(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function transitionTo(key, statusName) {
  const { transitions } = await jira('GET', `/rest/api/3/issue/${key}/transitions`);
  const t = transitions.find((x) => x.to && x.to.name.toLowerCase() === statusName.toLowerCase())
    || transitions.find((x) => x.name.toLowerCase() === statusName.toLowerCase());
  if (!t) return false;
  await jira('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
  return true;
}

(async () => {
  const me = await jira('GET', '/rest/api/3/myself');
  console.log(`Connected as ${me.displayName}`);
  const assignees = (process.env.JIRA_ASSIGNEES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const pickAssignee = (who, i) => (who ? (assignees.length ? assignees[i % assignees.length] : me.accountId) : null);

  // company-managed Scrum boards are type "scrum", team-managed ones are "simple"
  const boards = await jira('GET', `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(PROJECT)}`);
  const board = boards.values.find((b) => b.type === 'scrum') || boards.values.find((b) => b.type === 'simple');
  if (!board) throw new Error(`No Scrum board for project ${PROJECT}. Create a Scrum project first (team-managed is fine; enable Sprints).`);
  console.log(`Board ${board.id} (${board.name})`);

  const now = Date.now();
  const sprint = await jira('POST', '/rest/agile/1.0/sprint', {
    name: 'Payments Sprint 4 (sample)', originBoardId: board.id, goal: 'Ship partial refunds and harden checkout',
    startDate: new Date(now - 6 * DAY).toISOString(), endDate: new Date(now + 8 * DAY).toISOString(),
  });
  console.log(`Created sprint ${sprint.id}`);

  const created = {}; // fixture key -> real key
  for (const [i, spec] of SPRINT_1.entries()) {
    const [fkey, summary, statusName, , who, , dueOffset, , extra = {}] = spec;
    const fields = {
      project: { key: PROJECT }, summary, issuetype: { name: 'Task' },
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Sample issue (${fkey}) for the n8n sprint health demo.` }] }] },
    };
    if (dueOffset != null) fields.duedate = new Date(now + dueOffset * DAY).toISOString().slice(0, 10);
    const acc = pickAssignee(who, i);
    if (acc) fields.assignee = { accountId: acc };
    const issue = await jira('POST', '/rest/api/3/issue', { fields });
    created[fkey] = issue.key;
    if (statusName !== 'To Do') {
      const ok = await transitionTo(issue.key, statusName);
      if (!ok && statusName === 'Blocked') {
        await transitionTo(issue.key, 'In Progress');
        await jira('PUT', `/rest/api/3/issue/${issue.key}`, { fields: { customfield_10021: [{ value: 'Impediment' }] } })
          .catch((e) => console.warn(`  could not flag ${issue.key}: ${e.message}`));
        console.log(`  ${issue.key}: no "Blocked" status, flagged instead`);
      } else if (!ok) console.warn(`  ${issue.key}: no transition to "${statusName}"`);
    }
    if (extra.flagged) {
      await jira('PUT', `/rest/api/3/issue/${issue.key}`, { fields: { customfield_10021: [{ value: 'Impediment' }] } })
        .catch((e) => console.warn(`  could not flag ${issue.key}: ${e.message}`));
    }
    console.log(`  ${issue.key}  ${statusName.padEnd(11)} ${summary}`);
  }

  await jira('POST', `/rest/agile/1.0/sprint/${sprint.id}/issue`, { issues: Object.values(created) });
  await jira('POST', `/rest/agile/1.0/sprint/${sprint.id}`, { state: 'active' });
  console.log(`Sprint ${sprint.id} started`);

  // "is blocked by" link. Jira's create-link direction is easy to get backwards, so
  // create it, read the blocked issue back, and swap if it landed the wrong way round.
  for (const spec of SPRINT_1.filter((s) => s[8] && s[8].blockedBy)) {
    const blocked = created[spec[0]];
    const blocker = created[spec[8].blockedBy];
    const sees = async () => ((await jira('GET', `/rest/api/3/issue/${blocked}?fields=issuelinks`)).fields.issuelinks || [])
      .some((l) => l.type.inward === 'is blocked by' && l.inwardIssue && l.inwardIssue.key === blocker);
    await jira('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: blocked }, outwardIssue: { key: blocker } });
    if (!(await sees())) {
      const links = (await jira('GET', `/rest/api/3/issue/${blocked}?fields=issuelinks`)).fields.issuelinks;
      for (const l of links) await jira('DELETE', `/rest/api/3/issueLink/${l.id}`);
      await jira('POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: blocker }, outwardIssue: { key: blocked } });
    }
    console.log(`  ${blocked} is blocked by ${blocker}: ${(await sees()) ? 'ok' : 'CHECK MANUALLY'}`);
  }
  console.log('\nDone. Set Config.jiraBaseUrl and (optionally) Config.boardIds = [' + board.id + '] in the workflow.');
})().catch((e) => { console.error(e.message); process.exit(1); });
