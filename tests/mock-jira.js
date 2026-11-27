// Mock Jira Cloud REST API for local testing (no real Jira needed).
// Implements just the endpoints the workflow calls, with Jira's real paging
// shapes, deliberately tiny page sizes (to force pagination), Basic-auth
// checking, and fault injection controlled over HTTP.
//
//   node tests/mock-jira.js            (port 5698, or MOCK_JIRA_PORT)
//   POST /__control {"scenario":"normal|no_active|empty_sprint","failures":[{"match":"/search/jql","status":500,"times":2}]}
//   GET  /__stats    request log
const http = require('http');
const { scenario } = require('./fixtures.js');

const PORT = Number(process.env.MOCK_JIRA_PORT || 5698);
const BOARD_PAGE_CAP = 1;  // agile endpoints: force several pages
const ISSUE_PAGE_CAP = 5;  // search/jql: 17 issues -> 4 pages

let state;
function reset() {
  state = { scenario: 'normal', failures: [], log: [], data: scenario(Date.now()) };
}
reset();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function page(values, startAt, maxResults, cap) {
  const size = Math.min(maxResults || 50, cap);
  const slice = values.slice(startAt, startAt + size);
  return { maxResults: size, startAt, total: values.length, isLast: startAt + size >= values.length, values: slice };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const q = Object.fromEntries(url.searchParams);
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (url.pathname === '/__control' && req.method === 'POST') {
      const c = JSON.parse(body || '{}');
      if (c.reset) reset();
      if (c.scenario) state.scenario = c.scenario;
      if (c.failures) state.failures = c.failures.map((f) => ({ ...f }));
      return send(res, 200, { ok: true, scenario: state.scenario });
    }
    if (url.pathname === '/__stats') return send(res, 200, { log: state.log });

    state.log.push({ method: req.method, path: url.pathname, query: q, at: new Date().toISOString() });

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Basic ')) return send(res, 401, { errorMessages: ['Unauthorized (mock: Basic auth required)'] });

    const fail = state.failures.find((f) => url.pathname.includes(f.match) && f.times > 0);
    if (fail) {
      fail.times -= 1;
      state.log[state.log.length - 1].status = fail.status;
      // retryAfter: seconds to send in Retry-After (null = omit); 429 defaults to 1 like Jira
      const ra = fail.retryAfter !== undefined ? fail.retryAfter : (fail.status === 429 ? 1 : null);
      return send(res, fail.status, { errorMessages: [`mock injected ${fail.status}`] },
        ra === null ? {} : { 'Retry-After': String(ra) });
    }

    const d = state.data;
    let m;
    if (url.pathname === '/rest/agile/1.0/board') {
      let all = d.boards;
      if (state.scenario === 'no_boards') all = d.boards.filter((b) => b.type === 'kanban');
      if (state.scenario === 'team_managed') all = [
        { id: 4, name: 'WEB board (team-managed scrum)', type: 'simple' },
        { id: 5, name: 'OPS board (team-managed kanban)', type: 'simple' },
      ];
      const boards = all.filter((b) => !q.type || b.type === q.type);
      return send(res, 200, page(boards, Number(q.startAt || 0), Number(q.maxResults || 50), BOARD_PAGE_CAP));
    }
    if ((m = url.pathname.match(/^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/))) {
      if (m[1] === '3' || m[1] === '5') return send(res, 400, { errorMessages: ['The board does not support sprints'] });
      let sprints = state.scenario === 'no_active' ? [] : (d.sprints[m[1]] || []);
      // shared_sprint: board 2's filter also includes Payments Sprint 4 (origin board 1)
      if (state.scenario === 'shared_sprint' && m[1] === '2') sprints = [d.sprints[1][0], ...d.sprints[2]];
      if (m[1] === '4') sprints = [{ ...d.sprints[2][0], id: 41, name: 'Web Sprint 2', boardId: 4, originBoardId: 4 }];
      if (q.state) sprints = sprints.filter((s) => q.state.split(',').includes(s.state));
      return send(res, 200, page(sprints, Number(q.startAt || 0), Number(q.maxResults || 50), BOARD_PAGE_CAP));
    }
    // used by scripts/live-check.js
    if (url.pathname === '/rest/api/3/myself') return send(res, 200, { accountId: 'acc-mock', displayName: 'Mock User', timeZone: 'Asia/Kolkata' });
    if (url.pathname === '/rest/api/3/field') return send(res, 200, [
      { id: 'summary', name: 'Summary' }, { id: 'customfield_10016', name: 'Story point estimate' }, { id: 'customfield_10021', name: 'Flagged' }]);
    if (url.pathname === '/rest/api/3/search/jql') {
      const sm = String(q.jql || '').match(/sprint\s*=\s*(\d+)/i);
      if (!sm) return send(res, 400, { errorMessages: ['mock: jql must be "sprint = <id>"'] });
      let issues = state.scenario === 'empty_sprint' ? [] : (d.issues[sm[1] === '41' ? 21 : sm[1]] || []);
      const offset = Number(q.nextPageToken ? Buffer.from(q.nextPageToken, 'base64').toString() : 0);
      const size = Math.min(Number(q.maxResults || 50), ISSUE_PAGE_CAP);
      const slice = issues.slice(offset, offset + size);
      const isLast = offset + size >= issues.length;
      const out = { issues: slice, isLast };
      if (!isLast) out.nextPageToken = Buffer.from(String(offset + size)).toString('base64');
      return send(res, 200, out);
    }
    return send(res, 404, { errorMessages: [`mock: no route ${url.pathname}`] });
  });
});

server.listen(PORT, () => console.log(`mock jira on :${PORT}`));
