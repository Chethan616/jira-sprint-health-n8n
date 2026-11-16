// Shared sample data: used by the mock Jira server (tests) AND by
// scripts/seed-jira.js (to create the same scenario in a real Jira Cloud site).
// Dates are relative to "now" so the scenario stays valid on any day.

const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString().replace('Z', '+0000');
// due dates are calendar dates in the team's timezone (same TZ the workflow is configured with)
const TZ = process.env.FIXTURE_TZ || 'Asia/Kolkata';
const date = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

const PEOPLE = {
  priya: { accountId: 'acc-priya', displayName: 'Priya Raman' },
  arjun: { accountId: 'acc-arjun', displayName: 'Arjun Mehta' },
  neha: { accountId: 'acc-neha', displayName: 'Neha Kapoor' },
  rahul: { accountId: 'acc-rahul', displayName: 'Rahul Verma' },
};

const CAT = {
  todo: { key: 'new', name: 'To Do' },
  inprogress: { key: 'indeterminate', name: 'In Progress' },
  done: { key: 'done', name: 'Done' },
};

// spec: [key, summary, status, cat, assignee, inProgressDaysAgo, dueOffsetDays, points, extras]
const SPRINT_1 = [
  ['SCRUM-1', 'Set up CI pipeline for payments service', 'Done', 'done', 'priya', null, -3, 3],
  ['SCRUM-2', 'Login page accessibility fixes', 'Done', 'done', 'arjun', null, -1, 2],
  ['SCRUM-3', 'Refund API: partial refunds', 'Done', 'done', 'neha', null, 2, 5],
  ['SCRUM-4', 'Migrate session store to Redis', 'In Progress', 'inprogress', 'priya', 5, 1, 5],
  ['SCRUM-5', 'Payment webhook retries', 'In Progress', 'inprogress', 'priya', 1, 4, 3],
  ['SCRUM-6', 'Fraud rules engine integration', 'Blocked', 'inprogress', 'arjun', 4, 3, 8],
  ['SCRUM-7', 'Update API docs for v2 endpoints', 'To Do', 'todo', null, null, 5, 1],
  ['SCRUM-8', 'Invoice PDF generation', 'In Progress', 'inprogress', 'neha', 2, -2, 5],
  ['SCRUM-9', 'Audit log retention policy', 'To Do', 'todo', 'priya', null, -1, 2],
  ['SCRUM-10', 'Currency rounding bug in checkout', 'In Progress', 'inprogress', 'arjun', 6, 2, 3, { flagged: true }],
  ['SCRUM-11', 'Load test checkout flow', 'To Do', 'todo', 'priya', null, 6, 3, { blockedBy: 'SCRUM-4' }],
  ['SCRUM-12', 'Dashboard: failed payments widget', 'To Do', 'todo', null, null, 7, 2],
  ['SCRUM-13', 'Rotate API keys for staging', 'Done', 'done', 'rahul', null, -4, 1],
  ['SCRUM-14', 'Email receipts localisation', 'To Do', 'todo', 'priya', null, 8, 2],
  ['SCRUM-15', 'Settlement report export', 'In Progress', 'inprogress', 'rahul', 3.5, 5, 3],
  ['SCRUM-16', 'Remove legacy v1 checkout code', 'Done', 'done', 'neha', null, null, 2],
  ['SCRUM-17', 'Add 3DS challenge flow', 'To Do', 'todo', 'priya', null, 9, 5],
];

const SPRINT_2 = [
  ['MOB-1', 'Push notification opt-in screen', 'Done', 'done', 'rahul', null, -2, 3],
  ['MOB-2', 'Offline cart sync', 'In Progress', 'inprogress', 'rahul', 1, 3, 5],
  ['MOB-3', 'Crash on Android 15 camera permission', 'To Do', 'todo', 'neha', null, 4, 2],
];

function buildIssue(spec, nowMs, byKey) {
  const [key, summary, statusName, cat, who, ipDaysAgo, dueOffset, points, extra = {}] = spec;
  const createdMs = nowMs - 9 * DAY;
  const catChangeMs = ipDaysAgo != null ? nowMs - ipDaysAgo * DAY : (cat === 'done' ? nowMs - 1 * DAY : createdMs);
  const fields = {
    summary,
    status: { name: statusName, statusCategory: { key: CAT[cat].key, name: CAT[cat].name } },
    assignee: who ? { ...PEOPLE[who] } : null,
    duedate: dueOffset == null ? null : date(nowMs + dueOffset * DAY),
    priority: { name: ['SCRUM-6', 'SCRUM-10'].includes(key) ? 'High' : 'Medium' },
    issuetype: { name: 'Story' },
    created: iso(createdMs),
    updated: iso(catChangeMs),
    statuscategorychangedate: iso(catChangeMs),
    customfield_10016: points,
    customfield_10021: extra.flagged ? [{ id: '10019', value: 'Impediment' }] : null,
    issuelinks: [],
  };
  if (extra.blockedBy) {
    fields.issuelinks.push({
      type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
      inwardIssue: { key: extra.blockedBy, fields: { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } },
    });
  }
  return { id: String(10000 + Object.keys(byKey).length), key, fields };
}

function scenario(nowMs = Date.now()) {
  const byKey = {};
  const mk = (list) => list.map((s) => (byKey[s[0]] = buildIssue(s, nowMs, byKey)));
  return {
    boards: [
      { id: 1, name: 'SCRUM board', type: 'scrum' },
      { id: 2, name: 'MOB board', type: 'scrum' },
      { id: 3, name: 'Support kanban', type: 'kanban' },
    ],
    sprints: {
      1: [{ id: 11, name: 'Payments Sprint 4', state: 'active', boardId: 1, originBoardId: 1,
        goal: 'Ship partial refunds and harden checkout', startDate: iso(nowMs - 6 * DAY), endDate: iso(nowMs + 8 * DAY) }],
      2: [{ id: 21, name: 'Mobile Sprint 9', state: 'active', boardId: 2, originBoardId: 2,
        goal: 'Offline cart', startDate: iso(nowMs - 2 * DAY), endDate: iso(nowMs + 12 * DAY) }],
      3: [],
    },
    issues: { 11: mk(SPRINT_1), 21: mk(SPRINT_2) },
  };
}

module.exports = { scenario, SPRINT_1, SPRINT_2, PEOPLE };
