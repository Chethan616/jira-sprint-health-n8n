// Unit tests for the Code-node logic. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSprints, parseJiraDate, localDate } = require('../src/analyze.js');
const { decideClaims } = require('../src/claims.js');
const { validateConfig, canonicalTimeZone } = require('../src/validate.js');
const { retryAfterMs, backoffMs, initState, requestFor, evaluate, outputItems } = require('../src/jira-paging.js');
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
  assert.deepEqual(d, { since: '2026-11-15', completionPct: 5, done: 1, blocked: 1, pointsPct: null });
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

// ---------------------------------------------------------------- assignee identity
const issue = (key, cat, assignee, extra = {}) => ({ key, fields: {
  summary: key, status: { name: cat === 'done' ? 'Done' : 'To Do', statusCategory: { key: cat === 'done' ? 'done' : 'new' } },
  assignee, issuelinks: [], ...extra } });

test('workload groups by accountId: two people with the same display name stay separate', () => {
  const a = { accountId: '5b10ac8d82e05b22cc7d1111', displayName: 'Alex Kim' };
  const b = { accountId: '712020:aaaa-bbbb-2222', displayName: 'Alex Kim' };
  const issues = [1, 2, 3].map((n) => issue(`A-${n}`, 'todo', a)).concat([4, 5, 6].map((n) => issue(`A-${n}`, 'todo', b)));
  const [d] = analyzeSprints({ pages: [{ sprint: { id: 1, name: 'S', boardId: 1 }, issues }], config, history: [], recipients: recips, now: new Date(NOW), runId: 'r' });
  // grouped by display name this would be one "Alex Kim" with 6 open issues -> overloaded
  assert.equal(d.workload.length, 2);
  assert.deepEqual(d.workload.map((w) => [w.accountId, w.open, w.overloaded]).sort(),
    [['5b10ac8d82e05b22cc7d1111', 3, false], ['712020:aaaa-bbbb-2222', 3, false]]);
  // ambiguous names are disambiguated in the digest; unique names are left alone
  assert.deepEqual(d.workload.map((w) => w.name).sort(), ['Alex Kim (…1111)', 'Alex Kim (…2222)']);
  assert.match(d.text, /Alex Kim \(…1111\)/);
  const [s1] = run();
  assert.equal(s1.workload[0].name, 'Priya Raman');
  assert.equal(s1.workload[0].accountId, 'acc-priya');
});

// ---------------------------------------------------------------- multi-board sprints
test('sprint on several boards: recipients of every board get it once; origin-only routing is optional', () => {
  const s = scenario(NOW);
  const sprint = { ...s.sprints[1][0], boardId: 1, boards: [{ id: 1, name: 'SCRUM board' }, { id: 2, name: 'MOB board' }] };
  const people = [...recips, { email: 'team@example.com', role: 'digest', board_id: 2, active: true }];
  const args = { pages: [{ sprint, issues: s.issues[11] }], history: [], recipients: people, now: new Date(NOW), runId: 'r' };
  const [all] = analyzeSprints({ ...args, config });
  assert.deepEqual(all.recipients, ['team@example.com', 'mobile@example.com']);
  assert.deepEqual(all.board_ids, [1, 2]);
  assert.match(all.text, /Boards: SCRUM board, MOB board/);
  const [origin] = analyzeSprints({ ...args, config: { ...config, sprintBoardRouting: 'origin' } });
  assert.deepEqual(origin.recipients, ['team@example.com']);
  // a sprint without a boards list (single board) still routes by boardId
  const [single] = analyzeSprints({ ...args, pages: [{ sprint: { ...s.sprints[1][0] }, issues: [] }], config });
  assert.deepEqual(single.recipients, ['team@example.com']);
});

// ---------------------------------------------------------------- story-point progress
test('progress basis: both = lower of issue and story-point progress; issues/points on request', () => {
  const pts = (n) => ({ customfield_10016: n });
  // 2 of 4 issues done (50%) but only 2 of 20 points (10%), half the sprint elapsed
  const issues = [issue('P-1', 'done', null, pts(1)), issue('P-2', 'done', null, pts(1)), issue('P-3', 'todo', null, pts(9)), issue('P-4', 'todo', null, pts(9))];
  const sprint = { id: 7, name: 'Pts', boardId: 1, startDate: new Date(NOW - 5 * 864e5).toISOString(), endDate: new Date(NOW + 5 * 864e5).toISOString() };
  const go = (extra) => analyzeSprints({ pages: [{ sprint, issues }], config: { ...config, ...extra }, history: [], recipients: recips, now: new Date(NOW), runId: 'r' })[0];
  const both = go({});
  assert.equal(both.metrics.completionPct, 50);
  assert.equal(both.metrics.pointsPct, 10);
  assert.equal(both.metrics.progressPct, 10);
  assert.equal(both.metrics.progressBy, 'story points');
  assert.equal(both.health, 'Critical'); // 50% elapsed - 10% done = 40 behind
  assert.match(both.health_reasons.join(), /40% behind schedule \(by story points\)/);
  const byIssues = go({ progressBasis: 'issues' });
  assert.equal(byIssues.metrics.progressPct, 50);
  assert.equal(byIssues.health, 'Healthy'); // by issue count it is on schedule: the gap story points reveal
  assert.equal(go({ progressBasis: 'points' }).metrics.progressPct, 10);
});

test('story points ignored for health when too few issues are estimated', () => {
  const issues = [issue('Q-1', 'done', null, { customfield_10016: 13 }), issue('Q-2', 'todo', null), issue('Q-3', 'todo', null)];
  const [d] = analyzeSprints({ pages: [{ sprint: { id: 8, name: 'Q', boardId: 1 }, issues }], config, history: [], recipients: recips, now: new Date(NOW), runId: 'r' });
  assert.equal(d.metrics.pointsPct, 100);
  assert.equal(d.metrics.pointsCoveragePct, 33);
  assert.equal(d.metrics.pointsUsable, false);
  assert.equal(d.metrics.progressPct, 33);
  assert.match(d.text, /Not used for health/);
});

test('day-over-day delta includes story points when both snapshots have them', () => {
  const history = [{ digest_key: '11:2026-11-15', sprint_id: 11, status: 'sent', run_date: '2026-11-15', completion_pct: 20, done: 3, blocked: 1, points_total: 55, points_done: 8 }];
  const [s1] = run({ history });
  assert.equal(s1.metrics.pointsPct, 24);
  assert.equal(s1.delta.pointsPct, 24 - 15);
  assert.match(s1.text, /\+9 pts vs 2026-11-15 \(story points \+9 pts\)/);
});

// ---------------------------------------------------------------- config validation
const good = { ...DEFAULT_CONFIG, jiraBaseUrl: 'https://acme.atlassian.net', fromEmail: 'Digest <digest@acme.com>' };

test('validateConfig: valid config passes; shipped placeholders are rejected', () => {
  assert.deepEqual(validateConfig(good, { workflowTimezone: 'Asia/Kolkata' }), { errors: [], warnings: [] });
  const { errors } = validateConfig(DEFAULT_CONFIG);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => /placeholder/.test(e)));
});

test('validateConfig: catches bad thresholds, types, timezone, URL and API settings', () => {
  const bad = { ...good, jiraBaseUrl: 'acme.atlassian.net/jira', timezone: 'IST', overloadThreshold: 'five', staleInProgressDays: -1,
    atRiskBehindPct: 40, criticalBehindPct: 30, pageSize: 500, boardIds: ['x'], boardTypes: ['scrumm'], storyPointsField: 'story points',
    jiraMaxRetries: 50, fromEmail: 'nobody', progressBasis: 'velocity', sprintBoardRouting: 'some', maxListItems: 0 };
  const { errors } = validateConfig(bad);
  const has = (re) => assert.ok(errors.some((e) => re.test(e)), `missing ${re}: ${errors.join(' | ')}`);
  has(/jiraBaseUrl is not a valid URL/); has(/timezone is not a valid IANA/); has(/overloadThreshold must be a whole number/);
  has(/staleInProgressDays must be between 0/); has(/atRiskBehindPct \(40\) must not be greater/); has(/pageSize must be between 1 and 100/);
  has(/boardIds contains invalid/); has(/boardTypes has unknown/); has(/storyPointsField must be a Jira field id/);
  has(/jiraMaxRetries must be between 0 and 10/); has(/fromEmail must be an address/); has(/progressBasis must be/);
  has(/sprintBoardRouting must be/); has(/maxListItems must be between 1/);
  assert.ok(validateConfig({ ...good, jiraBaseUrl: 'https://acme.atlassian.net/jira' }).errors.some((e) => /site root only/.test(e)));
  assert.ok(validateConfig({ ...good, jiraBaseUrl: 'http://jira.internal' }).warnings.some((w) => /http:/.test(w)));
});

test('validateConfig: workflow timezone must match Config.timezone (aliases accepted)', () => {
  assert.deepEqual(validateConfig(good, { workflowTimezone: 'Asia/Calcutta' }).errors, []); // alias of Asia/Kolkata
  const { errors } = validateConfig(good, { workflowTimezone: 'America/New_York' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /workflow timezone is America\/New_York but Config.timezone is Asia\/Kolkata/);
  assert.ok(validateConfig(good, { workflowTimezone: '' }).warnings.some((w) => /could not read the workflow timezone/.test(w)));
  assert.equal(canonicalTimeZone('Not/AZone'), null);
});

// ---------------------------------------------------------------- Jira paging + rate limits
const jcfg = { jiraBaseUrl: 'https://acme.atlassian.net/', maxPages: 3, jiraMaxRetries: 3, jiraRetryBaseDelayMs: 1000, jiraRetryMaxDelayMs: 30000, jiraPageIntervalMs: 200 };
const ok = (body) => ({ statusCode: 200, headers: {}, body });
const httpErr = (statusCode, headers = {}) => ({ statusCode, headers, body: { errorMessages: ['nope'] } });

test('retryAfterMs: seconds, HTTP-date, X-RateLimit-Reset, absent', () => {
  const now = Date.parse('2026-11-16T04:00:00Z');
  assert.equal(retryAfterMs({ 'Retry-After': '7' }, now), 7000);
  assert.equal(retryAfterMs({ 'retry-after': 'Mon, 16 Nov 2026 04:00:05 GMT' }, now), 5000);
  assert.equal(retryAfterMs({ 'x-ratelimit-reset': '2026-11-16T04:00:03Z' }, now), 3000);
  assert.equal(retryAfterMs({}, now), null);
});

test('backoffMs: exponential with equal jitter, capped', () => {
  assert.equal(backoffMs(0, 1000, 30000, () => 0), 500);
  assert.equal(backoffMs(0, 1000, 30000, () => 1), 1000);
  assert.equal(backoffMs(3, 1000, 30000, () => 0), 4000);
  assert.equal(backoffMs(10, 1000, 30000, () => 1), 30000);
});

test('paging: startAt/isLast and nextPageToken, with page cap and repeated-token guard', () => {
  let st = initState({ path: '/rest/agile/1.0/board', query: { maxResults: 1 }, paging: 'startAt', cfg: jcfg });
  assert.equal(st.url, 'https://acme.atlassian.net/rest/agile/1.0/board');
  assert.deepEqual(requestFor(st).query, { maxResults: 1 });
  let r = evaluate(st, ok({ startAt: 0, maxResults: 1, isLast: false, values: [1] }));
  assert.equal(r.action, 'continue');
  assert.equal(r.waitMs, 200);
  assert.deepEqual(requestFor(r.state).query, { maxResults: 1, startAt: 1 });
  r = evaluate(r.state, ok({ startAt: 1, maxResults: 1, isLast: true, values: [2] }));
  assert.equal(r.action, 'done');
  assert.deepEqual(outputItems(r.state).map((p) => p.values[0]), [1, 2]);

  st = initState({ path: '/rest/api/3/search/jql', query: {}, paging: 'nextPageToken', cfg: jcfg, context: { sprintId: 11 } });
  r = evaluate(st, ok({ issues: [1], nextPageToken: 'A' }));
  assert.deepEqual(requestFor(r.state).query, { nextPageToken: 'A' });
  r = evaluate(r.state, ok({ issues: [2], nextPageToken: 'A' })); // same token again -> stop, don't loop
  assert.equal(r.action, 'done');
  assert.equal(outputItems(r.state)[0]._context.sprintId, 11);

  st = initState({ path: '/x', query: {}, paging: 'nextPageToken', cfg: jcfg });
  r = null;
  for (const t of ['A', 'B', 'C']) r = evaluate(r ? r.state : st, ok({ issues: [t], nextPageToken: t + '1' }));
  assert.equal(r.action, 'done');
  assert.equal(r.state.truncated, true);
  assert.equal(r.state.pages.length, 3);
});

test('rate limits: Retry-After honoured, backoff otherwise, 4xx not retried, retries exhausted', () => {
  const st = initState({ path: '/x', query: {}, paging: 'none', cfg: jcfg });
  let r = evaluate(st, httpErr(429, { 'retry-after': '2' }));
  assert.equal(r.action, 'continue');
  assert.equal(r.waitMs, 2000);
  assert.equal(r.state.lastRetry.source, 'retry-after');
  r = evaluate(r.state, httpErr(503), { random: () => 0 });
  assert.equal(r.waitMs, 1000); // attempt 1: (1000 * 2^1) / 2
  r = evaluate(r.state, { error: { message: 'ECONNRESET' } }, { random: () => 0 });
  assert.equal(r.waitMs, 2000); // attempt 2: (1000 * 2^2) / 2
  r = evaluate(r.state, httpErr(500));
  assert.equal(r.action, 'done');
  assert.match(r.state.error.message, /failed after 4 attempts: HTTP 500: nope/);
  assert.throws(() => outputItems(r.state), /failed after 4 attempts/);

  const notRetried = evaluate(st, httpErr(401));
  assert.equal(notRetried.action, 'done');
  assert.equal(notRetried.state.requests, 1);
  const soft = initState({ path: '/b/3/sprint', paging: 'startAt', cfg: jcfg, failOnError: false, context: { boardId: 3 } });
  const items = outputItems(evaluate(soft, httpErr(400)).state);
  assert.deepEqual([items[0].error.statusCode, items[0]._context.boardId], [400, 3]);

  const tooLong = evaluate(st, httpErr(429, { 'Retry-After': '120' }));
  assert.equal(tooLong.action, 'done');
  assert.match(tooLong.state.error.message, /retry after 120 s/);
  // a successful page resets the attempt counter
  const again = evaluate(evaluate(st, httpErr(502), { random: () => 0 }).state, ok({}));
  assert.equal(again.state.attempt, 0);
});
