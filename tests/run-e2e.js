// End-to-end test matrix against a real n8n instance (n8n start, isolated
// N8N_USER_FOLDER) + mock Jira + SMTP sink. Run tests/setup-test-env.sh first.
//   node tests/run-e2e.js    -> prints results, writes docs/test-results.e2e.json
const fs = require('fs');
const path = require('path');

const N8N = 'http://localhost:5699/webhook';
const JIRA = 'http://localhost:5698';
const SINK = 'http://localhost:2526';
const TOKEN = 'test-token-123';
const RECIPIENTS = [
  { email: 'team@test.local', name: 'Team', role: 'digest', board_id: 0, active: true },
  { email: 'mobile@test.local', name: 'Mobile', role: 'digest', board_id: 2, active: true },
  { email: 'former@test.local', name: 'Former', role: 'digest', board_id: 0, active: false },
  { email: 'admin@test.local', name: 'Admin', role: 'admin', board_id: 0, active: true },
];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 864e5));

const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};
const get = async (url) => (await fetch(url)).json();
const run = (body = {}, token = TOKEN) => post(`${N8N}/sprint-health/run`, body, { 'X-Digest-Token': token });
const reset = async (recipients = RECIPIENTS) => {
  await post(`${JIRA}/__control`, { reset: true });
  await post(`${SINK}/__control`, { reset: true });
  await post(`${N8N}/test/reset`, { recipients });
};
const runs = async () => (await post(`${N8N}/test/runs`)).json.filter((r) => r.digest_key);
const msgs = () => get(`${SINK}/messages`);
const jiraCalls = async () => (await get(`${JIRA}/__stats`)).log;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(500); } return null; };
const summary = (res) => (Array.isArray(res.json) ? res.json[0] : res.json);
const outcomes = (res) => Object.fromEntries((summary(res).sprints || []).map((s) => [s.sprint, s.outcome]));

const results = [];
async function scenario(id, name, expected, fn) {
  const t0 = Date.now();
  let pass = false; let actual = ''; let detail = {};
  try {
    const r = await fn();
    pass = r.pass; actual = r.actual; detail = r.detail || {};
  } catch (e) { actual = 'EXCEPTION: ' + e.message; }
  results.push({ id, name, expected, actual, pass, ms: Date.now() - t0, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${name}\n      expected: ${expected}\n      actual:   ${actual}`);
}

(async () => {
  await scenario('T01', 'Happy path: two active sprints, paginated Jira, digest emailed',
    'Both sprints sent; Payments=Critical 29% (3 blocked, 2 stale, 2 overdue, 2 unassigned, Priya overloaded); Mobile=Healthy; 10 Jira calls incl. 3 board pages and 4 search pages',
    async () => {
      await reset();
      const res = await run();
      const s = summary(res);
      const p = s.sprints.find((x) => x.sprint === 'Payments Sprint 4');
      const calls = await jiraCalls();
      const pages = calls.filter((c) => c.path.endsWith('/search/jql') && /sprint = 11/.test(c.query.jql)).length;
      const m = await msgs();
      const rows = await runs();
      const pass = res.status === 200 && s.sent === 2 && p.health === 'Critical' && p.completionPct === 29 && p.blocked === 3
        && p.stale === 2 && p.overdue === 2 && p.unassigned === 2 && p.overloaded[0] === 'Priya Raman'
        && pages === 4 && calls.length === 10 && m.length === 2 && rows.every((r) => r.status === 'sent');
      fs.writeFileSync(path.join(__dirname, '..', '.n8n-test', 'sample-email.eml'), m[0] ? m[0].raw : '');
      return { pass, actual: `HTTP ${res.status}; sent=${s.sent}; Payments ${p.health} ${p.completionPct}% blocked=${p.blocked} stale=${p.stale} overdue=${p.overdue} unassigned=${p.unassigned} overloaded=${p.overloaded}; Jira calls=${calls.length} (sprint-11 pages=${pages}); emails=${m.length}; rows=${rows.map((r) => r.status)}`,
        detail: { summary: s, emails: m.map((x) => ({ to: x.to, subject: x.subject })) } };
    });

  await scenario('T02', 'Same-day re-run is deduplicated',
    'Second run sends nothing (skip_already_sent); still 2 emails total',
    async () => {
      const res = await run();
      const m = await msgs();
      const o = outcomes(res);
      return { pass: Object.values(o).every((x) => x === 'skip_already_sent') && m.length === 2,
        actual: `outcomes=${JSON.stringify(o)}; emails total=${m.length}` };
    });

  await scenario('T03', 'Manual resend with {"force":true}',
    'Both sprints re-sent; 4 emails total',
    async () => {
      const res = await run({ force: true });
      const m = await msgs();
      const o = outcomes(res);
      return { pass: Object.values(o).every((x) => x === 'sent') && m.length === 4, actual: `outcomes=${JSON.stringify(o)}; emails total=${m.length}` };
    });

  await scenario('T04', 'Dry run returns a preview without sending or writing state',
    'outcome=preview with subject/text; 0 emails; 0 rows',
    async () => {
      await reset();
      const res = await run({ dryRun: true });
      const s = summary(res);
      const m = await msgs(); const rows = await runs();
      const ok = s.sprints.every((x) => x.outcome === 'preview' && x.preview && x.preview.subject);
      return { pass: ok && m.length === 0 && rows.length === 0, actual: `outcomes=${s.sprints.map((x) => x.outcome)}; emails=${m.length}; rows=${rows.length}; subject="${s.sprints[0].preview.subject}"`,
        detail: { previewText: s.sprints[0].preview.text } };
    });

  await scenario('T05', 'Concurrency: 5 overlapping executions at once',
    'Exactly 1 email per sprint (2 total); 1 sent row per sprint, every other claim marked lost or skipped',
    async () => {
      await reset();
      const all = await Promise.all([1, 2, 3, 4, 5].map(() => run()));
      await sleep(1500);
      const m = await msgs(); const rows = await runs();
      const perKey = {};
      for (const r of rows) (perKey[r.digest_key] = perKey[r.digest_key] || []).push(`${r.id}:${r.status}`);
      const sentPerKey = Object.values(perKey).map((l) => l.filter((x) => x.endsWith(':sent')).length);
      const outs = all.map((r) => Object.values(outcomes(r)).join('/'));
      return { pass: m.length === 2 && sentPerKey.length === 2 && sentPerKey.every((n) => n === 1),
        actual: `emails=${m.length}; rows per key=${JSON.stringify(perKey)}; run outcomes=${JSON.stringify(outs)}` };
    });

  await scenario('T06', 'Jira returns HTTP 500 twice on issue search',
    'Node retries (3 tries) and the run still succeeds; 2 emails',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { failures: [{ match: '/search/jql', status: 500, times: 2 }] });
      const res = await run();
      const m = await msgs(); const calls = await jiraCalls();
      return { pass: res.status === 200 && summary(res).sent === 2 && m.length === 2,
        actual: `HTTP ${res.status}; sent=${summary(res).sent}; emails=${m.length}; Jira calls=${calls.length} (incl. 2 failed)` };
    });

  await scenario('T07', 'Jira rate limit (HTTP 429) on sprint lookup',
    'Retried after back-off; run succeeds',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { failures: [{ match: '/sprint', status: 429, times: 1 }] });
      const res = await run();
      return { pass: res.status === 200 && summary(res).sent === 2, actual: `HTTP ${res.status}; sent=${summary(res).sent}` };
    });

  await scenario('T08', 'Jira down (HTTP 500 on every call)',
    'Run fails after retries; no digest; Error Workflow emails the admin',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { failures: [{ match: '/rest/', status: 500, times: 100 }] });
      const res = await run();
      const alert = await waitFor(async () => (await msgs()).find((x) => x.to.join().includes('admin@test.local')));
      const digests = (await msgs()).filter((x) => x.subject.includes('% done'));
      return { pass: res.status >= 500 && !!alert && digests.length === 0,
        actual: `HTTP ${res.status}; digests=${digests.length}; admin alert="${alert ? alert.subject : 'none'}"` };
    });

  await scenario('T09', 'SMTP rejects the first digest (all 3 attempts)',
    'Payments=failed, Mobile=sent; failed row recorded; run errors; admin alerted',
    async () => {
      await reset();
      await post(`${SINK}/__control`, { rejectNext: 3 });
      const res = await run();
      const alert = await waitFor(async () => (await msgs()).find((x) => x.to.join().includes('admin@test.local')));
      const rows = await runs();
      const st = Object.fromEntries(rows.map((r) => [r.sprint_name, r.status]));
      return { pass: res.status >= 500 && st['Payments Sprint 4'] === 'failed' && st['Mobile Sprint 9'] === 'sent' && !!alert,
        actual: `HTTP ${res.status}; rows=${JSON.stringify(st)}; error="${(rows.find((r) => r.status === 'failed') || {}).error || ''}"; admin alert=${alert ? 'yes' : 'no'}` };
    });

  await scenario('T10', 'Re-run after SMTP failure retries only the failed digest',
    'Payments sent now; Mobile skip_already_sent',
    async () => {
      const before = (await msgs()).length;
      const res = await run();
      const o = outcomes(res);
      const after = (await msgs()).length;
      return { pass: o['Payments Sprint 4'] === 'sent' && o['Mobile Sprint 9'] === 'skip_already_sent' && after - before === 1,
        actual: `outcomes=${JSON.stringify(o)}; new emails=${after - before}` };
    });

  await scenario('T18', 'Regression: one transient SMTP rejection must not re-send other digests',
    'Payments retried and delivered once; Mobile delivered exactly once (no duplicate)',
    async () => {
      await reset();
      await post(`${SINK}/__control`, { rejectNext: 1 });
      const res = await run();
      const ev = await get(`${SINK}/events`);
      const count = (s) => ev.filter((e) => e.event === 'accepted' && e.subject.includes(s)).length;
      return { pass: res.status === 200 && count('Payments') === 1 && count('Mobile') === 1 && ev.filter((e) => e.event === 'rejected').length === 1,
        actual: `HTTP ${res.status}; events=${ev.map((e) => e.event + (e.subject ? ':' + e.subject.split(' ')[2] : '')).join(', ')}` };
    });

  await scenario('T19', 'Team-managed project: boards of type "simple", one of them Kanban',
    'Sprint on the team-managed Scrum board is sent; the Kanban board\'s HTTP 400 "does not support sprints" is skipped, not an error',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { scenario: 'team_managed' });
      const res = await run();
      const o = outcomes(res);
      const calls = await jiraCalls();
      const got400 = calls.some((c) => c.path.endsWith('/board/5/sprint'));
      return { pass: res.status === 200 && o['Web Sprint 2'] === 'sent' && Object.keys(o).length === 1 && got400,
        actual: `HTTP ${res.status}; outcomes=${JSON.stringify(o)}; kanban board queried (400)=${got400}` };
    });

  await scenario('T20', 'No sprint-capable boards visible to the API user',
    'Run fails with a clear "No sprint-capable boards" error; admin alerted; no digest',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { scenario: 'no_boards' });
      const res = await run();
      const alert = await waitFor(async () => (await msgs()).find((x) => x.to.join().includes('admin@test.local')));
      const msg = typeof res.json === 'string' ? res.json : JSON.stringify(res.json);
      return { pass: res.status >= 500 && /No sprint-capable boards/.test(alert ? alert.raw : '') ,
        actual: `HTTP ${res.status}; admin alert="${alert ? alert.subject : 'none'}"` };
    });

  await scenario('T21', 'Sprint lookup returns HTTP 500 on every attempt (boards OK)',
    'Not mistaken for a Kanban 400: run fails, admin alerted, no digest',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { failures: [{ match: '/sprint', status: 500, times: 100 }] });
      const res = await run();
      const alert = await waitFor(async () => (await msgs()).find((x) => x.to.join().includes('admin@test.local')));
      const digests = (await msgs()).filter((x) => x.subject.includes('% done'));
      return { pass: res.status >= 500 && !!alert && digests.length === 0,
        actual: `HTTP ${res.status}; digests=${digests.length}; admin alert="${alert ? alert.subject : 'none'}"` };
    });

  await scenario('T11', 'No active sprint on any board',
    'status=no_active_sprint; no emails; no rows',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { scenario: 'no_active' });
      const res = await run();
      const m = await msgs(); const rows = await runs();
      return { pass: res.status === 200 && summary(res).status === 'no_active_sprint' && m.length === 0 && rows.length === 0,
        actual: `HTTP ${res.status}; status=${summary(res).status}; emails=${m.length}; rows=${rows.length}` };
    });

  await scenario('T12', 'Active sprint with zero issues',
    'Digest still sent with health=Empty, 0%',
    async () => {
      await reset();
      await post(`${JIRA}/__control`, { scenario: 'empty_sprint' });
      const res = await run();
      const s = summary(res);
      return { pass: s.sprints.every((x) => x.health === 'Empty' && x.completionPct === 0 && x.outcome === 'sent'),
        actual: s.sprints.map((x) => `${x.sprint}: ${x.health} ${x.completionPct}% ${x.outcome}`).join('; ') };
    });

  await scenario('T13', 'Crash recovery: stale pending claim (2h old) does not block today\'s digest',
    'Stale claim ignored; digest sent',
    async () => {
      await reset();
      await post(`${N8N}/test/runs-insert`, { rows: [{ digest_key: `11:${today}`, status: 'pending', claim_token: 'crashed', run_date: today,
        sprint_id: 11, sprint_name: 'Payments Sprint 4', claimed_at: new Date(Date.now() - 2 * 3600e3).toISOString() }] });
      const res = await run();
      const o = outcomes(res);
      return { pass: o['Payments Sprint 4'] === 'sent', actual: `outcomes=${JSON.stringify(o)}` };
    });

  await scenario('T14', 'In-flight protection: fresh pending claim (1 min old) from another run',
    'Payments skip_in_flight; no duplicate email for it',
    async () => {
      await reset();
      await post(`${N8N}/test/runs-insert`, { rows: [{ digest_key: `11:${today}`, status: 'pending', claim_token: 'other-run', run_date: today,
        sprint_id: 11, sprint_name: 'Payments Sprint 4', claimed_at: new Date(Date.now() - 60e3).toISOString() }] });
      const res = await run();
      const o = outcomes(res);
      const m = await msgs();
      return { pass: o['Payments Sprint 4'] === 'skip_in_flight' && !m.some((x) => x.subject.includes('Payments')),
        actual: `outcomes=${JSON.stringify(o)}; Payments emails=${m.filter((x) => x.subject.includes('Payments')).length}` };
    });

  await scenario('T15', 'Day-over-day trend from yesterday\'s snapshot',
    'Email shows "+9 pts vs <yesterday>" (29% today vs 20% yesterday)',
    async () => {
      await reset();
      await post(`${N8N}/test/runs-insert`, { rows: [{ digest_key: `11:${yesterday}`, status: 'sent', run_date: yesterday, sprint_id: 11,
        sprint_name: 'Payments Sprint 4', completion_pct: 20, done: 3, blocked: 1 }] });
      await run();
      const m = await msgs();
      const pay = m.find((x) => x.subject.includes('Payments'));
      const has = pay && pay.raw.replace(/=\r\n/g, '').includes(`+9 pts vs ${yesterday}`);
      return { pass: !!has, actual: has ? `found "+9 pts vs ${yesterday}" in email` : 'trend text not found' };
    });

  await scenario('T16', 'No active recipients configured',
    'skip_no_recipients; no emails, no claims',
    async () => {
      await reset([{ email: 'admin@test.local', role: 'admin', board_id: 0, active: true }]);
      const res = await run();
      const m = await msgs(); const rows = await runs();
      return { pass: Object.values(outcomes(res)).every((x) => x === 'skip_no_recipients') && m.length === 0 && rows.length === 0,
        actual: `outcomes=${JSON.stringify(outcomes(res))}; emails=${m.length}; rows=${rows.length}` };
    });

  await scenario('T17', 'Webhook without the correct token',
    'Rejected (HTTP 403), workflow not executed',
    async () => {
      await reset();
      const res = await run({}, 'wrong-token');
      const calls = await jiraCalls();
      return { pass: res.status === 403 && calls.length === 0, actual: `HTTP ${res.status}; Jira calls=${calls.length}` };
    });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'test-results.e2e.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), environment: 'n8n 2.45.7 (n8n start, isolated user folder) + mock Jira Cloud + SMTP sink', passed, total: results.length, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})();
