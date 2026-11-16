// Builds the decks (pptxgenjs). Styled to match the team's previous deck
// (n8n-epsilon-detailed.pptx): same theme colours and fonts.
//   node deck/build-deck.js          -> Jira-Sprint-Health-Monitor.pptx (detailed, with test results)
//   node deck/build-deck.js --plan   -> Jira-Sprint-Health-Monitor-Proposed-Plan.pptx (the plan, future tense)
// Numbers come from docs/test-results.e2e.json and the fixture scenario.
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');

const PLAN = process.argv.includes('--plan');
const pick = (detailed, plan) => (PLAN ? plan : detailed);
const ROOT = path.join(__dirname, '..');
const OUT = process.env.DECK_OUT || path.join(__dirname, PLAN ?'Jira-Sprint-Health-Monitor-Proposed-Plan.pptx' : 'Jira-Sprint-Health-Monitor.pptx');
const e2e = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'test-results.e2e.json'), 'utf8'));
const EMAIL_PNG = path.join(ROOT, 'docs', 'img', 'sample-digest.png');

const THEME = {
  name: 'Epsilon Automation',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: { dk1: '101828', lt1: 'FFFFFF', dk2: '0B1220', lt2: 'F7F8FA', accent1: 'F2994A', accent2: '2F6FED',
    accent3: '0EA5A3', accent4: '6B7280', accent5: 'E3E6E4', accent6: '4A5568', hlink: '2F6FED', folHlink: '4A5568' },
};
const K = THEME.colors;
const INK = K.dk1; const NAVY = K.dk2; const ORANGE = K.accent1; const BLUE = K.accent2; const TEAL = K.accent3;
const GRAY = K.accent4; const LINE = K.accent5; const SLATE = K.accent6; const MINT = '7DD3C0'; const RED = 'C62828';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = 'Sanjna J, Manikonda Chethan Krishna';
pres.company = 'Epsilon';
pres.title = 'Jira Sprint Health Monitor & Daily Digest';

const W = 13.333; const M = 0.6;
const FOOT = 'jira-sprint-health · Jira Sprint Health Monitor & Daily Digest';

pres.defineSlideMaster({ title: 'DARK', background: { color: NAVY } });
pres.defineSlideMaster({
  title: 'CONTENT', background: { color: 'FFFFFF' },
  objects: [{ text: { text: FOOT, options: { x: M, y: 7.05, w: 8, h: 0.25, fontSize: 9, color: GRAY, margin: 0 } } }],
  slideNumber: { x: W - M - 0.5, y: 7.05, w: 0.5, h: 0.25, fontSize: 9, color: GRAY, align: 'right' },
});

let sec = '';
const section = (t) => { sec = t; pres.addSection({ title: t }); };
const content = () => pres.addSlide({ masterName: 'CONTENT', sectionTitle: sec });
const kicker = (s, t, color = BLUE) => s.addText(t.toUpperCase(), { x: M, y: 0.42, w: 9, h: 0.28, fontSize: 11, bold: true, color, charSpacing: 2, margin: 0, isTextBox: true });
const title = (s, t) => s.addText(t, { x: M, y: 0.72, w: W - 2 * M, h: 0.7, fontFace: 'Cambria', fontSize: 30, bold: true, color: INK, margin: 0, valign: 'top', isTextBox: true });
const lead = (s, t, y = 1.5, h = 0.6) => s.addText(t, { x: M, y, w: W - 2 * M, h, fontSize: 14, color: SLATE, margin: 0, valign: 'top', isTextBox: true });
const note = (s, t, y = 6.55) => s.addText(t, { x: M, y, w: W - 2 * M, h: 0.4, fontSize: 11, italic: true, color: GRAY, margin: 0, valign: 'top', isTextBox: true });
const card = (s, x, y, w, h, fill = 'FFFFFF', line = LINE) => s.addShape(pres.shapes.RECTANGLE, {
  x, y, w, h, fill: { color: fill }, line: { color: line, width: 0.75 },
  shadow: { type: 'outer', color: '000000', opacity: 0.08, blur: 6, offset: 2, angle: 90 },
});
const text = (s, t, o) => s.addText(t, { margin: 0, isTextBox: true, valign: 'top', fontSize: 13, color: INK, ...o });
const code = (s, t, x, y, w, h, fontSize = 12) => {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: NAVY }, line: { color: NAVY } });
  s.addText(t, { x: x + 0.25, y: y + 0.18, w: w - 0.5, h: h - 0.36, fontFace: 'Courier New', fontSize, color: 'D6DEEB', margin: 0, valign: 'top', isTextBox: true });
};
const badge = (s, n, x, y, color, d = 0.42) => {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color }, line: { color } });
  s.addText(String(n), { x, y, w: d, h: d, align: 'center', valign: 'middle', fontSize: 13, bold: true, color: 'FFFFFF', margin: 0, isTextBox: true });
};
const square = (s, n, x, y, color) => {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.42, h: 0.42, fill: { color }, line: { color } });
  s.addText(String(n), { x, y, w: 0.42, h: 0.42, align: 'center', valign: 'middle', fontSize: 14, bold: true, color: 'FFFFFF', margin: 0, isTextBox: true });
};
const table = (s, rows, o) => {
  const head = rows[0].map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: INK } } }));
  const body = rows.slice(1).map((r) => r.map((c) => (typeof c === 'object' ? c : { text: String(c) })));
  s.addTable([head, ...body], { fontSize: 12, color: INK, border: { type: 'solid', pt: 0.75, color: LINE }, margin: [5, 8, 5, 8], valign: 'middle', ...o });
};
const arrow = (s, x1, y1, x2, y2, color = GRAY, dash) => s.addShape(pres.shapes.LINE, {
  x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.001, h: Math.abs(y2 - y1) || 0.001,
  flipH: x2 < x1, flipV: y2 < y1, line: { color, width: 1.5, endArrowType: 'triangle', dashType: dash || 'solid' },
});
const box = (s, t, x, y, w, h, dark = false, fontSize = 12) => {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: dark ? INK : 'FFFFFF' }, line: { color: dark ? INK : LINE, width: 0.75 },
    shadow: { type: 'outer', color: '000000', opacity: 0.08, blur: 5, offset: 2, angle: 90 } });
  s.addText(t, { x, y, w, h, align: 'center', valign: 'middle', fontSize, bold: true, color: dark ? 'FFFFFF' : INK, margin: 3, isTextBox: true });
};
const divider = (num, kick, head, sub) => {
  const s = pres.addSlide({ masterName: 'DARK', sectionTitle: sec });
  text(s, `${num} · ${kick}`.toUpperCase(), { x: 1.0, y: 2.55, w: 10, h: 0.3, fontSize: 12, bold: true, color: ORANGE, charSpacing: 2 });
  text(s, head, { x: 1.0, y: 3.0, w: 11.6, h: 1.0, fontFace: 'Cambria', fontSize: 34, bold: true, color: 'FFFFFF' });
  text(s, sub, { x: 1.0, y: 4.35, w: 10.5, h: 0.8, fontSize: 15, color: 'C9D1DE' });
  return s;
};

// ============================================================ 1. Title
section('Overview');
{
  const s = pres.addSlide({ masterName: 'DARK', sectionTitle: sec });
  text(s, pick('EPSILON · PUBLICIS GROUPE AUTOMATION ASSIGNMENT 2', 'EPSILON · PUBLICIS GROUPE AUTOMATION ASSIGNMENT 2 · PROPOSED PLAN'), { x: 0.9, y: 1.55, w: 11, h: 0.3, fontSize: 12, bold: true, color: ORANGE, charSpacing: 2 });
  text(s, 'Jira Sprint Health Monitor\n& Daily Digest', { x: 0.9, y: 2.1, w: 11, h: 1.9, fontFace: 'Cambria', fontSize: 44, bold: true, color: 'FFFFFF' });
  text(s, pick('An n8n workflow that reads every active Jira sprint each morning and emails the team one digest: progress, blockers, stale work, overdue and unassigned issues, and who is overloaded.', 'Our plan for an n8n workflow that will read every active Jira sprint each morning and email the team one digest: progress, blockers, stale work, overdue and unassigned issues, and who is overloaded.'),
    { x: 0.9, y: 4.25, w: 10.2, h: 0.9, fontSize: 16, color: 'C9D1DE' });
  text(s, 'Sanjna J   ·   Manikonda Chethan Krishna', { x: 0.9, y: 5.9, w: 8, h: 0.35, fontSize: 14, bold: true, color: 'FFFFFF' });
  text(s, 'n8n Community Edition  ·  Jira Cloud REST API  ·  n8n Data Tables  ·  SMTP', { x: 0.9, y: 6.3, w: 9, h: 0.3, fontSize: 11, color: '8A94A6' });
  s.addNotes('Second automation assignment. Use case 2 from Mukund\'s 11 Nov email: Jira Sprint Health Monitor and Daily Digest.');
}

// ============================================================ 2. Problem
{
  const s = content();
  kicker(s, 'Problem statement');
  title(s, 'Sprint problems surface at stand-up, not before');
  lead(s, 'Sprint health lives on the board. Nobody gets told when work stalls, a due date passes or one person quietly ends up with half the sprint, so the team usually finds out too late to recover.');
  const items = [
    ['Blockers hide', 'A blocked or flagged issue only gets attention when someone opens the board and notices it.'],
    ['Work goes stale', 'Tickets sit "In Progress" for days with no signal, and due dates slip past unnoticed.'],
    ['Uneven workload', 'Nobody sees that one member holds six open issues while others have one.'],
  ];
  items.forEach(([h, b], i) => {
    const x = M + i * 4.1;
    card(s, x, 2.55, 3.75, 2.9);
    square(s, i + 1, x + 0.35, 2.9, ORANGE);
    text(s, h, { x: x + 0.35, y: 3.55, w: 3.1, h: 0.4, fontSize: 17, bold: true });
    text(s, b, { x: x + 0.35, y: 4.05, w: 3.1, h: 1.2, fontSize: 13, color: SLATE });
  });
  note(s, 'The assignment asks for an automated daily summary of sprint progress, blockers and workload, delivered by email.', 5.85);
}

// ============================================================ 3. Solution
{
  const s = content();
  kicker(s, pick('Solution', 'Proposed solution'));
  title(s, 'One scheduled workflow, one digest per sprint per day');
  lead(s, pick('Every weekday at 09:00 IST, n8n pulls each active sprint from Jira, applies the business rules, and emails a health digest exactly once per sprint per day, even if runs overlap or something fails halfway.', 'Every weekday at 09:00 IST, n8n will pull each active sprint from Jira, apply the business rules, and email a health digest exactly once per sprint per day, even if runs overlap or something fails halfway.'));
  const cols = [['FETCH', BLUE, 'Jira Agile API for boards and active sprints, REST v3 /search/jql for every issue. All paginated, all retried.'],
    ['ANALYZE', ORANGE, 'Buckets, stale/overdue/unassigned/blocked flags, completion vs time elapsed, workload, health rating, trend vs yesterday.'],
    ['NOTIFY', TEAL, 'Claim the digest in a Data Table, email it over SMTP one at a time, record sent or failed. Admins are alerted on failure.']];
  cols.forEach(([h, c, b], i) => {
    const x = M + i * 4.1;
    card(s, x, 2.55, 3.75, 2.9);
    s.addShape(pres.shapes.RECTANGLE, { x, y: 2.55, w: 3.75, h: 0.07, fill: { color: c }, line: { color: c } });
    text(s, h, { x: x + 0.35, y: 2.95, w: 3, h: 0.3, fontSize: 12, bold: true, color: c, charSpacing: 2 });
    text(s, b, { x: x + 0.35, y: 3.5, w: 3.1, h: 1.7, fontSize: 14, color: SLATE });
  });
  note(s, 'Triggers: weekday schedule, manual run in the editor, or an authenticated webhook (supports {"dryRun": true} previews and {"force": true} resends).', 5.85);
}

// ============================================================ 4. Requirements coverage
{
  const s = content();
  kicker(s, 'Requirements');
  title(s, 'All eight steps of the brief, mapped to nodes');
  table(s, [
    ['#', 'Assignment step', pick('Implemented in', 'Planned node'), 'How'],
    ['1', 'Retrieve active sprints (Jira REST)', 'Get Scrum Boards → Get Active Sprints', 'Agile API, paged with startAt / isLast'],
    ['2', 'Fetch all issues in the sprint', 'Get Sprint Issues', '/rest/api/3/search/jql, paged with nextPageToken'],
    ['3', 'Categorise To Do / In Progress / Done / Blocked', 'Analyze Sprints', 'Status category + Blocked rules'],
    ['4', 'In Progress > 3 days, overdue, unassigned, Blocked', 'Analyze Sprints', 'statuscategorychangedate, duedate in team TZ'],
    ['5', 'Sprint completion %', 'Analyze Sprints', 'Done ÷ total, compared with % of sprint elapsed'],
    ['6', 'Members with many unresolved issues', 'Analyze Sprints', 'Workload table, overload threshold = 5'],
    ['7', 'Daily sprint health summary', 'Analyze Sprints', 'Healthy / At Risk / Critical + trend vs yesterday'],
    ['8', 'Send the summary by email', 'Send One At A Time → Send Digest Email', 'SMTP, recipients from a Data Table'],
  ], { x: M, y: 1.6, w: W - 2 * M, colW: [0.5, 4.0, 3.6, 4.03], fontSize: 12 });
  note(s, pick('Common requirements: credentials only in n8n\'s credential store, sample data only, documented logic, ' + (e2e.total + 16) + ' automated tests, credential-free exports. Steps as captured from the assignment email.', 'Common requirements: credentials only in n8n\'s credential store, sample data only, documented logic, a full test matrix, credential-free exports.'), 6.45);
}

// ============================================================ 5. Architecture
{
  const s = content();
  kicker(s, 'Architecture');
  title(s, pick('High-level system view', 'Proposed architecture'));
  const y1 = 2.0; const h = 0.85;
  box(s, 'Schedule 09:00\nManual · Webhook', 0.6, y1, 1.9, h);
  box(s, 'Config +\nData Tables', 2.95, y1, 1.8, h);
  box(s, 'Jira Agile API\nboards → sprints', 5.2, y1, 2.1, h, true);
  box(s, 'Jira REST v3\n/search/jql', 7.75, y1, 2.0, h, true);
  box(s, 'Analyze\nSprints', 10.2, y1, 2.5, h);
  arrow(s, 2.5, y1 + h / 2, 2.95, y1 + h / 2); arrow(s, 4.75, y1 + h / 2, 5.2, y1 + h / 2);
  arrow(s, 7.3, y1 + h / 2, 7.75, y1 + h / 2); arrow(s, 9.75, y1 + h / 2, 10.2, y1 + h / 2);
  // decision row
  const y2 = 3.85;
  s.addShape(pres.shapes.DIAMOND, { x: 10.55, y: y2 - 0.1, w: 1.8, h: 1.25, fill: { color: ORANGE }, line: { color: ORANGE } });
  text(s, 'Claim\nwon?', { x: 10.55, y: y2 - 0.1, w: 1.8, h: 1.25, align: 'center', valign: 'middle', fontSize: 12, bold: true, color: 'FFFFFF' });
  arrow(s, 11.45, y1 + h, 11.45, y2 - 0.1);
  box(s, 'Email one at a time\nSMTP · 3 retries', 7.5, y2 + 0.05, 2.4, h);
  arrow(s, 10.55, y2 + 0.52, 9.9, y2 + 0.52, GRAY);
  text(s, 'yes', { x: 9.95, y: y2 + 0.15, w: 0.5, h: 0.3, fontSize: 11, color: ORANGE, bold: true });
  box(s, 'Record sent / failed\nsprint_health_runs', 4.4, y2 + 0.05, 2.6, h, true);
  arrow(s, 7.5, y2 + 0.52, 7.0, y2 + 0.52);
  box(s, 'Skip / mark lost', 10.6, 5.65, 1.7, 0.6);
  arrow(s, 11.45, y2 + 1.15, 11.45, 5.65);
  text(s, 'no / already sent', { x: 11.55, y: 5.2, w: 1.6, h: 0.3, fontSize: 11, color: ORANGE, bold: true });
  box(s, 'Error Workflow\n→ email admins', 0.6, 5.5, 2.2, 0.8);
  arrow(s, 1.7, y1 + h, 1.7, 5.5, GRAY, 'dash');
  text(s, 'on any failure', { x: 1.8, y: 4.3, w: 1.6, h: 0.3, fontSize: 11, color: GRAY, italic: true });
  arrow(s, 3.85, y1 + h, 5.4, y2 + 0.05, GRAY, 'dash');
  text(s, 'history + recipients', { x: 3.0, y: 3.35, w: 1.9, h: 0.3, fontSize: 11, color: GRAY, italic: true });
  note(s, 'Dark boxes are external systems or persistent state. Dashed lines are reads of state and the error path.', 6.55);
}

// ============================================================ 6. Tech stack (detailed only)
if (!PLAN) {
  const s = content();
  kicker(s, 'Tech stack');
  title(s, 'Six pieces, no new infrastructure');
  const items = [
    ['Jira Cloud', INK, 'Free site with a Scrum project. Boards, sprints and issues come from the REST APIs.'],
    ['n8n Community Edition', BLUE, 'Self-hosted orchestration: Schedule, Webhook, HTTP Request, Code, IF, Loop, Email.'],
    ['Jira REST APIs', BLUE, 'Agile 1.0 for boards and sprints, Platform v3 /search/jql for issues.'],
    ['n8n Data Tables', ORANGE, 'Recipients, digest claims and daily snapshots. Queryable and editable in the n8n UI.'],
    ['SMTP', ORANGE, 'Email delivery (e.g. Gmail app password, as in the ServiceNow project).'],
    ['Error workflow + history', TEAL, 'Every run saved. Failures email the admin rows of the recipients table.'],
  ];
  items.forEach(([h, c, b], i) => {
    const x = M + (i % 3) * 4.1; const y = 1.7 + Math.floor(i / 3) * 2.2;
    card(s, x, y, 3.75, 1.9);
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.35, y: y + 0.38, w: 0.16, h: 0.16, fill: { color: c }, line: { color: c } });
    text(s, h, { x: x + 0.65, y: y + 0.3, w: 2.9, h: 0.35, fontSize: 15, bold: true });
    text(s, b, { x: x + 0.35, y: y + 0.8, w: 3.1, h: 1.0, fontSize: 13, color: SLATE });
  });
  note(s, 'Why HTTP Request instead of the built-in Jira node: the Jira node has no board/sprint operations and no control over cursor pagination.', 6.2);
}

// ============================================================ 7. Workflow nodes
{
  const s = content();
  kicker(s, 'n8n workflow');
  title(s, pick('Thirty nodes, twelve stages, one daily cycle', 'Twelve stages, one daily cycle'));
  const st = [
    ['Triggers', 'Schedule · Manual · Webhook', BLUE], ['Config', 'Every tunable in one node', BLUE], ['Ensure Tables', 'Create Data Tables if missing', ORANGE],
    ['Load State', 'Recipients + 8 days of history', ORANGE], ['Boards', 'Paged agile call, filter boardIds', BLUE], ['Active Sprints', 'Per board, de-duplicated', BLUE],
    ['Has Sprint?', 'Else: no_active_sprint summary', ORANGE], ['Sprint Issues', '/search/jql, nextPageToken', BLUE], ['Analyze', 'Rules, metrics, health, email', TEAL],
    ['Claim', 'Insert, read back, lowest id wins', ORANGE], ['Send Loop', 'One email per pass, 3 retries', TEAL], ['Summary', 'JSON result; raises on failure', TEAL],
  ];
  st.forEach(([h, b, c], i) => {
    const x = M + (i % 3) * 4.1; const y = 1.6 + Math.floor(i / 3) * 1.25;
    card(s, x, y, 3.75, 1.05);
    badge(s, i + 1, x + 0.25, y + 0.31, c);
    text(s, h, { x: x + 0.85, y: y + 0.2, w: 2.8, h: 0.32, fontSize: 14, bold: true });
    text(s, b, { x: x + 0.85, y: y + 0.55, w: 2.8, h: 0.35, fontSize: 12, color: SLATE });
  });
  note(s, pick('Code-node logic lives in src/*.js with unit tests; scripts/build-workflows.js inlines it into the exported workflow JSON.', 'Code-node logic will live in src/*.js with unit tests and be inlined into the exported workflow JSON at build time.'), 6.6);
}

// ============================================================ 8. Section: REST
section('Jira REST API');
if (!PLAN) divider('01', 'Jira REST API integration', 'Talking to Jira over REST', 'Three endpoints, two pagination styles, one credential. Everything the digest knows comes from these calls.');

// ============================================================ 9. Endpoints
{
  const s = content();
  kicker(s, 'REST API');
  title(s, 'Three calls per run');
  code(s, `GET {site}/rest/agile/1.0/board?maxResults=100
GET {site}/rest/agile/1.0/board/{boardId}/sprint?state=active
GET {site}/rest/api/3/search/jql
      ?jql=sprint = {sprintId} ORDER BY key
      &fields=summary,status,assignee,duedate,priority,issuetype,
              statuscategorychangedate,issuelinks,customfield_10021,...
      &maxResults=100
Authorization: Basic base64(email:api_token)   <- n8n Jira credential`, M, 1.55, W - 2 * M, 2.35, 12);
  table(s, [
    ['Call', 'Why', 'Watch out for'],
    ['board', 'Keep types scrum + simple (team-managed)', 'Team-managed Kanban is also "simple"; its sprint call returns 400, which is skipped'],
    ['board/{id}/sprint?state=active', 'Only the running sprint matters', 'One sprint can appear on several boards, so de-duplicate'],
    ['search/jql', 'All issues + only the fields we use', 'Returns only ids unless fields is set. The old /search is gone'],
  ], { x: M, y: 4.15, w: W - 2 * M, colW: [3.2, 4.0, 4.93] });
  note(s, 'Each call: 3 tries, 3 s apart (covers HTTP 429 rate limits and 5xx), 30 s timeout.', 6.4);
}

// ============================================================ 10. Pagination
{
  const s = content();
  kicker(s, 'Pagination');
  title(s, 'No 200-record ceiling this time');
  lead(s, 'Reviewer feedback on our ServiceNow monitor: "implement API pagination to go beyond the current 200-record limit." ' + pick('All three Jira calls now use n8n\'s built-in HTTP pagination.', 'All three Jira calls will use n8n\'s built-in HTTP pagination.'), 1.5, 0.7);
  text(s, 'Agile API: offset paging', { x: M, y: 2.45, w: 5.8, h: 0.3, fontSize: 14, bold: true });
  code(s, `parameter  startAt =
  {{ $response.body.startAt
     + $response.body.maxResults }}
complete when
  {{ $response.body.isLast !== false }}`, M, 2.85, 5.85, 1.9, 12);
  text(s, 'Search API: cursor paging', { x: 6.9, y: 2.45, w: 5.8, h: 0.3, fontSize: 14, bold: true });
  code(s, `parameter  nextPageToken =
  {{ $response.body.nextPageToken }}
complete when
  {{ !$response.body.nextPageToken
     || $response.body.isLast === true }}`, 6.9, 2.85, 5.83, 1.9, 12);
  card(s, M, 5.05, W - 2 * M, 1.25, 'FFF7F0', 'F6D3B4');
  text(s, 'Guards against bad paging', { x: M + 0.3, y: 5.2, w: 6, h: 0.3, fontSize: 14, bold: true, color: 'B45F14' });
  text(s, 'Page cap (Config.maxPages = 50), a 200 ms gap between pages, and n8n stops if the same page comes back 5 times. Community reports describe /search/jql repeating tokens. ' + pick('Proven in tests: 17 issues at 5 per page = 4 requests.', 'Example: 17 issues at 5 per page = 4 requests.'),
    { x: M + 0.3, y: 5.55, w: W - 2 * M - 0.6, h: 0.7, fontSize: 13, color: INK });
}

// ============================================================ 11. Section: rules
section('Business rules');
if (!PLAN) divider('02', 'Business rules & analysis', 'From raw issues to a health rating', 'How the workflow decides what is blocked, stale, overdue or overloaded, and how healthy the sprint is.');

// ============================================================ 12. Rules table
{
  const s = content();
  kicker(s, 'Business rules');
  title(s, 'Four buckets, four flags');
  table(s, [
    ['Rule', 'Definition', 'Why this way'],
    [{ text: 'Blocked', options: { bold: true } }, 'Status in blockedStatusNames, or Flagged field set, or an unresolved "is blocked by" link', 'Default Jira workflows have no Blocked status'],
    [{ text: 'To Do / In Progress / Done', options: { bold: true } }, 'Jira status category: new / indeterminate / done', 'Works with any custom status names'],
    [{ text: 'In Progress > 3 days', options: { bold: true } }, 'statuscategorychangedate older than 3 days (blocked issues listed separately)', '"updated" resets on every comment, this doesn\'t'],
    [{ text: 'Overdue', options: { bold: true } }, 'duedate before today in Asia/Kolkata, not Done', 'duedate is a calendar date, not a timestamp'],
    [{ text: 'Unassigned', options: { bold: true } }, 'No assignee and not Done', ''],
    [{ text: 'Overloaded member', options: { bold: true } }, '≥ 5 unresolved issues in the sprint', 'Threshold in Config'],
  ], { x: M, y: 1.6, w: W - 2 * M, colW: [3.0, 5.4, 3.73] });
  note(s, 'All thresholds, status names and Jira field ids live in the Config node. Nothing site-specific is hard-coded elsewhere.', 5.9);
}

// ============================================================ 13. Health model
{
  const s = content();
  kicker(s, 'Health rating');
  title(s, 'Completion is judged against the calendar');
  lead(s, '29% done means very different things on day 2 and day 13 of a sprint, so the rating compares completion with the share of the sprint that has already elapsed.', 1.5, 0.7);
  const tiers = [
    ['Critical', RED, '≥ 3 issues blocked, or completion ≥ 30 pts behind elapsed time'],
    ['At Risk', ORANGE, 'Any blocked or overdue issue, an overloaded member, or ≥ 15 pts behind'],
    ['Healthy', TEAL, 'None of the above'],
    ['Empty', GRAY, 'Active sprint with no issues (still reported)'],
  ];
  tiers.forEach(([h, c, b], i) => {
    const y = 2.5 + i * 0.95;
    card(s, M, y, 7.3, 0.8);
    s.addShape(pres.shapes.OVAL, { x: M + 0.3, y: y + 0.24, w: 0.32, h: 0.32, fill: { color: c }, line: { color: c } });
    text(s, h, { x: M + 0.85, y, w: 1.5, h: 0.8, fontSize: 15, bold: true, color: c, valign: 'middle' });
    text(s, b, { x: M + 2.4, y, w: 4.7, h: 0.8, fontSize: 13, color: SLATE, valign: 'middle' });
  });
  card(s, 8.3, 2.5, 4.43, 3.65, NAVY, NAVY);
  text(s, 'Plus a trend line', { x: 8.6, y: 2.75, w: 3.9, h: 0.35, fontSize: 15, bold: true, color: 'FFFFFF' });
  text(s, 'Each sent digest is stored as a daily snapshot in sprint_health_runs, so tomorrow\'s email can say:', { x: 8.6, y: 3.2, w: 3.9, h: 0.9, fontSize: 13, color: 'C9D1DE' });
  text(s, '+5 pts vs 2026-11-15', { x: 8.6, y: 4.2, w: 3.9, h: 0.5, fontFace: 'Courier New', fontSize: 18, bold: true, color: MINT });
  text(s, 'Thresholds are Config values: criticalBlockedCount, criticalBehindPct, atRiskBehindPct.', { x: 8.6, y: 4.95, w: 3.9, h: 0.9, fontSize: 12, color: '8A94A6', italic: true });
}

// ============================================================ 14. Sample analysis (charts)
{
  const s = content();
  kicker(s, 'Sample sprint');
  title(s, pick('Payments Sprint 4: what the rules find', 'Sample sprint: what the rules will flag'));
  const stats = [['29%', 'done (5 of 17)', INK], ['43%', 'of sprint elapsed', INK], ['3', 'blocked', RED], ['2', 'stale > 3 days', ORANGE], ['2', 'overdue', ORANGE], ['2', 'unassigned', ORANGE]];
  stats.forEach(([n, l, c], i) => {
    const x = M + i * 2.03;
    text(s, n, { x, y: 1.55, w: 1.9, h: 0.75, fontFace: 'Cambria', fontSize: 40, bold: true, color: c });
    text(s, l, { x, y: 2.3, w: 1.9, h: 0.3, fontSize: 12, color: SLATE });
  });
  const ax = { catAxisLabelColor: SLATE, valAxisLabelColor: SLATE, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt', catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
    valGridLine: { color: 'E3E6E4', size: 0.75 }, catGridLine: { style: 'none' }, showLegend: false, showValue: true, dataLabelPosition: 'outEnd',
    dataLabelColor: INK, dataLabelFontSize: 11, dataLabelFontFace: '+mn-lt', titleFontFace: '+mj-lt', titleFontSize: 14, titleColor: INK, showTitle: true, valAxisMinVal: 0 };
  s.addChart(pres.charts.BAR, [{ name: 'Issues', labels: ['To Do', 'In Progress', 'Done', 'Blocked'], values: [5, 4, 5, 3] }],
    { x: M, y: 2.9, w: 5.9, h: 3.45, barDir: 'col', chartColors: [GRAY, BLUE, TEAL, RED], title: 'Issues by bucket', valAxisMaxVal: 6, valAxisMajorUnit: 2, ...ax });
  s.addChart(pres.charts.BAR, [{ name: 'Open issues', labels: ['Priya Raman', 'Arjun Mehta', 'Neha Kapoor', 'Rahul Verma'], values: [6, 2, 1, 1] }],
    { x: 6.85, y: 2.9, w: 5.9, h: 3.45, barDir: 'bar', chartColors: [ORANGE, 'B8C2D1', 'B8C2D1', 'B8C2D1'], title: 'Unresolved issues per member (threshold 5)', valAxisMaxVal: 7, valAxisMajorUnit: 1, catAxisOrientation: 'maxMin', ...ax });
  note(s, pick('Rating: Critical (3 blocked). Fixture data shared by the mock Jira, the unit tests and scripts/seed-jira.js.', 'Rating: Critical (3 blocked). Sample data from the fixture sprint we will seed into Jira.'), 6.5);
}

// ============================================================ 15. Example email
{
  const s = content();
  kicker(s, pick('Example', 'Proposed digest'));
  title(s, pick('What the team receives at 09:00', 'What the team will receive at 09:00'));
  s.addImage({ path: EMAIL_PNG, x: M, y: 1.45, w: 4.95, h: 5.45, altText: 'Sample digest email for Payments Sprint 4 showing Critical health, metrics, issue lists and workload table' });
  s.addShape(pres.shapes.RECTANGLE, { x: M, y: 1.45, w: 4.95, h: 5.45, fill: { type: 'none' }, line: { color: LINE, width: 0.75 } });
  const pts = [
    ['Subject line you can triage from', '[Sprint Health] Payments Sprint 4 | Critical | 29% done | 2026-11-16'],
    ['Numbers first', 'Completion, time elapsed, days left and the change since yesterday sit above the fold.'],
    ['Every issue links to Jira', 'Grouped by Blocked, In Progress > 3 days, Overdue and Unassigned, with owner and reason.'],
    ['Workload table', 'Unresolved, in-progress and blocked counts per person, with overloaded members marked.'],
    ['HTML + plain text', 'Both parts are sent. The footer carries the runId so any email can be traced to its execution.'],
  ];
  pts.forEach(([h, b], i) => {
    const y = 1.5 + i * 1.07;
    badge(s, i + 1, 6.0, y + 0.02, i === 0 ? ORANGE : BLUE, 0.38);
    text(s, h, { x: 6.6, y, w: 6.1, h: 0.32, fontSize: 14, bold: true });
    text(s, b, { x: 6.6, y: y + 0.36, w: 6.1, h: 0.62, fontSize: 12, color: SLATE });
  });
}

// ============================================================ 16. Section: reliability
section('Reliability');
if (!PLAN) divider('03', 'Reliability engineering', 'Acting on last round\'s feedback', pick('A real database for state, exactly one digest under concurrent runs, and the bug our failure tests caught.', 'A real database for state, exactly one digest under concurrent runs, and retries that never duplicate.'));

// ============================================================ 17. Feedback table
{
  const s = content();
  kicker(s, 'Reviewer feedback');
  title(s, pick('What we changed since the ServiceNow review', 'What we will change since the ServiceNow review'));
  table(s, [
    ['Feedback (10 Nov)', pick('This project', 'Planned change')],
    ['Use a database instead of n8n static data for alert state', 'Two n8n Data Tables, created automatically and editable in the UI'],
    ['Test concurrent executions and failure scenarios', pick(e2e.total + ' end-to-end scenarios incl. 5 simultaneous runs, Jira outage, SMTP rejection, crash recovery', 'A test matrix with 5 simultaneous runs, Jira outage, SMTP rejection and crash recovery')],
    ['Implement pagination beyond the 200-record limit', 'Built-in HTTP pagination on all 3 Jira calls, startAt and nextPageToken'],
    ['Avoid hard-coded email addresses (other team)', 'Recipients and admins are Data Table rows with role, board and active flag'],
    ['Improve date and time-zone handling (other team)', '"Today", overdue and the dedupe key all use the team timezone; +0530 offsets parsed'],
    ['Make duplicate prevention robust if a later step fails (other team)', 'Claim before send, record after, stale-claim recovery, per-email retries'],
  ], { x: M, y: 1.6, w: W - 2 * M, colW: [5.2, 6.93], rowH: 0.62, fontSize: 13 });
  note(s, '"Other team" items came from the review of the Jira reminders project; they applied equally to ours.', 6.3);
}

// ============================================================ 18. Data Tables vs alternatives
{
  const s = content();
  kicker(s, 'Data model');
  title(s, 'Why n8n Data Tables (and where Postgres would win)');
  table(s, [
    ['', 'Workflow static data', 'n8n Data Tables (chosen)', 'External Postgres'],
    ['Saved by test / manual runs', 'No, production only', 'Yes', 'Yes'],
    ['Visible without code', 'No', 'Yes, n8n UI', 'SQL client'],
    ['Concurrent writers', 'Whole blob, last write wins', 'Row inserts, DB-assigned ids', 'Row locks'],
    ['Unique constraint', 'n/a', { text: 'Not on our columns, so claim + read-back', options: { color: 'B45F14', bold: true } }, 'Native ON CONFLICT'],
    ['Extra infrastructure', 'None', 'None', 'DB server + credential'],
  ], { x: M, y: 1.6, w: W - 2 * M, colW: [3.0, 2.9, 3.4, 2.83], rowH: 0.5, fontSize: 13 });
  text(s, 'sprint_health_runs', { x: M, y: 5.0, w: 5.5, h: 0.3, fontFace: 'Courier New', fontSize: 13, bold: true, color: BLUE });
  text(s, 'digest_key (sprintId:date) · claim_token · status pending/sent/failed/lost · claimed_at · sent_at · error · plus a daily snapshot: totals per bucket, completion %, elapsed %, flags, story points',
    { x: M, y: 5.35, w: 6.0, h: 1.2, fontSize: 13, color: SLATE });
  text(s, 'sprint_digest_recipients', { x: 7.0, y: 5.0, w: 5.5, h: 0.3, fontFace: 'Courier New', fontSize: 13, bold: true, color: BLUE });
  text(s, 'email · name · role (digest | admin) · board_id (0 = all) · active. Edit recipients in the UI with no workflow change.',
    { x: 7.0, y: 5.35, w: 5.7, h: 1.2, fontSize: 13, color: SLATE });
}

// ============================================================ 19. The race (detailed only; the plan deck covers it in the notes)
if (!PLAN) {
  const s = content();
  kicker(s, 'The problem');
  title(s, 'Check-then-insert races when runs overlap');
  lead(s, 'n8n Data Tables cannot put a unique constraint on our own columns (only table and column names are unique). If two executions overlap (a manual run during the 09:00 schedule, a webhook double-click), both can see "not sent yet" and both email the team.', 1.5, 0.7);
  const rows = [['Run A', BLUE, ['Read: no row', 'Insert row', 'Send email']], ['Run B', ORANGE, ['Read: no row', 'Insert row', 'Send email']]];
  rows.forEach(([n, c, steps], r) => {
    const y = 2.75 + r * 1.25;
    text(s, n, { x: M, y: y + 0.25, w: 1.0, h: 0.4, fontSize: 15, bold: true, color: c });
    steps.forEach((t, i) => {
      const x = 1.8 + i * 3.0 + r * 0.6;
      box(s, t, x, y, 2.4, 0.85, i === 2);
      if (i < 2) arrow(s, x + 2.4, y + 0.42, x + 3.0, y + 0.42);
    });
  });
  card(s, M, 5.45, W - 2 * M, 0.85, 'FDECEC', 'F4C7C7');
  text(s, 'Result: two identical digests. Our ServiceNow design used a run lock in static data. Here the database decides, with no lock to expire or leak.',
    { x: M + 0.3, y: 5.6, w: W - 2 * M - 0.6, h: 0.6, fontSize: 13, color: INK });
}

// ============================================================ 20. Claim protocol
{
  const s = content();
  kicker(s, pick('The fix', 'The approach'));
  title(s, 'Insert a claim, read it back, lowest id wins');
  const steps = ['1. Claim (insert pending)', '2. Read back all rows', '3. Decide winner', '4. Send, record sent/failed'];
  steps.forEach((t, i) => {
    const x = M + i * 3.07;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.55, w: 2.7, h: 0.5, rectRadius: 0.25, fill: { color: i === 2 ? ORANGE : 'F1F3F5' }, line: { color: i === 2 ? ORANGE : LINE } });
    text(s, t, { x, y: 1.55, w: 2.7, h: 0.5, align: 'center', valign: 'middle', fontSize: 12, bold: true, color: i === 2 ? 'FFFFFF' : INK });
    if (i < 3) arrow(s, x + 2.7, 1.8, x + 3.07, 1.8);
  });
  code(s, `// src/claims.js: runs in every execution
const others = rows.filter(r => r.id !== mine.id);
if (others.some(r => r.status === 'sent'))
  return lose('already sent');
const live = rows.filter(r => r.status === 'pending'
  && (r.id === mine.id
      || now - r.claimed_at < staleClaimMs));
const winner = minBy(live, r => r.id);
return winner.id === mine.id ? win() : lose();`, M, 2.35, 6.6, 3.55, 12);
  card(s, 7.45, 2.35, 5.28, 1.6);
  text(s, 'Why it is safe', { x: 7.75, y: 2.5, w: 4.7, h: 0.3, fontSize: 14, bold: true });
  text(s, 'The database assigns ids in insert order, so every execution reads the same ordering and reaches the same verdict. Losers mark their row "lost".', { x: 7.75, y: 2.85, w: 4.75, h: 1.0, fontSize: 12, color: SLATE });
  card(s, 7.45, 4.15, 5.28, 1.75);
  text(s, 'Self-healing', { x: 7.75, y: 4.3, w: 4.7, h: 0.3, fontSize: 14, bold: true });
  s.addText([
    { text: 'Crashed run: ', options: { bold: true } }, { text: 'a pending claim older than 30 min is ignored.', options: { breakLine: true } },
    { text: 'Failed email: ', options: { bold: true } }, { text: 'status "failed" is retried by the next run.', options: { breakLine: true } },
    { text: 'Manual resend: ', options: { bold: true } }, { text: '{"force": true} overrides "sent".' },
  ], { x: 7.75, y: 4.65, w: 4.75, h: 1.2, fontSize: 12, color: SLATE, margin: 0, valign: 'top', paraSpaceAfter: 3, isTextBox: true });
  note(s, 'At-least-once delivery: a crash after SMTP accepts but before "Record Result" can resend after 30 min. A missed digest cannot happen silently.', 6.15);
}

// ============================================================ 21. Retry design (detailed: found by testing / plan: design decision)
{
  const s = content();
  if (PLAN) {
    kicker(s, 'Design decision');
    title(s, 'One email per pass, so a retry never repeats a sent digest');
    lead(s, 'n8n\'s Retry On Fail repeats the whole node. With several digests in one Email node, one rejected email would re-send the ones already delivered. We will send through a Loop Over Items node instead.', 1.5, 0.7);
    text(s, 'Naive', { x: M, y: 2.45, w: 5.8, h: 0.3, fontSize: 14, bold: true, color: RED });
  } else {
    kicker(s, 'Found by testing', RED);
    title(s, 'Retry On Fail re-sent emails that had already gone out');
    lead(s, 'Our SMTP-failure test rejected one email. n8n retried the whole Email node, so the digest that had already been delivered went out a second time.', 1.5, 0.7);
    text(s, 'Before', { x: M, y: 2.45, w: 5.8, h: 0.3, fontSize: 14, bold: true, color: RED });
  }
  code(s, `Email node (2 items, retry x3)
  try 1: Payments  REJECTED
         Mobile    delivered
  try 2: Payments  delivered
         Mobile    delivered   <- duplicate`, M, 2.85, 5.85, 2.1, 12);
  text(s, pick('After', 'Planned'), { x: 6.9, y: 2.45, w: 5.8, h: 0.3, fontSize: 14, bold: true, color: TEAL });
  code(s, `Loop Over Items (batch 1) -> Email (retry x3)
  pass 1: Payments  REJECTED
          Payments  delivered (retry)
  pass 2: Mobile    delivered
  -> each digest exactly once`, 6.9, 2.85, 5.83, 2.1, 12);
  card(s, M, 5.3, W - 2 * M, 1.0, 'EAF7F6', 'BFE6E2');
  text(s, pick('Regression test T18 replays one SMTP rejection and asserts every digest was accepted exactly once. Mocks that can inject faults are what exposed this; a happy-path demo would not have.',
    'The SMTP sink in our test plan can reject a chosen email, so this exact case is part of the test matrix: one rejection, every digest delivered exactly once.'),
  { x: M + 0.3, y: 5.45, w: W - 2 * M - 0.6, h: 0.75, fontSize: 13, color: INK });
}

// ============================================================ 22. Error handling
{
  const s = content();
  kicker(s, 'Error handling');
  title(s, pick('Every failure has a defined outcome', 'Every failure will have a defined outcome'));
  const rows = [
    ['Jira 429 / 5xx (transient)', '3 tries, 3 s apart; run continues', 'T06, T07'],
    ['Jira down, bad credentials, sprint call 500', 'Run fails, Error Workflow emails every admin row', 'T08, T21'],
    ['No sprint-capable boards visible', 'Explicit error naming the likely cause (permissions / boardIds)', 'T20'],
    ['Team-managed Kanban board (400 on sprints)', 'Skipped; other boards continue', 'T19'],
    ['No active sprint / empty sprint', 'Clean "no_active_sprint" summary / digest marked Empty', 'T11, T12'],
    ['SMTP rejects one digest', 'That email retried 3x, then "failed"; others untouched; admin alerted', 'T09, T18'],
    ['Re-run after a failure', 'Only the failed digest is sent again', 'T10'],
    ['Crash between claim and send', 'Stale claim ignored after 30 min', 'T13'],
    ['Overlapping runs', 'Claim protocol: one email per sprint', 'T05, T14'],
    ['Webhook without token', 'HTTP 403, nothing runs', 'T17'],
  ];
  if (PLAN) {
    table(s, [['Failure', 'Planned behaviour'], ...rows.map((r) => [r[0], r[1]])],
      { x: M, y: 1.6, w: W - 2 * M, colW: [4.4, 7.73], fontSize: 12, rowH: 0.4 });
  } else {
    table(s, [['Failure', 'What happens', 'Test'], ...rows], { x: M, y: 1.6, w: W - 2 * M, colW: [3.9, 6.7, 1.53], fontSize: 12, rowH: 0.4 });
  }
}

// ============================================================ 23. Section: testing
section('Testing');
if (!PLAN) divider('04', 'Testing', pick('Proving it under failure, not just the happy path', 'How we will prove it works under failure'),
  pick('A real n8n server, a mock Jira that pages and fails on demand, and an SMTP sink that can reject mail.',
    'A real n8n server against a mock Jira and a mail sink that fail on demand, then a live run on a Jira Cloud site.'));

// ============================================================ 24. Test setup
{
  const s = content();
  kicker(s, pick('Test harness', 'Test approach'));
  title(s, 'Real n8n, fake Jira, fake mailbox');
  const y = 2.05;
  box(s, 'tests/run-e2e.js\n' + e2e.total + ' scenarios', M, y, 2.6, 1.0);
  box(s, pick('n8n 2.45.7', 'n8n Community Edition') + '\n(n8n start, isolated folder)', 4.2, y, 3.0, 1.0, true);
  box(s, pick('mock-jira.js :5698', 'mock-jira.js') + '\npages of 1 and 5', 9.0, 1.6, 3.4, 0.85);
  box(s, pick('smtp-sink.js :2525', 'smtp-sink.js') + '\naccept / reject on demand', 9.0, 2.75, 3.4, 0.85);
  arrow(s, M + 2.6, y + 0.5, 4.2, y + 0.5);
  text(s, 'webhook', { x: 3.3, y: y + 0.18, w: 0.9, h: 0.3, fontSize: 10, italic: true, color: GRAY, align: 'center' });
  arrow(s, 7.2, y + 0.3, 9.0, 2.02); arrow(s, 7.2, y + 0.7, 9.0, 3.18);
  text(s, pick('The runner also drives the mocks directly to inject faults: HTTP 500, 429, full outage, no active sprint, empty sprint, SMTP rejection.',
    'The runner drives the mocks directly to inject faults: HTTP 500, 429, full outage, no active sprint, empty sprint, SMTP rejection.'),
  { x: M, y: 3.5, w: 8.2, h: 0.5, fontSize: 12, italic: true, color: GRAY });
  const facts = PLAN ? [
    ['Same build as shipped', 'The test build differs only in Config.jiraBaseUrl and fromEmail.'],
    ['Isolated', 'A separate N8N_USER_FOLDER with fake credentials, so no real instance or data is touched.'],
    ['Then live', 'Seed a Jira Cloud Scrum project with the same sample sprint and repeat the key cases end to end.'],
  ] : [
    ['Same build as shipped', 'Only Config.jiraBaseUrl and fromEmail differ in the test build.'],
    ['Isolated', 'N8N_USER_FOLDER=.n8n-test, so your real ~/.n8n is never touched. Credentials are fake.'],
    ['Why not n8n execute', 'Data Tables are disabled in the CLI runner ("module is disabled"), so tests drive a running server.'],
  ];
  facts.forEach(([h, b], i) => {
    const x = M + i * 4.1;
    card(s, x, 4.25, 3.75, 1.95);
    text(s, h, { x: x + 0.3, y: 4.45, w: 3.2, h: 0.32, fontSize: 14, bold: true });
    text(s, b, { x: x + 0.3, y: 4.85, w: 3.2, h: 1.25, fontSize: 12, color: SLATE });
  });
}

// ============================================================ 25. Results (detailed) / Test plan (plan)
const SHORT = { T01: 'Happy path, paginated Jira', T02: 'Same-day re-run deduplicated', T03: 'Manual resend with force', T04: 'Dry run preview, no side effects',
  T05: '5 overlapping executions', T06: 'Jira 500 twice, retried', T07: 'Jira 429 rate limit, retried', T08: 'Jira down, admin alerted',
  T09: 'SMTP rejects a digest', T10: 'Re-run retries only the failed one', T11: 'No active sprint', T12: 'Active sprint with zero issues',
  T13: 'Stale claim recovered', T14: 'Fresh claim, skip in-flight', T15: 'Trend vs yesterday', T16: 'No recipients configured',
  T17: 'Webhook with wrong token', T18: 'No duplicate after SMTP retry', T19: 'Team-managed boards (simple)',
  T20: 'No sprint-capable boards', T21: 'Sprint call 500, alerted' };
const sortedTests = [...e2e.results].sort((a, b) => a.id.localeCompare(b.id));
if (!PLAN) {
  const s = content();
  kicker(s, 'Test results');
  title(s, `${e2e.passed}/${e2e.total} end-to-end, 16/16 unit, all passing`);
  text(s, `${e2e.passed}/${e2e.total}`, { x: M, y: 1.6, w: 2.6, h: 0.9, fontFace: 'Cambria', fontSize: 48, bold: true, color: TEAL });
  text(s, 'end-to-end scenarios', { x: M, y: 2.5, w: 2.6, h: 0.3, fontSize: 12, color: SLATE });
  text(s, '16/16', { x: M, y: 3.05, w: 2.6, h: 0.9, fontFace: 'Cambria', fontSize: 48, bold: true, color: TEAL });
  text(s, 'unit tests (rules, dates, claims)', { x: M, y: 3.95, w: 2.6, h: 0.3, fontSize: 12, color: SLATE });
  sortedTests.forEach((r, i) => {
    const col = i % 2; const row = Math.floor(i / 2);
    const x = 3.6 + col * 4.6; const y = 1.55 + row * 0.44;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.4, h: 0.38, fill: { color: 'F7F8FA' }, line: { color: LINE, width: 0.5 } });
    text(s, r.id, { x: x + 0.12, y, w: 0.6, h: 0.38, fontSize: 11, bold: true, color: BLUE, valign: 'middle' });
    text(s, SHORT[r.id] || r.name, { x: x + 0.7, y, w: 3.0, h: 0.38, fontSize: 11, color: INK, valign: 'middle' });
    text(s, r.pass ? 'PASS' : 'FAIL', { x: x + 3.75, y, w: 0.55, h: 0.38, fontSize: 10.5, bold: true, color: r.pass ? TEAL : RED, valign: 'middle', align: 'right' });
  });
  note(s, `Run ${e2e.ranAt.slice(0, 16).replace('T', ' ')} UTC against the mock Jira + SMTP sink. Full expected vs actual in docs/test-results.md.`, 6.5);
} else {
  const s = content();
  kicker(s, 'Test plan');
  title(s, `${e2e.total} end-to-end scenarios, grouped by risk`);
  const groups = [
    ['Core flow', BLUE, ['T01', 'T02', 'T03', 'T04', 'T15']],
    ['Concurrency & recovery', ORANGE, ['T05', 'T13', 'T14', 'T10', 'T18']],
    ['Jira failures & edge cases', TEAL, ['T06', 'T07', 'T08', 'T21', 'T19', 'T20', 'T11', 'T12']],
    ['Delivery & access', SLATE, ['T09', 'T16', 'T17']],
  ];
  groups.forEach(([g, c, ids], gi) => {
    const x = M + gi * 3.07; const w = 2.85;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.6, w, h: 0.5, fill: { color: c }, line: { color: c } });
    text(s, g, { x: x + 0.15, y: 1.6, w: w - 0.3, h: 0.5, fontSize: 13, bold: true, color: 'FFFFFF', valign: 'middle' });
    ids.forEach((id, i) => {
      const y = 2.22 + i * 0.5;
      s.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 0.42, fill: { color: 'F7F8FA' }, line: { color: LINE, width: 0.5 } });
      text(s, id, { x: x + 0.12, y, w: 0.5, h: 0.42, fontSize: 11, bold: true, color: c, valign: 'middle' });
      text(s, SHORT[id], { x: x + 0.65, y, w: w - 0.75, h: 0.42, fontSize: 11, color: INK, valign: 'middle' });
    });
  });
  note(s, 'Plus 16 unit checks on the rules, timezone handling and claim logic. Each scenario records expected vs actual in docs/test-results.md.', 6.45);
}

// ============================================================ 26. Concurrency evidence (detailed only)
if (!PLAN) {
  const s = content();
  kicker(s, 'Concurrency test (T05)');
  title(s, 'Five runs at once, one email per sprint');
  lead(s, 'Five webhook calls fired at the same moment. Each run inserted its own claim. Rows as they appear in sprint_health_runs:', 1.5, 0.6);
  const t05 = e2e.results.find((r) => r.id === 'T05');
  const m = t05 && t05.actual.match(/rows per key=(\{.*?\});/);
  const perKey = m ? JSON.parse(m[1]) : {};
  Object.entries(perKey).forEach(([key, list], r) => {
    const y = 2.45 + r * 1.55;
    text(s, key, { x: M, y: y + 0.32, w: 2.0, h: 0.4, fontFace: 'Courier New', fontSize: 14, bold: true, color: INK });
    text(s, r === 0 ? 'Payments Sprint 4' : 'Mobile Sprint 9', { x: M, y: y + 0.72, w: 2.2, h: 0.3, fontSize: 11, color: GRAY });
    list.forEach((cell, i) => {
      const [id, st] = cell.split(':');
      const x = 3.0 + i * 1.95;
      const sent = st === 'sent';
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: 1.75, h: 1.15, fill: { color: sent ? TEAL : 'F1F3F5' }, line: { color: sent ? TEAL : LINE } });
      text(s, `id ${id}`, { x, y: y + 0.18, w: 1.75, h: 0.35, align: 'center', fontSize: 13, color: sent ? 'FFFFFF' : SLATE });
      text(s, st, { x, y: y + 0.55, w: 1.75, h: 0.4, align: 'center', fontSize: 16, bold: true, color: sent ? 'FFFFFF' : SLATE });
    });
  });
  card(s, M, 5.75, W - 2 * M, 0.65, 'EAF7F6', 'BFE6E2');
  text(s, 'SMTP sink received exactly 2 emails. T14 covers the other order: a fresh claim from another run makes this run skip (skip_in_flight).',
    { x: M + 0.3, y: 5.88, w: W - 2 * M - 0.6, h: 0.45, fontSize: 13, color: INK });
}

// ============================================================ 27. Roadmap (plan only)
section('Wrap-up');
if (PLAN) {
  const s = content();
  kicker(s, 'Roadmap');
  title(s, 'Four phases from setup to demo');
  const phases = [
    ['Environment & APIs', BLUE, ['Jira Cloud site + Scrum project', 'API token, SMTP, webhook credentials', 'Seed the sample sprint', 'Confirm board, sprint, issue calls']],
    ['Build the workflow', ORANGE, ['Fetch boards, sprints, issues', 'Rules, metrics, health rating', 'Digest email (HTML + text)', 'Recipients Data Table']],
    ['Reliability', TEAL, ['Claim-before-send protocol', 'Per-email retries', 'Error workflow to admins', 'Daily snapshots for trends']],
    ['Test & hand-in', SLATE, [`${e2e.total}-scenario test matrix`, 'Live run on the Jira site', 'Docs + sanitised exports', 'Short demo recording']],
  ];
  phases.forEach(([h, c, items], i) => {
    const x = M + i * 3.07; const w = 2.85;
    badge(s, i + 1, x, 1.65, c, 0.5);
    if (i < 3) s.addShape(pres.shapes.LINE, { x: x + 0.6, y: 1.9, w: 2.4, h: 0, line: { color: LINE, width: 1.5 } });
    card(s, x, 2.45, w, 2.75);
    text(s, h, { x: x + 0.25, y: 2.65, w: w - 0.5, h: 0.4, fontSize: 15, bold: true, color: c });
    s.addText(items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })),
      { x: x + 0.2, y: 3.15, w: w - 0.4, h: 1.95, fontSize: 12, color: SLATE, margin: 0, valign: 'top', paraSpaceAfter: 6, isTextBox: true });
  });
  note(s, 'Possible extensions: per-assignee nudges, Teams or Slack delivery, a sprint-end retrospective report.', 5.5);
}

// ============================================================ 28. Repository / deliverables
{
  const s = content();
  kicker(s, pick('Repository', 'Deliverables'));
  title(s, pick('What we are handing in', 'What we will hand in'));
  const files = [
    ['workflows/*.json', 'Main workflow + error handler, credential-free'],
    ['workflows/README.md', 'Import, credentials, recipients, Config reference'],
    ['src/analyze.js · claims.js · config.js', 'Code-node logic, inlined at build time'],
    ['scripts/build-workflows.js', 'src/ → importable workflow JSON'],
    ['scripts/seed-jira.js', 'Creates the sample sprint in a real Jira site'],
    ['tests/ (mock-jira, smtp-sink, run-e2e)', e2e.total + ' e2e scenarios + 16 unit tests'],
    ['docs/architecture.md', 'Design, data model, claim protocol, error handling'],
    ['docs/test-results.md', pick('Generated: expected vs actual for every scenario', 'Expected vs actual for every scenario')],
  ];
  files.forEach(([f, d], i) => {
    const x = M + (i % 2) * 6.15; const y = 1.6 + Math.floor(i / 2) * 1.2;
    card(s, x, y, 5.9, 1.0);
    text(s, f, { x: x + 0.3, y: y + 0.17, w: 5.4, h: 0.33, fontFace: 'Courier New', fontSize: 13, bold: true, color: BLUE });
    text(s, d, { x: x + 0.3, y: y + 0.55, w: 5.4, h: 0.33, fontSize: 12, color: SLATE });
  });
}

if (PLAN) {
  const NOTES = require('./plan-notes.js');
  const slides = pres.slides || pres._slides;
  if (slides.length !== NOTES.length) throw new Error(`plan deck has ${slides.length} slides but plan-notes.js has ${NOTES.length} entries`);
  slides.forEach((sl, i) => {
    const n = NOTES[i];
    sl.addNotes([...n.say.map((t) => '- ' + t), ...(n.ask ? ['', 'If asked:', ...n.ask.map((t) => '- ' + t)] : [])].join('\n'));
  });
  const total = NOTES.reduce((sum, n) => { const [m, sec] = n.time.split(':').map(Number); return sum + m * 60 + sec; }, 0);
  const md = [
    '# Speaker notes: Jira Sprint Health Monitor (Proposed Plan)',
    '',
    `${NOTES.length} slides, about ${Math.round(total / 60)} minutes at the suggested pace. The same notes are in PowerPoint\'s speaker notes (View → Presenter View).`,
    '',
    ...NOTES.flatMap((n, i) => [
      `## Slide ${i + 1}: ${n.title}`,
      `*~${n.time} min*`,
      '',
      ...n.say.map((t) => '- ' + t),
      ...(n.ask ? ['', '**If asked:**', ...n.ask.map((t) => '- ' + t)] : []),
      '',
    ]),
  ].join('\n');
  fs.writeFileSync(path.join(__dirname, 'Proposed-Plan-Speaker-Notes.md'), md);
  console.log('wrote', path.join(__dirname, 'Proposed-Plan-Speaker-Notes.md'));
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  const applyTheme = process.env.APPLY_THEME_JS;
  if (applyTheme) {
    const { applyTheme: apply } = require(applyTheme);
    await apply(OUT, THEME);
  }
  console.log('wrote', OUT);
})();
