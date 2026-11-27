// Read-only pre-flight check against a LIVE Jira Cloud site, before importing the
// workflow or when a run behaves unexpectedly. Uses the same paging + Retry-After
// / backoff code as the workflow (src/jira-paging.js) and the same Config
// validation (src/validate.js). It never writes to Jira and never sends email.
//
//   PowerShell:
//     $env:JIRA_BASE_URL="https://your-site.atlassian.net"; $env:JIRA_EMAIL="you@example.com"
//     $env:JIRA_API_TOKEN="<token>"; node scripts/live-check.js
//   Optional: $env:TIMEZONE="Asia/Kolkata"  $env:BOARD_IDS="1,2"  $env:FROM_EMAIL="Digest <d@x.com>"
//
// Exit code 0 = everything the workflow needs is in place, 1 = something to fix.
const { DEFAULT_CONFIG } = require('../src/config.js');
const { validateConfig } = require('../src/validate.js');
const { initState, requestFor, evaluate, outputItems } = require('../src/jira-paging.js');

const env = (k) => (process.env[k] || '').trim();
const base = env('JIRA_BASE_URL').replace(/\/+$/, '');
const auth = 'Basic ' + Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64');
if (!base || !env('JIRA_EMAIL') || !env('JIRA_API_TOKEN')) {
  console.error('Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN first (see INSTRUCTIONS.md, step 6).');
  process.exit(2);
}
const cfg = {
  ...DEFAULT_CONFIG,
  jiraBaseUrl: base,
  timezone: env('TIMEZONE') || DEFAULT_CONFIG.timezone,
  boardIds: env('BOARD_IDS') ? env('BOARD_IDS').split(',').map((s) => Number(s.trim())) : [],
  fromEmail: env('FROM_EMAIL') || 'Sprint Digest <digest@check.invalid>',
  flaggedField: env('FLAGGED_FIELD') || DEFAULT_CONFIG.flaggedField,
  storyPointsField: env('STORY_POINTS_FIELD') || DEFAULT_CONFIG.storyPointsField,
};

let problems = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const warn = (m) => console.log(`  WARN  ${m}`);
const bad = (m) => { problems += 1; console.log(`  FAIL  ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let retriesSeen = 0;

// Same loop as the "Jira GET" sub-workflow, driven by fetch instead of n8n nodes.
async function jiraGet(path, query = {}, paging = 'none', failOnError = true) {
  let state = initState({ path, query, paging, failOnError, cfg });
  for (;;) {
    const { url, query: q } = requestFor(state);
    const qs = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString();
    let res;
    try {
      const r = await fetch(qs ? `${url}?${qs}` : url, { headers: { Authorization: auth, Accept: 'application/json' } });
      const text = await r.text();
      let body; try { body = JSON.parse(text); } catch (e) { body = text; }
      res = { statusCode: r.status, headers: Object.fromEntries(r.headers.entries()), body };
    } catch (e) {
      res = { error: { message: e.message } };
    }
    const step = evaluate(state, res);
    state = step.state;
    if (step.action === 'done') return outputItems(state);
    if (state.lastRetry && step.waitMs > cfg.jiraPageIntervalMs) {
      retriesSeen += 1;
      console.log(`        (${state.lastRetry.reason}; retrying in ${step.waitMs} ms via ${state.lastRetry.source})`);
    }
    await sleep(step.waitMs);
  }
}

(async () => {
  console.log(`\nLive check against ${base}\n`);

  console.log('1. Config values');
  const v = validateConfig(cfg);
  v.errors.forEach(bad);
  v.warnings.forEach(warn);
  if (!v.errors.length) ok(`Config is valid (timezone ${cfg.timezone}, pageSize ${cfg.pageSize}, ${cfg.jiraMaxRetries} retries)`);

  console.log('2. Authentication');
  let me;
  try {
    [me] = await jiraGet('/rest/api/3/myself');
    ok(`logged in as ${me.displayName} (accountId ${me.accountId})`);
  } catch (e) {
    bad(`${e.message}. Check the email (your Atlassian login) and API token, and that the URL is the site root.`);
    console.log(`\n${problems} problem(s). Fix authentication first.`);
    process.exit(1);
  }

  console.log('3. Timezone');
  if (me.timeZone && me.timeZone !== cfg.timezone) {
    warn(`your Jira profile timezone is ${me.timeZone} but Config.timezone is ${cfg.timezone}. Due dates are calendar dates, so "overdue" uses Config.timezone; set both to the team's zone unless that is intended.`);
  } else ok(`Jira profile timezone ${me.timeZone || '(not set)'}; Config.timezone ${cfg.timezone}`);
  console.log(`        In n8n set Workflow Settings -> Timezone to ${cfg.timezone} too (the run stops if they differ).`);

  console.log('4. Custom fields');
  const fields = (await jiraGet('/rest/api/3/field'))[0];
  const list = Array.isArray(fields.values) ? fields.values : [];
  const byName = (re) => list.filter((f) => re.test(f.name || ''));
  for (const [key, re] of [['flaggedField', /^flagged$/i], ['storyPointsField', /^story point(s| estimate)$/i]]) {
    const want = cfg[key];
    const found = byName(re);
    if (list.some((f) => f.id === want)) ok(`${key} = ${want} exists (${(list.find((f) => f.id === want) || {}).name})`);
    else if (found.length) bad(`${key} = ${want} not found on this site; use ${found.map((f) => `${f.id} ("${f.name}")`).join(' or ')}`);
    else warn(`${key} = ${want} not found and no field named like it; set it to '' if your site has none`);
  }

  console.log('5. Boards and active sprints');
  const boards = [];
  for (const page of await jiraGet('/rest/agile/1.0/board', { maxResults: cfg.pageSize }, 'startAt')) {
    for (const b of page.values || []) if (cfg.boardTypes.includes(String(b.type))) boards.push(b);
  }
  const wanted = cfg.boardIds.map(String);
  const monitored = boards.filter((b) => !wanted.length || wanted.includes(String(b.id)));
  if (!monitored.length) bad('no sprint-capable boards visible to this user (check project access / BOARD_IDS)');
  else ok(`${monitored.length} sprint-capable board(s): ${monitored.map((b) => `${b.id} "${b.name}" (${b.type})`).join(', ')}`);
  const sprints = new Map();
  for (const b of monitored) {
    const pages = await jiraGet(`/rest/agile/1.0/board/${b.id}/sprint`, { state: 'active', maxResults: cfg.pageSize }, 'startAt', false);
    if (pages[0] && pages[0].error) {
      if (pages[0].error.statusCode === 400) { console.log(`        board ${b.id}: does not support sprints (Kanban), skipped`); continue; }
      bad(`board ${b.id}: ${pages[0].error.message}`);
      continue;
    }
    for (const p of pages) for (const s of p.values || []) {
      if (!sprints.has(s.id)) sprints.set(s.id, { ...s, listedOn: [] });
      sprints.get(s.id).listedOn.push(b.id);
    }
  }
  if (!sprints.size) warn('no active sprint: start one in Jira (Backlog -> Start sprint) or the run reports no_active_sprint');
  for (const s of sprints.values()) {
    const shared = s.listedOn.length > 1 || (s.originBoardId && !s.listedOn.includes(s.originBoardId));
    ok(`sprint ${s.id} "${s.name}" ends ${s.endDate || '?'}; origin board ${s.originBoardId}, listed on ${s.listedOn.join(', ')}`
      + (shared ? ' (shared: recipients of each board get it, see Config.sprintBoardRouting)' : ''));
  }

  console.log('6. Sprint issues');
  for (const s of sprints.values()) {
    const fieldsParam = ['summary', 'status', 'assignee', 'duedate', 'statuscategorychangedate', cfg.flaggedField, cfg.storyPointsField].filter(Boolean).join(',');
    const pages = await jiraGet('/rest/api/3/search/jql', { jql: `sprint = ${s.id} ORDER BY key`, fields: fieldsParam, maxResults: cfg.pageSize }, 'nextPageToken');
    const issues = pages.flatMap((p) => p.issues || []);
    const estimated = issues.filter((i) => typeof (i.fields || {})[cfg.storyPointsField] === 'number').length;
    const names = new Map();
    for (const i of issues) {
      const a = (i.fields || {}).assignee;
      if (!a) continue;
      if (!names.has(a.displayName)) names.set(a.displayName, new Set());
      names.get(a.displayName).add(a.accountId);
    }
    const dupes = [...names].filter(([, ids]) => ids.size > 1).map(([n]) => n);
    ok(`sprint ${s.id}: ${issues.length} issue(s) in ${pages.length} page(s); ${estimated} with story points`
      + (issues.length && estimated / issues.length < cfg.minPointsCoveragePct / 100 ? ` (under ${cfg.minPointsCoveragePct}%: health will use issue count)` : ''));
    if (dupes.length) warn(`sprint ${s.id}: different people share the display name ${dupes.join(', ')}; the digest shows them separately by accountId`);
  }

  console.log(`\n${retriesSeen ? `Jira asked us to slow down or failed transiently ${retriesSeen} time(s); handled with Retry-After/backoff.\n` : ''}`
    + (problems ? `${problems} problem(s) to fix before the live run.` : 'All checks passed. Next: dry run in n8n (INSTRUCTIONS.md, step 13).'));
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error('\nlive check failed: ' + e.message); process.exit(1); });
