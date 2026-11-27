// Builds the importable n8n workflow JSON from the source files in src/.
// Code-node logic lives in src/*.js (unit-tested); this script inlines it so the
// exported workflows/ files are self-contained and contain no credentials.
//
//   node scripts/build-workflows.js          -> workflows/*.json (shipped)
//   node scripts/build-workflows.js --test   -> .n8n-test/import/*.json (Config pointed at local mocks)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEST = process.argv.includes('--test');
const src = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const { DEFAULT_CONFIG } = require('../src/config.js');
const { validateConfig } = require('../src/validate.js');

const IDS = { main: 'jsHealthMonitor1', error: 'jsHealthErrors01', jira: 'jsHealthJiraGet1', helpers: 'jsHealthTestHlp1', shippedCfg: 'jsHealthTestCfg1' };
const RUNS_TABLE = 'sprint_health_runs';
const RECIPIENTS_TABLE = 'sprint_digest_recipients';
const CREDS = {
  jira: { jiraSoftwareCloudApi: { id: 'credJiraCloud001', name: 'Jira Cloud (sprint monitor)' } },
  smtp: { smtp: { id: 'credSmtpDigest01', name: 'SMTP (sprint digest)' } },
  hook: { httpHeaderAuth: { id: 'credHookToken001', name: 'Sprint digest webhook token' } },
};

const config = TEST
  ? { ...DEFAULT_CONFIG, jiraBaseUrl: 'http://localhost:5698', fromEmail: 'Sprint Digest <digest@test.local>' }
  : DEFAULT_CONFIG;

// Fail the build on a broken src/config.js. The shipped defaults are placeholders
// (your-team.atlassian.net, ...) that the Config node rejects at run time until
// they are edited, so only those errors are allowed here.
{
  const { errors } = validateConfig(config, { workflowTimezone: config.timezone });
  const real = TEST ? errors : errors.filter((e) => !/placeholder/.test(e));
  if (real.length) {
    console.error('src/config.js is invalid:\n  - ' + real.join('\n  - '));
    process.exit(1);
  }
}

const ISSUE_FIELDS = ['summary', 'status', 'assignee', 'duedate', 'priority', 'issuetype', 'created', 'updated',
  'statuscategorychangedate', 'resolutiondate', 'issuelinks'];

let nid = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) =>
  ({ id: `n${String(++nid).padStart(3, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, type, typeVersion, position, parameters, ...extra });
const tableRef = (name) => ({ __rl: true, mode: 'name', value: name });
const conds = (list, matchType = 'allConditions') => ({
  matchType, filters: { conditions: list.map(([keyName, condition, keyValue]) => ({ keyName, condition, keyValue })) },
});
const retry = { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 };

// Every Jira call goes through the "Jira GET" sub-workflow (src/jira-paging.js):
// pagination + Retry-After + exponential backoff. One sub-workflow run per input
// item, sequentially, so a run never hammers Jira in parallel.
const JIRA_SUB_NAME = 'Jira Sprint Health - Jira GET';
const jiraCall = (name, pos, extra = {}) => node(name, 'n8n-nodes-base.executeWorkflow', 1.2, pos, {
  source: 'database',
  workflowId: { __rl: true, mode: 'list', value: IDS.jira, cachedResultName: JIRA_SUB_NAME },
  workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
  mode: 'each',
  options: { waitForSubWorkflow: true },
}, extra);
// Request spec handed to the sub-workflow (see initState in src/jira-paging.js).
// failOnError=false everywhere: n8n replaces an error thrown inside a sub-workflow with a generic
// "Error executing workflow", so the sub-workflow returns { error } and the calling node throws
// with Jira's real message (which then reaches the admins).
const JIRA_SPEC_JS = `const jiraSpec = (cfg, path, query, paging, context, failOnError = false) => ({ path, query, paging, context, failOnError,
  cfg: { jiraBaseUrl: cfg.jiraBaseUrl, maxPages: cfg.maxPages, jiraMaxRetries: cfg.jiraMaxRetries,
    jiraRetryBaseDelayMs: cfg.jiraRetryBaseDelayMs, jiraRetryMaxDelayMs: cfg.jiraRetryMaxDelayMs, jiraPageIntervalMs: cfg.jiraPageIntervalMs } });`;

const RUN_COLUMNS = [
  ['digest_key', 'string'], ['claim_token', 'string'], ['status', 'string'], ['run_id', 'string'], ['run_date', 'string'],
  ['sprint_id', 'number'], ['sprint_name', 'string'], ['board_id', 'number'], ['health', 'string'],
  ['total_issues', 'number'], ['todo', 'number'], ['in_progress', 'number'], ['done', 'number'], ['blocked', 'number'],
  ['completion_pct', 'number'], ['elapsed_pct', 'number'], ['stale_count', 'number'], ['overdue_count', 'number'],
  ['unassigned_count', 'number'], ['overloaded_count', 'number'], ['points_total', 'number'], ['points_done', 'number'],
  ['recipients_count', 'number'], ['claimed_at', 'string'], ['sent_at', 'string'], ['error', 'string'],
];
const RECIPIENT_COLUMNS = [['email', 'string'], ['name', 'string'], ['role', 'string'], ['board_id', 'number'], ['active', 'boolean']];
const createTable = (name, pos, table, cols) => node(name, 'n8n-nodes-base.dataTable', 1.1, pos, {
  resource: 'table', operation: 'create', tableName: table,
  columns: { column: cols.map(([n, t]) => ({ name: n, type: t })) },
  options: { createIfNotExists: true },
}, { executeOnce: true });

// ------------------------------------------------------------------ main workflow
// cfg/meta overrides exist only for the test build (a copy with the shipped placeholder Config).
function mainWorkflow(cfg = config, meta = {}) {
  nid = 0;
  const cfgJs = `// All tunables in one place. Secrets live in n8n credentials; recipient
// addresses live in the "${RECIPIENTS_TABLE}" Data Table.
const CONFIG = ${JSON.stringify(cfg, null, 2)};

// ---- validation (src/validate.js): a bad value stops the run here, before any
// Jira call or email, and the Error Workflow emails the admins the list.
${src('validate.js')}

// $now is in the WORKFLOW timezone, the one the Schedule trigger fires in.
const workflowTimezone = (typeof $now !== 'undefined' && $now && $now.zoneName) || '';
const check = validateConfig(CONFIG, { workflowTimezone });
if (check.errors.length) {
  throw new Error('Invalid Config (' + check.errors.length + ' problem' + (check.errors.length > 1 ? 's' : '') + '; edit the Config node or Workflow Settings): '
    + check.errors.join(' | '));
}

const input = $input.first().json || {};
const body = input.body || {};
const trigger = input.body !== undefined ? 'webhook' : (input.timestamp || input['Readable date'] ? 'schedule' : 'manual');
const runId = 'run-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
return [{ json: { ...CONFIG, runId, trigger, workflowTimezone, configWarnings: check.warnings,
  nowIso: new Date().toISOString(), dryRun: body.dryRun === true, force: body.force === true } }];`;

  const boardsRequestJs = `${JIRA_SPEC_JS}
const cfg = $('Config').first().json;
return [{ json: jiraSpec(cfg, '/rest/agile/1.0/board', { maxResults: cfg.pageSize }, 'startAt', null) }];`;

  const selectBoardsJs = `${JIRA_SPEC_JS}
const cfg = $('Config').first().json;
const wanted = (cfg.boardIds || []).map(String);
const types = (cfg.boardTypes || ['scrum', 'simple']).map(String);
const boards = [];
for (const page of $input.all()) {
  if (page.json.error) throw new Error('Get Scrum Boards failed: ' + page.json.error.message);
  for (const b of (page.json.values || [])) {
  if (!types.includes(String(b.type))) continue; // e.g. company-managed kanban
  if (!wanted.length || wanted.includes(String(b.id))) boards.push({ boardId: b.id, boardName: b.name, boardType: b.type });
  }
}
if (!boards.length) throw new Error('No sprint-capable boards found (types ' + types.join('/') + (wanted.length ? ', boardIds ' + wanted.join(',') : '') + '). Check the Jira user can browse the project, or fix Config.boardIds / boardTypes.');
// failOnError=false: a team-managed Kanban board answers 400 and Collect Sprints skips it
return boards.map((b) => ({ json: jiraSpec(cfg, '/rest/agile/1.0/board/' + b.boardId + '/sprint',
  { state: 'active', maxResults: cfg.pageSize }, 'startAt', b, false) }));`;

  const collectSprintsJs = `// One item per active sprint, de-duplicated (a sprint can show on several boards).
// Team-managed Kanban boards report type 'simple' too; Jira answers their sprint
// call with HTTP 400 "does not support sprints". Skip those, fail on anything else.
// A sprint is listed by its origin board AND by every other board whose filter
// includes its issues. Keep one item per sprint but remember all of those boards,
// so recipients of each board are routed correctly (see Analyze Sprints).
const boardNames = new Map($('Select Boards').all().map((i) => [String(i.json.context.boardId), i.json.context.boardName]));
const seen = new Map();
for (const page of $input.all()) {
  const err = page.json.error;
  if (err) {
    if (err.statusCode === 400 || /support sprints/i.test(String(err.message))) continue;
    throw new Error('Get Active Sprints failed: ' + (err.message || JSON.stringify(err)));
  }
  const listedOn = page.json._context || {};
  for (const s of (page.json.values || [])) {
    if (s.state !== 'active') continue;
    if (!seen.has(s.id)) {
      seen.set(s.id, { sprintId: s.id, name: s.name, goal: s.goal || '', startDate: s.startDate, endDate: s.endDate,
        boardId: s.originBoardId || listedOn.boardId || null, boards: [] });
    }
    const e = seen.get(s.id);
    for (const id of [s.originBoardId, listedOn.boardId]) {
      if (id && !e.boards.some((b) => String(b.id) === String(id))) e.boards.push({ id: Number(id), name: boardNames.get(String(id)) || '' });
    }
  }
}
if (!seen.size) return [{ json: { noActiveSprint: true } }];
return [...seen.values()].map((json) => ({ json }));`;

  const issuesRequestJs = `${JIRA_SPEC_JS}
const cfg = $('Config').first().json;
const fields = ['${ISSUE_FIELDS.join("','")}', cfg.flaggedField, cfg.storyPointsField].filter(Boolean).join(',');
return $input.all().map(({ json: s }) => ({ json: jiraSpec(cfg, '/rest/api/3/search/jql',
  { jql: 'sprint = ' + s.sprintId + ' ORDER BY key', fields, maxResults: cfg.pageSize }, 'nextPageToken', s) }));`;

  const tagPagesJs = `// Each response page carries the sprint it was fetched for (_context).
const s = $json._context;
if ($json.error) throw new Error('Get Sprint Issues failed for sprint ' + s.sprintId + ' (' + s.name + '): ' + $json.error.message);
return { json: { sprint: { id: s.sprintId, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, boardId: s.boardId, boards: s.boards || [] },
  issues: $json.issues || [] } };`;

  const analyzeJs = `${src('analyze.js')}

// ---- n8n wiring
const cfg = $('Config').first().json;
const rows = (name) => $(name).all().map((i) => i.json).filter((r) => r && r.id != null);
return analyzeSprints({
  pages: $input.all().map((i) => i.json),
  config: cfg,
  history: rows('Get Recent History'),
  recipients: rows('Get Recipients'),
  now: new Date(cfg.nowIso),
  runId: cfg.runId,
  dryRun: cfg.dryRun,
  force: cfg.force,
}).map((json) => ({ json }));`;

  const claimRowsJs = `// Claim BEFORE sending: this row is what survives a crash between send and save.
const now = new Date().toISOString();
return $input.all().map(({ json: d }) => ({ json: {
  digest_key: d.digest_key,
  claim_token: d.run_id + ':' + Math.random().toString(36).slice(2, 10),
  status: 'pending', run_id: d.run_id, run_date: d.run_date,
  sprint_id: d.sprint_id, sprint_name: d.sprint_name, board_id: d.board_id, health: d.health,
  total_issues: d.metrics.total, todo: d.metrics.todo, in_progress: d.metrics.inProgress, done: d.metrics.done,
  blocked: d.metrics.blocked, completion_pct: d.metrics.completionPct, elapsed_pct: d.metrics.elapsedPct,
  stale_count: d.metrics.stale, overdue_count: d.metrics.overdue, unassigned_count: d.metrics.unassigned,
  overloaded_count: d.metrics.overloaded, points_total: d.metrics.pointsTotal, points_done: d.metrics.pointsDone,
  recipients_count: d.recipients.length, claimed_at: now, sent_at: '', error: '',
} }));`;

  const decideJs = `${src('claims.js')}

// ---- n8n wiring
const cfg = $('Config').first().json;
return decideClaims({
  myClaims: $('Claim Digest').all().map((i) => i.json),
  rows: $input.all().map((i) => i.json),
  nowMs: Date.now(),
  staleClaimMinutes: cfg.staleClaimMinutes,
  force: cfg.force,
}).map((json) => ({ json }));`;

  const prepareJs = `const byKey = new Map($('Analyze Sprints').all().map((i) => [i.json.digest_key, i.json]));
return $input.all().map(({ json: c }) => {
  const d = byKey.get(c.digest_key);
  return { json: { id: c.id, digest_key: c.digest_key, to: d.recipients.join(', '), subject: d.subject, html: d.html, text: d.text } };
});`;

  const resolveJs = `// pending -> sent | failed, keyed by the claim row id of the email that was attempted.
const p = $('Prepare Email').item.json;
const err = $json.error;
const ok = !err;
return { json: { id: p.id, digest_key: p.digest_key, status: ok ? 'sent' : 'failed', sent_at: ok ? new Date().toISOString() : '',
  error: ok ? '' : String((err && err.message) || err).slice(0, 500) } };`;

  const summaryJs = `// Runs after the send branch (lower on the canvas = later in v1 execution order).
const cfg = $('Config').first().json;
// Resolve Claims runs once per loop iteration, so gather every run's output.
const got = (n, maxRuns = 1) => {
  if (!$(n).isExecuted) return [];
  const out = [];
  for (let r = 0; r < maxRuns; r++) {
    try { out.push(...$(n).all(0, r).map((i) => i.json)); } catch (e) { break; }
  }
  return out;
};
const loops = $('Prepare Email').isExecuted ? $('Prepare Email').all().length : 0;
const results = new Map(got('Resolve Claims', loops).map((r) => [r.digest_key, r]));
const decisions = new Map(got('Decide Claims').map((r) => [r.digest_key, r]));
const sprints = $input.all().map(({ json: d }) => {
  const r = results.get(d.digest_key);
  const c = decisions.get(d.digest_key);
  const outcome = r ? r.status : (c && !c.won ? 'lost_race' : d.action);
  const out = { sprint: d.sprint_name, digest_key: d.digest_key, health: d.health, completionPct: d.metrics.completionPct,
    pointsPct: d.metrics.pointsPct, progressPct: d.metrics.progressPct, progressBy: d.metrics.progressBy, boards: d.board_ids,
    blocked: d.metrics.blocked, stale: d.metrics.stale, overdue: d.metrics.overdue, unassigned: d.metrics.unassigned,
    overloaded: d.workload.filter((w) => w.overloaded).map((w) => w.name), recipients: d.recipients.length, outcome };
  if (d.action === 'send' || d.action === 'preview') out.to = d.recipients;
  if (r && r.error) out.error = r.error;
  if (d.action === 'preview') out.preview = { subject: d.subject, to: d.recipients, text: d.text };
  return out;
});
const failed = sprints.filter((s) => s.outcome === 'failed');
const summary = { runId: cfg.runId, trigger: cfg.trigger, dryRun: cfg.dryRun, finishedAt: new Date().toISOString(),
  timezone: cfg.timezone, workflowTimezone: cfg.workflowTimezone, configWarnings: cfg.configWarnings || [],
  sent: sprints.filter((s) => s.outcome === 'sent').length, failed: failed.length, sprints };
if (failed.length) {
  // Surface the failure: the run is marked as errored and the Error Workflow emails the admins.
  throw new Error('Digest email failed for ' + failed.map((f) => f.digest_key).join(', ') + ': ' + failed[0].error);
}
return [{ json: summary }];`;

  const noSprintJs = `const cfg = $('Config').first().json;
return [{ json: { runId: cfg.runId, trigger: cfg.trigger, dryRun: cfg.dryRun, finishedAt: new Date().toISOString(),
  timezone: cfg.timezone, workflowTimezone: cfg.workflowTimezone, configWarnings: cfg.configWarnings || [],
  sent: 0, failed: 0, status: 'no_active_sprint', sprints: [] } }];`;

  const n = {};
  const add = (x) => { n[x.name] = x; return x; };
  add(node('Daily 09:00 (Mon-Fri)', 'n8n-nodes-base.scheduleTrigger', 1.2, [-1500, -120],
    { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * 1-5' }] } }));
  add(node('Run Now (manual)', 'n8n-nodes-base.manualTrigger', 1, [-1500, 60], {}));
  add(node('Run Now (webhook)', 'n8n-nodes-base.webhook', 2, [-1500, 240], {
    httpMethod: 'POST', path: meta.webhookPath || 'sprint-health/run', authentication: 'headerAuth',
    responseMode: 'lastNode', responseData: 'allEntries', options: {},
  }, { webhookId: meta.webhookId || '6f1d2a4e-8c3b-4f7a-9e21-5b8d7c0a1f33', credentials: CREDS.hook }));
  add(node('Config', 'n8n-nodes-base.code', 2, [-1260, 60], { jsCode: cfgJs }));
  add(createTable('Ensure Runs Table', [-1040, 60], RUNS_TABLE, RUN_COLUMNS));
  add(createTable('Ensure Recipients Table', [-820, 60], RECIPIENTS_TABLE, RECIPIENT_COLUMNS));
  add(node('Get Recipients', 'n8n-nodes-base.dataTable', 1.1, [-600, 60], {
    resource: 'row', operation: 'get', dataTableId: tableRef(RECIPIENTS_TABLE), ...conds([['active', 'isTrue', '']]), returnAll: true,
  }, { executeOnce: true, alwaysOutputData: true }));
  add(node('Get Recent History', 'n8n-nodes-base.dataTable', 1.1, [-380, 60], {
    resource: 'row', operation: 'get', dataTableId: tableRef(RUNS_TABLE),
    ...conds([['createdAt', 'gte', "={{ new Date(Date.now() - 8 * 86400000).toISOString() }}"]]), returnAll: true,
  }, { executeOnce: true, alwaysOutputData: true }));
  add(node('Boards Request', 'n8n-nodes-base.code', 2, [-160, 60], { jsCode: boardsRequestJs }));
  add(jiraCall('Get Scrum Boards', [-50, 220]));
  add(node('Select Boards', 'n8n-nodes-base.code', 2, [60, 60], { jsCode: selectBoardsJs }));
  add(jiraCall('Get Active Sprints', [280, 60]));
  add(node('Collect Sprints', 'n8n-nodes-base.code', 2, [500, 60], { jsCode: collectSprintsJs }));
  add(node('Has Active Sprint?', 'n8n-nodes-base.if', 2.2, [720, 60], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'c-has-sprint', leftValue: '={{ $json.noActiveSprint === true }}', rightValue: '',
        operator: { type: 'boolean', operation: 'false', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  }));
  add(node('No Active Sprint', 'n8n-nodes-base.code', 2, [960, 300], { jsCode: noSprintJs }));
  add(node('Issues Request', 'n8n-nodes-base.code', 2, [960, -60], { jsCode: issuesRequestJs }));
  add(jiraCall('Get Sprint Issues', [1070, -220]));
  add(node('Tag Pages With Sprint', 'n8n-nodes-base.code', 2, [1180, -60], { mode: 'runOnceForEachItem', jsCode: tagPagesJs }));
  add(node('Analyze Sprints', 'n8n-nodes-base.code', 2, [1400, -60], { jsCode: analyzeJs }));
  add(node('Should Send?', 'n8n-nodes-base.filter', 2.2, [1640, -240], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: 'c-send', leftValue: '={{ $json.action }}', rightValue: 'send',
        operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    options: {},
  }));
  add(node('Build Claim Rows', 'n8n-nodes-base.code', 2, [1860, -240], { jsCode: claimRowsJs }));
  add(node('Claim Digest', 'n8n-nodes-base.dataTable', 1.1, [2080, -240], {
    resource: 'row', operation: 'insert', dataTableId: tableRef(RUNS_TABLE),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {},
  }));
  add(node('Read Back Claims', 'n8n-nodes-base.dataTable', 1.1, [2300, -240], {
    resource: 'row', operation: 'get', dataTableId: tableRef(RUNS_TABLE),
    ...conds([['digest_key', 'eq', '={{ $json.digest_key }}']]), returnAll: true,
  }));
  add(node('Decide Claims', 'n8n-nodes-base.code', 2, [2520, -240], { jsCode: decideJs }));
  add(node('Won Claim?', 'n8n-nodes-base.if', 2.2, [2740, -240], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'c-won', leftValue: '={{ $json.won }}', rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  }));
  add(node('Prepare Email', 'n8n-nodes-base.code', 2, [2980, -360], { jsCode: prepareJs }));
  // One email per loop iteration: node-level retries then re-send ONLY the failed email.
  // (Found in testing: with several items in one Email node, retryOnFail re-sent the
  // digests that had already been delivered.)
  add(node('Send One At A Time', 'n8n-nodes-base.splitInBatches', 3, [3200, -360], { batchSize: 1, options: {} }));
  add(node('Send Digest Email', 'n8n-nodes-base.emailSend', 2.1, [3440, -440], {
    fromEmail: "={{ $('Config').first().json.fromEmail }}",
    toEmail: '={{ $json.to }}',
    subject: '={{ $json.subject }}',
    emailFormat: 'both',
    text: '={{ $json.text }}',
    html: '={{ $json.html }}',
    options: { appendAttribution: false },
  }, { credentials: CREDS.smtp, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput' }));
  add(node('Resolve Claims', 'n8n-nodes-base.code', 2, [3660, -440], { mode: 'runOnceForEachItem', jsCode: resolveJs }));
  add(node('Record Result', 'n8n-nodes-base.dataTable', 1.1, [3880, -440], {
    resource: 'row', operation: 'update', dataTableId: tableRef(RUNS_TABLE),
    ...conds([['id', 'eq', '={{ $json.id }}']]),
    columns: { mappingMode: 'defineBelow', value: { status: '={{ $json.status }}', sent_at: '={{ $json.sent_at }}', error: '={{ $json.error }}' },
      matchingColumns: [], schema: [] },
    options: {},
  }, retry));
  add(node('Mark Lost', 'n8n-nodes-base.dataTable', 1.1, [2980, -120], {
    resource: 'row', operation: 'update', dataTableId: tableRef(RUNS_TABLE),
    ...conds([['id', 'eq', '={{ $json.id }}']]),
    columns: { mappingMode: 'defineBelow', value: { status: 'lost', error: '={{ $json.reason }}' }, matchingColumns: [], schema: [] },
    options: {},
  }));
  add(node('Run Summary', 'n8n-nodes-base.code', 2, [1640, 120], { jsCode: summaryJs }));

  const c = {};
  const link = (from, to, out = 0) => {
    c[from] = c[from] || { main: [] };
    while (c[from].main.length <= out) c[from].main.push([]);
    c[from].main[out].push({ node: to, type: 'main', index: 0 });
  };
  link('Daily 09:00 (Mon-Fri)', 'Config');
  link('Run Now (manual)', 'Config');
  link('Run Now (webhook)', 'Config');
  link('Config', 'Ensure Runs Table');
  link('Ensure Runs Table', 'Ensure Recipients Table');
  link('Ensure Recipients Table', 'Get Recipients');
  link('Get Recipients', 'Get Recent History');
  link('Get Recent History', 'Boards Request');
  link('Boards Request', 'Get Scrum Boards');
  link('Get Scrum Boards', 'Select Boards');
  link('Select Boards', 'Get Active Sprints');
  link('Get Active Sprints', 'Collect Sprints');
  link('Collect Sprints', 'Has Active Sprint?');
  link('Has Active Sprint?', 'Issues Request', 0);
  link('Issues Request', 'Get Sprint Issues');
  link('Has Active Sprint?', 'No Active Sprint', 1);
  link('Get Sprint Issues', 'Tag Pages With Sprint');
  link('Tag Pages With Sprint', 'Analyze Sprints');
  link('Analyze Sprints', 'Should Send?');
  link('Analyze Sprints', 'Run Summary');
  link('Should Send?', 'Build Claim Rows');
  link('Build Claim Rows', 'Claim Digest');
  link('Claim Digest', 'Read Back Claims');
  link('Read Back Claims', 'Decide Claims');
  link('Decide Claims', 'Won Claim?');
  link('Won Claim?', 'Prepare Email', 0);
  link('Won Claim?', 'Mark Lost', 1);
  link('Prepare Email', 'Send One At A Time');
  link('Send One At A Time', 'Send Digest Email', 1);
  link('Send Digest Email', 'Resolve Claims');
  link('Resolve Claims', 'Record Result');
  link('Record Result', 'Send One At A Time');

  const notes = [
    ['1. Triggers', 'Weekday 09:00 schedule (workflow timezone), manual run, or authenticated POST /webhook/sprint-health/run with optional {"dryRun":true} or {"force":true}.', [-1560, -300], 360, 760],
    ['2. Config + state', 'All tunables in Config, validated on every run (bad values or a workflow/Config timezone mismatch stop the run and alert admins). State lives in two n8n Data Tables (created automatically): sprint_digest_recipients (who gets the digest) and sprint_health_runs (claims + daily snapshots).', [-1300, -160], 1120, 380],
    ['3. Jira REST (paginated)', 'Every call goes through the "Jira GET" sub-workflow: startAt/isLast or nextPageToken paging, honours Retry-After on 429/503, exponential backoff with jitter on 5xx/network errors, no retry on other 4xx. Limits from Config.jira*.', [-200, -160], 1360, 380],
    ['4. Analyze', 'Buckets To Do / In Progress / Done / Blocked, flags stale (>3d In Progress), overdue, unassigned, blocked; completion %, workload, health, day-over-day delta; renders the email.', [1140, -160], 420, 380],
    ['5. Claim-before-send', 'Insert a pending claim, read back all claims for the same sprint+date, lowest live id wins. Loser marks itself lost. Winner emails one at a time (retries never re-send a delivered digest), then records sent/failed.', [1820, -560], 2280, 540],
  ];
  const sticky = notes.map(([title, text, position, width, height], i) => ({
    id: `sticky-${i + 1}`, name: `Note ${i + 1}`, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position,
    parameters: { content: `## ${title}\n${text}`, width, height, color: [5, 7, 4, 6, 3][i] },
  }));

  return {
    id: meta.id || IDS.main,
    name: meta.name || 'Jira Sprint Health Monitor & Daily Digest',
    active: false,
    nodes: [...sticky, ...Object.values(n)],
    connections: c,
    settings: {
      executionOrder: 'v1', timezone: cfg.timezone, errorWorkflow: IDS.error,
      saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', saveManualExecutions: true, saveExecutionProgress: true,
      callerPolicy: 'workflowsFromSameOwner',
    },
    pinData: {},
    tags: [],
  };
}

// ------------------------------------------------------------------ error workflow
function errorWorkflow() {
  nid = 100;
  const buildJs = `// Admins come from the recipients Data Table (role = admin), never hard-coded.
const admins = $('Get Admin Recipients').all().map((i) => i.json)
  .filter((r) => r.email && r.role === 'admin' && r.active !== false).map((r) => r.email);
if (!admins.length) return [];
const e = $('On Workflow Error').first().json;
const ex = e.execution || {};
const err = ex.error || {};
const lines = [
  'The Jira Sprint Health Monitor failed.',
  '',
  'Workflow:  ' + ((e.workflow && e.workflow.name) || ''),
  'Execution: ' + (ex.id || '(not saved)'),
  'Mode:      ' + (ex.mode || ''),
  'Last node: ' + (ex.lastNodeExecuted || ''),
  'Error:     ' + (err.message || 'unknown'),
  '',
  ex.url ? 'Open execution: ' + ex.url : '',
];
return [{ json: { to: [...new Set(admins)].join(', '), subject: '[Sprint Health] Workflow failure: ' + String(err.message || 'unknown').slice(0, 120), text: lines.join('\\n') } }];`;
  const nodes = [
    node('On Workflow Error', 'n8n-nodes-base.errorTrigger', 1, [0, 0], {}),
    node('Get Admin Recipients', 'n8n-nodes-base.dataTable', 1.1, [220, 0], {
      resource: 'row', operation: 'get', dataTableId: tableRef(RECIPIENTS_TABLE), ...conds([['role', 'eq', 'admin']]), returnAll: true,
    }, { alwaysOutputData: true, executeOnce: true }),
    node('Build Alert', 'n8n-nodes-base.code', 2, [440, 0], { jsCode: buildJs }),
    node('Email Admins', 'n8n-nodes-base.emailSend', 2.1, [660, 0], {
      fromEmail: config.fromEmail, toEmail: '={{ $json.to }}', subject: '={{ $json.subject }}', emailFormat: 'text', text: '={{ $json.text }}',
      options: { appendAttribution: false },
    }, { credentials: CREDS.smtp, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }),
  ];
  return {
    id: IDS.error,
    name: 'Jira Sprint Health - Error Handler',
    active: false,
    nodes,
    connections: {
      'On Workflow Error': { main: [[{ node: 'Get Admin Recipients', type: 'main', index: 0 }]] },
      'Get Admin Recipients': { main: [[{ node: 'Build Alert', type: 'main', index: 0 }]] },
      'Build Alert': { main: [[{ node: 'Email Admins', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', timezone: config.timezone },
    pinData: {},
    tags: [],
  };
}

// ------------------------------------------------------------------ Jira GET sub-workflow
// Called by the main workflow's "Get Scrum Boards", "Get Active Sprints" and
// "Get Sprint Issues" nodes, once per request spec. The loop:
//   Init -> Request State -> Jira Request -> Evaluate -> Done? -> Output
//                 ^                                       | no
//                 +---------------- Wait (waitMs) <-------+
function jiraGetWorkflow() {
  nid = 300;
  const lib = src('jira-paging.js');
  const initJs = `${lib}

// ---- n8n wiring (one request spec per sub-workflow run)
const items = $input.all();
if (items.length !== 1) throw new Error('Jira GET expects exactly one request spec per call, got ' + items.length);
const state = initState(items[0].json);
return [{ json: { state, ...requestFor(state) } }];`;
  const evaluateJs = `${lib}

// ---- n8n wiring: $json is the HTTP response (full response, never-error) or { error } on a network failure
const prev = $('Request State').last().json;
const r = evaluate(prev.state, $json);
const out = { action: r.action, waitMs: r.waitMs, state: r.state };
if (r.action === 'continue') Object.assign(out, requestFor(r.state));
return [{ json: out }];`;
  const outputJs = `${lib}

// ---- n8n wiring: one item per page, or throw (failOnError) / an { error } item
return outputItems($json.state).map((json) => ({ json }));`;

  const nodes = [
    node('When Called By Monitor', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], { inputSource: 'passthrough' }),
    node('Init', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: initJs }),
    node('Request State', 'n8n-nodes-base.noOp', 1, [440, 0], {}),
    node('Jira Request', 'n8n-nodes-base.httpRequest', 4.2, [660, 0], {
      method: 'GET',
      url: '={{ $json.url }}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'jiraSoftwareCloudApi',
      sendQuery: true,
      specifyQuery: 'json',
      jsonQuery: '={{ JSON.stringify($json.query) }}',
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 30000 },
    }, { credentials: CREDS.jira, onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Evaluate', 'n8n-nodes-base.code', 2, [880, 0], { jsCode: evaluateJs }),
    node('Done?', 'n8n-nodes-base.if', 2.2, [1100, 0], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'c-done', leftValue: '={{ $json.action }}', rightValue: 'done', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
      options: {},
    }),
    node('Output', 'n8n-nodes-base.code', 2, [1340, -100], { jsCode: outputJs }),
    node('Wait (Retry-After / backoff / page gap)', 'n8n-nodes-base.wait', 1.1, [1340, 140], {
      resume: 'timeInterval', amount: '={{ Math.max(0.05, $json.waitMs / 1000) }}', unit: 'seconds',
    }, { webhookId: '3c0f7e52-1b9d-4c55-a1f0-7d2e9b6c4a18' }),
  ];
  const to = (n) => ({ node: n, type: 'main', index: 0 });
  return {
    id: IDS.jira,
    name: JIRA_SUB_NAME,
    active: false,
    nodes: [{
      id: 'sticky-jira', name: 'Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [180, -300],
      parameters: { width: 1320, height: 220, color: 5, content: '## Jira GET with pagination + rate-limit handling\n'
        + 'Called by the monitor once per request. 2xx: keep the page and fetch the next (startAt/isLast or nextPageToken). '
        + '429/503 or any Retry-After / X-RateLimit-Reset header: wait exactly that long. 408/425/5xx/network errors: exponential backoff with jitter '
        + '(Config.jiraRetryBaseDelayMs x 2^attempt, capped at jiraRetryMaxDelayMs, up to jiraMaxRetries). Other 4xx: fail at once. Logic: src/jira-paging.js' },
    }, ...nodes],
    connections: {
      'When Called By Monitor': { main: [[to('Init')]] },
      Init: { main: [[to('Request State')]] },
      'Request State': { main: [[to('Jira Request')]] },
      'Jira Request': { main: [[to('Evaluate')]] },
      Evaluate: { main: [[to('Done?')]] },
      'Done?': { main: [[to('Output')], [to('Wait (Retry-After / backoff / page gap)')]] },
      'Wait (Retry-After / backoff / page gap)': { main: [[to('Request State')]] },
    },
    settings: {
      executionOrder: 'v1', timezone: config.timezone, callerPolicy: 'workflowsFromSameOwner',
      // the parent run records everything; keep only failed sub-runs to avoid one saved execution per Jira call
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveManualExecutions: true,
    },
    pinData: {},
    tags: [],
  };
}

// ------------------------------------------------------------------ test helpers (tests only, never shipped)
function helpersWorkflow() {
  nid = 200;
  const hook = (name, p, pos) => node(name, 'n8n-nodes-base.webhook', 2, pos, {
    httpMethod: 'POST', path: p, responseMode: 'lastNode', responseData: 'allEntries', options: {},
  }, { webhookId: `0000000-test-${p.replace(/\W/g, '')}` });
  const nodes = [
    hook('POST test/reset', 'test/reset', [0, 0]),
    createTable('Ensure Runs', [220, 0], RUNS_TABLE, RUN_COLUMNS),
    createTable('Ensure Recipients', [440, 0], RECIPIENTS_TABLE, RECIPIENT_COLUMNS),
    node('Clear Runs', 'n8n-nodes-base.dataTable', 1.1, [660, 0], { resource: 'table', operation: 'clear', dataTableId: tableRef(RUNS_TABLE) }, { executeOnce: true }),
    node('Clear Recipients', 'n8n-nodes-base.dataTable', 1.1, [880, 0], { resource: 'table', operation: 'clear', dataTableId: tableRef(RECIPIENTS_TABLE) }, { executeOnce: true }),
    node('Rows From Body', 'n8n-nodes-base.code', 2, [1100, 0], { jsCode: "const b = $('POST test/reset').first().json.body || {};\nreturn (b.recipients || []).map((json) => ({ json }));" }),
    node('Insert Recipients', 'n8n-nodes-base.dataTable', 1.1, [1320, 0], {
      resource: 'row', operation: 'insert', dataTableId: tableRef(RECIPIENTS_TABLE),
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {},
    }),
    hook('POST test/runs', 'test/runs', [0, 300]),
    node('All Runs', 'n8n-nodes-base.dataTable', 1.1, [220, 300], { resource: 'row', operation: 'get', dataTableId: tableRef(RUNS_TABLE), returnAll: true }, { alwaysOutputData: true }),
    hook('POST test/validate-config', 'test/validate-config', [0, 900]),
    node('Validate Body Config', 'n8n-nodes-base.code', 2, [220, 900], { jsCode: `${src('validate.js')}
const CONFIG = { ...${JSON.stringify(config)}, ...(($json.body || {}).config || {}) };
const workflowTimezone = (typeof $now !== 'undefined' && $now && $now.zoneName) || '';
return [{ json: { workflowTimezone, ...validateConfig(CONFIG, { workflowTimezone }) } }];` }),
    hook('POST test/runs-insert', 'test/runs-insert', [0, 600]),
    node('Rows To Insert', 'n8n-nodes-base.code', 2, [220, 600], { jsCode: "return ($json.body.rows || []).map((json) => ({ json }));" }),
    node('Insert Runs', 'n8n-nodes-base.dataTable', 1.1, [440, 600], {
      resource: 'row', operation: 'insert', dataTableId: tableRef(RUNS_TABLE),
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {},
    }),
  ];
  const seq = (names) => Object.fromEntries(names.slice(0, -1).map((a, i) => [a, { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }]));
  return {
    id: IDS.helpers, name: 'TEST ONLY - sprint health helpers', active: false, nodes,
    connections: {
      ...seq(['POST test/reset', 'Ensure Runs', 'Ensure Recipients', 'Clear Runs', 'Clear Recipients', 'Rows From Body', 'Insert Recipients']),
      ...seq(['POST test/runs', 'All Runs']),
      ...seq(['POST test/runs-insert', 'Rows To Insert', 'Insert Runs']),
      ...seq(['POST test/validate-config', 'Validate Body Config']),
    },
    // deliberately NOT the Config timezone: test/validate-config must report the mismatch
    settings: { executionOrder: 'v1', timezone: 'America/New_York' }, pinData: {}, tags: [],
  };
}

const outDir = TEST ? path.join(ROOT, '.n8n-test', 'import') : path.join(ROOT, 'workflows');
fs.mkdirSync(outDir, { recursive: true });
const write = (f, obj) => { fs.writeFileSync(path.join(outDir, f), JSON.stringify(obj, null, 2) + '\n'); console.log('wrote', path.join(outDir, f)); };
write('jira-sprint-health-monitor.json', mainWorkflow());
write('error-handler.json', errorWorkflow());
write('jira-get.json', jiraGetWorkflow());
if (TEST) {
  write('test-helpers.json', helpersWorkflow());
  // T27: the monitor exactly as shipped (placeholder Config) must stop in the Config node
  write('test-shipped-config.json', mainWorkflow(DEFAULT_CONFIG, { id: IDS.shippedCfg, name: 'TEST ONLY - monitor with shipped Config',
    webhookPath: 'test/run-shipped-config', webhookId: '0000000-test-shippedconfig' }));
}
