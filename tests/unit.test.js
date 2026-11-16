// Unit tests for the Code-node logic. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSprints, parseJiraDate, localDate } = require('../src/analyze.js');
const { decideClaims } = require('../src/claims.js');
const { scenario } = require('./fixtures.js');
const { DEFAULT_CONFIG } = require('../src/config.js');

const NOW = Date.parse('2026-11-16T04:00:00Z'); // 09:30 IST
const config = { ...DEFAULT_CONFIG, jiraBaseUrl: 'https://example.atlassian.net' };
const recips = [
  { email: 'team@example.com', role: 'digest', board_id: 0, active: true },
  { email: 'mobile@example.com', role: 'digest', board_id: 2, active: true },
  { email: 'old@example.com', role: 'digest', board_id: 0, active: false },
  { email: 'admin@example.com', role: 'admin', board_id: 0, active: true },
];

function run(opts = {}) {
  const s = scenario(NOW);
  const pages = [
    { sprint: { ...s.sprints[1][0] }, issues: s.issues[11].slice(0, 10) }, // page 1
    { sprint: { ...s.sprints[1][0] }, issues: s.issues[11].slice(10) },    // page 2
    { sprint: { ...s.sprints[2][0] }, issues: s.issues[21] },
  ];
  return analyzeSprints({ pages, config, history: opts.history || [], recipients: opts.recipients || recips,
    now: new Date(NOW), runId: 'r1', dryRun: opts.dryRun, force: opts.force });
}

test('parseJiraDate handles +0530 offsets', () => {
  assert.equal(parseJiraDate('2026-11-16T09:30:00.000+0530'), Date.parse('2026-11-16T04:00:00Z'));
  assert.equal(parseJiraDate(null), null);
});

test('localDate uses the configured timezone, not UTC', () => {
  const lateUtc = Date.parse('2026-11-15T20:00:00Z'); // 01:30 IST on the 16th
  assert.equal(localDate(lateUtc, 'Asia/Kolkata'), '2026-11-16');
  assert.equal(localDate(lateUtc, 'UTC'), '2026-11-15');
});

test('merges pages per sprint and categorises issues', () => {
  const [s1, s2] = run();
  const m = s1.metrics;
  assert.equal(m.total, 17);
  assert.deepEqual([m.todo, m.inProgress, m.done, m.blocked], [5, 4, 5, 3]);
  assert.equal(m.completionPct, 29);
  assert.equal(s2.metrics.total, 3);
});

test('blocked detection: status, flagged field, unresolved blocker link', () => {
  const [s1] = run();
  const reasons = Object.fromEntries(s1.lists.blocked.map((i) => [i.key, i.blockedReason]));
  assert.deepEqual(reasons, { 'SCRUM-6': 'status', 'SCRUM-10': 'flagged', 'SCRUM-11': 'blocked by SCRUM-4' });
});

test('in progress > 3 days uses statuscategorychangedate and excludes blocked', () => {
  const [s1] = run();
  assert.deepEqual(s1.lists.stale.map((i) => i.key), ['SCRUM-4', 'SCRUM-15']);
});

test('overdue excludes done issues; unassigned excludes done', () => {
  const [s1] = run();
  assert.deepEqual(s1.lists.overdue.map((i) => i.key).sort(), ['SCRUM-8', 'SCRUM-9']);
  assert.deepEqual(s1.lists.unassigned.map((i) => i.key), ['SCRUM-7', 'SCRUM-12']);
});

test('workload flags overloaded members at threshold', () => {
  const [s1] = run();
  assert.equal(s1.workload[0].name, 'Priya Raman');
  assert.equal(s1.workload[0].open, 6);
  assert.equal(s1.workload[0].overloaded, true);
  assert.equal(s1.metrics.overloaded, 1);
});

test('health: 3 blocked -> Critical; small healthy sprint -> Healthy', () => {
  const [s1, s2] = run();
  assert.equal(s1.health, 'Critical');
  assert.equal(s2.health, 'Healthy');
});

test('recipients: board filter, inactive and admin rows excluded', () => {
  const [s1, s2] = run();
  assert.deepEqual(s1.recipients, ['team@example.com']);
  assert.deepEqual(s2.recipients, ['team@example.com', 'mobile@example.com']);
});

test('dedupe: already sent today -> skip; stale pending -> send; fresh pending -> skip', () => {
  const today = '2026-11-16';
  const sent = [{ digest_key: `11:${today}`, status: 'sent', sprint_id: 11, run_date: today }];
  assert.equal(run({ history: sent })[0].action, 'skip_already_sent');
  assert.equal(run({ history: sent, force: true })[0].action, 'send');
  const fresh = [{ digest_key: `11:${today}`, status: 'pending', claimed_at: new Date(NOW - 60e3).toISOString() }];
  assert.equal(run({ history: fresh })[0].action, 'skip_in_flight');
  const stale = [{ digest_key: `11:${today}`, status: 'pending', claimed_at: new Date(NOW - 3600e3).toISOString() }];
  assert.equal(run({ history: stale })[0].action, 'send');
});

test('no recipients -> skip; dryRun -> preview', () => {
  assert.equal(run({ recipients: [] })[0].action, 'skip_no_recipients');
  assert.equal(run({ dryRun: true })[0].action, 'preview');
});

test('day-over-day delta uses the latest sent snapshot before today', () => {
  const history = [
    { digest_key: '11:2026-11-14', sprint_id: 11, status: 'sent', run_date: '2026-11-14', completion_pct: 10, done: 2, blocked: 1 },
    { digest_key: '11:2026-11-15', sprint_id: 11, status: 'sent', run_date: '2026-11-15', completion_pct: 24, done: 4, blocked: 2 },
    { digest_key: '11:2026-11-15b', sprint_id: 11, status: 'failed', run_date: '2026-11-15', completion_pct: 99 },
  ];
  const d = run({ history })[0].delta;
  assert.deepEqual(d, { since: '2026-11-15', completionPct: 5, done: 1, blocked: 1 });
});

test('empty sprint -> Empty health, 0%', () => {
  const [d] = analyzeSprints({ pages: [{ sprint: { id: 99, name: 'Empty', boardId: 1 }, issues: [] }],
    config, history: [], recipients: recips, now: new Date(NOW), runId: 'r' });
  assert.equal(d.health, 'Empty');
  assert.equal(d.metrics.completionPct, 0);
});

test('email escapes HTML and links issues', () => {
  const [s1] = run();
  assert.match(s1.subject, /^\[Sprint Health\] Payments Sprint 4 \| Critical \| 29% done \| 2026-11-16$/);
  assert.match(s1.html, /https:\/\/example\.atlassian\.net\/browse\/SCRUM-6/);
  const [d] = analyzeSprints({ pages: [{ sprint: { id: 5, name: '<script>x</script>', boardId: 1 }, issues: [] }],
    config, history: [], recipients: recips, now: new Date(NOW), runId: 'r' });
  assert.ok(!d.html.includes('<script>'));
});

test('claims: lowest live pending id wins, others lose', () => {
  const now = NOW;
  const at = new Date(now - 1000).toISOString();
  const rows = [
    { id: 7, digest_key: 'k', status: 'pending', claimed_at: at },
    { id: 8, digest_key: 'k', status: 'pending', claimed_at: at },
  ];
  const a = decideClaims({ myClaims: [{ id: 7, digest_key: 'k' }], rows, nowMs: now, staleClaimMinutes: 30 });
  const b = decideClaims({ myClaims: [{ id: 8, digest_key: 'k' }], rows, nowMs: now, staleClaimMinutes: 30 });
  assert.equal(a[0].won, true);
  assert.equal(b[0].won, false);
});

test('claims: sent row beats any pending; stale pending ignored', () => {
  const now = NOW;
  const sent = [{ id: 3, digest_key: 'k', status: 'sent' }, { id: 9, digest_key: 'k', status: 'pending', claimed_at: new Date(now).toISOString() }];
  assert.equal(decideClaims({ myClaims: [{ id: 9, digest_key: 'k' }], rows: sent, nowMs: now, staleClaimMinutes: 30 })[0].won, false);
  const stale = [{ id: 3, digest_key: 'k', status: 'pending', claimed_at: new Date(now - 7200e3).toISOString() },
    { id: 9, digest_key: 'k', status: 'pending', claimed_at: new Date(now).toISOString() }];
  assert.equal(decideClaims({ myClaims: [{ id: 9, digest_key: 'k' }], rows: stale, nowMs: now, staleClaimMinutes: 30 })[0].won, true);
  const failed = [{ id: 3, digest_key: 'k', status: 'failed' }, { id: 9, digest_key: 'k', status: 'pending', claimed_at: new Date(now).toISOString() }];
  assert.equal(decideClaims({ myClaims: [{ id: 9, digest_key: 'k' }], rows: failed, nowMs: now, staleClaimMinutes: 30 })[0].won, true);
});
