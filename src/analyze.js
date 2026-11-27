// Analyze Sprints: the core business logic of the Jira Sprint Health Monitor.
// Pure function (no n8n globals) so it can be unit-tested with plain Node and
// inlined into the "Analyze Sprints" Code node by scripts/build-workflows.js.

const DAY_MS = 864e5;

// Jira returns offsets like "+0530"; JS Date wants "+05:30".
function parseJiraDate(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? null : t;
}

// Calendar date (YYYY-MM-DD) as seen in the configured timezone.
function localDate(ms, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

function daysBetweenDates(a, b) {
  // whole calendar days from date string a to date string b (b - a)
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

function categoryOf(fields) {
  const key = fields && fields.status && fields.status.statusCategory && fields.status.statusCategory.key;
  if (key === 'done') return 'done';
  if (key === 'indeterminate') return 'inprogress';
  return 'todo';
}

function blockedReason(fields, config) {
  const statusName = ((fields.status && fields.status.name) || '').toLowerCase();
  const names = (config.blockedStatusNames || []).map((s) => String(s).toLowerCase());
  if (names.includes(statusName)) return 'status';
  const flag = config.flaggedField ? fields[config.flaggedField] : null;
  if (flag && (!Array.isArray(flag) || flag.length > 0)) return 'flagged';
  for (const link of fields.issuelinks || []) {
    const inward = link.type && String(link.type.inward || '').toLowerCase();
    const other = link.inwardIssue;
    if (inward === 'is blocked by' && other) {
      const otherCat = other.fields && other.fields.status && other.fields.status.statusCategory
        && other.fields.status.statusCategory.key;
      if (otherCat !== 'done') return 'blocked by ' + other.key;
    }
  }
  return null;
}

function normalizeIssue(raw, ctx) {
  const { config, nowMs, today } = ctx;
  const f = raw.fields || {};
  const category = categoryOf(f);
  const isDone = category === 'done';
  const blocked = isDone ? null : blockedReason(f, config);
  const catChanged = parseJiraDate(f.statuscategorychangedate);
  const inProgressDays = category === 'inprogress' && catChanged != null
    ? (nowMs - catChanged) / DAY_MS : null;
  const due = f.duedate || null; // date-only "YYYY-MM-DD"
  const overdueDays = due && !isDone && due < today ? daysBetweenDates(due, today) : 0;
  const rawPoints = config.storyPointsField ? f[config.storyPointsField] : null;
  const estimated = typeof rawPoints === 'number' && Number.isFinite(rawPoints);
  const points = estimated ? rawPoints : 0;
  return {
    key: raw.key,
    summary: f.summary || '',
    status: (f.status && f.status.name) || 'Unknown',
    category,
    bucket: blocked ? 'Blocked' : ({ todo: 'To Do', inprogress: 'In Progress', done: 'Done' })[category],
    // accountId is the stable identity; display names are not unique (two "Rahul"s)
    assigneeId: f.assignee ? (f.assignee.accountId || f.assignee.displayName || null) : null,
    assignee: f.assignee ? (f.assignee.displayName || f.assignee.accountId) : null,
    priority: (f.priority && f.priority.name) || '',
    due,
    points,
    estimated,
    inProgressDays: inProgressDays == null ? null : Math.round(inProgressDays * 10) / 10,
    flags: {
      stale: inProgressDays != null && inProgressDays > config.staleInProgressDays && !blocked,
      overdue: overdueDays > 0,
      unassigned: !f.assignee && !isDone,
      blocked: !!blocked,
    },
    overdueDays,
    blockedReason: blocked,
  };
}

// Two different people can share a display name. Group by accountId everywhere and,
// only when a name is ambiguous within the sprint, show "Name (…1a2b)" so the
// digest tells them apart.
function labelAssignees(issues) {
  const idsByName = new Map();
  for (const i of issues) {
    if (!i.assigneeId) continue;
    if (!idsByName.has(i.assignee)) idsByName.set(i.assignee, new Set());
    idsByName.get(i.assignee).add(i.assigneeId);
  }
  for (const i of issues) {
    if (i.assigneeId && idsByName.get(i.assignee).size > 1) {
      i.assignee = `${i.assignee} (…${String(i.assigneeId).slice(-4)})`;
    }
  }
}

// Progress used for health: issue count, story points, or the lower of the two.
// Story points only count when enough of the sprint is estimated; otherwise a
// sprint with one 13-point story done would look 90% complete.
function progressOf(m, config) {
  const basis = config.progressBasis || 'both';
  const minCoverage = config.minPointsCoveragePct == null ? 50 : config.minPointsCoveragePct;
  const pointsUsable = m.pointsTotal > 0 && m.pointsCoveragePct >= minCoverage;
  if (basis === 'issues' || !pointsUsable) {
    return { progressPct: m.completionPct, progressBy: 'issues', pointsUsable };
  }
  if (basis === 'points' || m.pointsPct < m.completionPct) {
    return { progressPct: m.pointsPct, progressBy: 'story points', pointsUsable };
  }
  return { progressPct: m.completionPct, progressBy: 'issues', pointsUsable };
}

function healthOf(m, config) {
  const reasons = [];
  if (m.total === 0) return { health: 'Empty', reasons: ['Sprint has no issues'] };
  const progress = m.progressPct == null ? m.completionPct : m.progressPct;
  const behind = m.elapsedPct - progress;
  const behindTxt = `${behind}% behind schedule (by ${m.progressBy || 'issues'})`;
  if (m.blocked >= config.criticalBlockedCount) reasons.push(`${m.blocked} issues blocked`);
  if (behind >= config.criticalBehindPct) reasons.push(behindTxt);
  if (reasons.length) return { health: 'Critical', reasons };
  if (m.blocked > 0) reasons.push(`${m.blocked} blocked`);
  if (m.overdue > 0) reasons.push(`${m.overdue} overdue`);
  if (behind >= config.atRiskBehindPct) reasons.push(behindTxt);
  if (m.overloaded > 0) reasons.push(`${m.overloaded} overloaded member(s)`);
  if (reasons.length) return { health: 'At Risk', reasons };
  return { health: 'Healthy', reasons: ['On track'] };
}

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

function analyzeSprint(sprint, rawIssues, ctx) {
  const { config, nowMs, today, history, recipients, runId, dryRun, force } = ctx;
  // de-duplicate issues by key (defensive against overlapping pages)
  const seen = new Set();
  const issues = [];
  for (const r of rawIssues) {
    if (!r || !r.key || seen.has(r.key)) continue;
    seen.add(r.key);
    issues.push(normalizeIssue(r, ctx));
  }
  labelAssignees(issues);
  const count = (fn) => issues.filter(fn).length;
  const startMs = parseJiraDate(sprint.startDate);
  const endMs = parseJiraDate(sprint.endDate);
  const elapsedPct = startMs && endMs && endMs > startMs
    ? Math.max(0, Math.min(100, Math.round(((nowMs - startMs) / (endMs - startMs)) * 100))) : 0;
  const daysLeft = endMs ? Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS)) : null;

  // workload per assignee (unresolved only), keyed by accountId, not display name
  const byPerson = {};
  for (const i of issues) {
    if (i.category === 'done' || !i.assigneeId) continue;
    const p = byPerson[i.assigneeId]
      || (byPerson[i.assigneeId] = { accountId: i.assigneeId, name: i.assignee, open: 0, inProgress: 0, blocked: 0, points: 0 });
    p.open += 1;
    if (i.bucket === 'In Progress') p.inProgress += 1;
    if (i.bucket === 'Blocked') p.blocked += 1;
    p.points += i.points;
  }
  const workload = Object.values(byPerson)
    .map((p) => ({ ...p, overloaded: p.open >= config.overloadThreshold }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId));

  const m = {
    total: issues.length,
    todo: count((i) => i.bucket === 'To Do'),
    inProgress: count((i) => i.bucket === 'In Progress'),
    done: count((i) => i.bucket === 'Done'),
    blocked: count((i) => i.bucket === 'Blocked'),
    stale: count((i) => i.flags.stale),
    overdue: count((i) => i.flags.overdue),
    unassigned: count((i) => i.flags.unassigned),
    overloaded: workload.filter((p) => p.overloaded).length,
    pointsTotal: issues.reduce((s, i) => s + i.points, 0),
    pointsDone: issues.filter((i) => i.category === 'done').reduce((s, i) => s + i.points, 0),
    estimated: count((i) => i.estimated),
    elapsedPct,
    daysLeft,
  };
  m.completionPct = pct(m.done, m.total);
  m.pointsPct = pct(m.pointsDone, m.pointsTotal);
  m.pointsCoveragePct = pct(m.estimated, m.total);
  Object.assign(m, progressOf(m, config));
  const { health, reasons } = healthOf(m, config);

  // previous sent snapshot for this sprint (strictly before today) -> day-over-day delta
  const digestKey = `${sprint.id}:${today}`;
  const prev = history
    .filter((r) => String(r.sprint_id) === String(sprint.id) && r.status === 'sent' && r.run_date < today)
    .sort((a, b) => (a.run_date < b.run_date ? 1 : -1))[0] || null;
  const delta = prev ? {
    since: prev.run_date,
    completionPct: m.completionPct - Number(prev.completion_pct || 0),
    done: m.done - Number(prev.done || 0),
    blocked: m.blocked - Number(prev.blocked || 0),
    pointsPct: Number(prev.points_total) > 0 && m.pointsTotal > 0
      ? m.pointsPct - pct(Number(prev.points_done || 0), Number(prev.points_total)) : null,
  } : null;

  // dedupe decision against today's rows (the claim step re-checks under race)
  const todays = history.filter((r) => r.digest_key === digestKey);
  const staleClaimMs = config.staleClaimMinutes * 60e3;
  // A sprint can show on several boards (its origin board plus any board whose
  // filter includes its issues). Route to recipients of ANY of those boards, or
  // only the origin board when Config.sprintBoardRouting = 'origin'.
  const boards = (Array.isArray(sprint.boards) && sprint.boards.length)
    ? sprint.boards : (sprint.boardId ? [{ id: sprint.boardId, name: '' }] : []);
  const routeBoards = (config.sprintBoardRouting === 'origin' && sprint.boardId ? [sprint.boardId] : boards.map((b) => b.id))
    .map((id) => String(Number(id)));
  const to = recipients
    .filter((r) => r.active !== false && (r.role || 'digest') === 'digest')
    .filter((r) => !Number(r.board_id) || routeBoards.includes(String(Number(r.board_id))))
    .map((r) => String(r.email).trim()).filter(Boolean);
  const uniqueTo = [...new Set(to)];
  let action = 'send';
  if (!uniqueTo.length) action = 'skip_no_recipients';
  else if (!force && todays.some((r) => r.status === 'sent')) action = 'skip_already_sent';
  else if (!force && todays.some((r) => r.status === 'pending'
    && nowMs - (parseJiraDate(r.claimed_at) || 0) < staleClaimMs)) action = 'skip_in_flight';
  if (dryRun && action === 'send') action = 'preview';

  const lists = {
    blocked: issues.filter((i) => i.flags.blocked),
    stale: issues.filter((i) => i.flags.stale).sort((a, b) => b.inProgressDays - a.inProgressDays),
    overdue: issues.filter((i) => i.flags.overdue).sort((a, b) => b.overdueDays - a.overdueDays),
    unassigned: issues.filter((i) => i.flags.unassigned),
  };

  const d = {
    digest_key: digestKey,
    run_id: runId,
    run_date: today,
    sprint_id: Number(sprint.id),
    sprint_name: sprint.name || `Sprint ${sprint.id}`,
    board_id: Number(sprint.boardId) || 0,
    board_ids: boards.map((b) => Number(b.id)),
    boards,
    sprint_goal: sprint.goal || '',
    sprint_start: sprint.startDate || '',
    sprint_end: sprint.endDate || '',
    health,
    health_reasons: reasons,
    metrics: m,
    workload,
    lists,
    delta,
    recipients: uniqueTo,
    action,
  };
  const email = renderEmail(d, config);
  d.subject = email.subject;
  d.html = email.html;
  d.text = email.text;
  return d;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

const HEALTH_COLOR = { Healthy: '#1a7f5a', 'At Risk': '#c26a00', Critical: '#c62828', Empty: '#5f6b7a' };

function renderEmail(d, config) {
  const m = d.metrics;
  const browse = (k) => `${String(config.jiraBaseUrl || '').replace(/\/+$/, '')}/browse/${k}`;
  const sign = (n) => `${n >= 0 ? '+' : ''}${n}`;
  const deltaTxt = d.delta
    ? `${sign(d.delta.completionPct)} pts vs ${d.delta.since}`
      + (d.delta.pointsPct != null && m.pointsUsable ? ` (story points ${sign(d.delta.pointsPct)} pts)` : '')
    : 'first digest for this sprint';
  const pointsTxt = m.pointsTotal
    ? `Story points: ${m.pointsDone}/${m.pointsTotal} done (${m.pointsPct}%), ${m.estimated} of ${m.total} issues estimated.`
      + (m.pointsUsable ? '' : ` Not used for health: under ${config.minPointsCoveragePct == null ? 50 : config.minPointsCoveragePct}% of issues are estimated.`)
    : '';
  const basisTxt = ({ issues: 'issue count', points: 'story points', both: 'the lower of issue-count and story-point progress' })[config.progressBasis || 'both'];
  const boardsTxt = d.boards.length > 1 ? `Boards: ${d.boards.map((b) => b.name || `#${b.id}`).join(', ')}` : '';
  const subject = `[Sprint Health] ${d.sprint_name} | ${d.health} | ${m.completionPct}% done | ${d.run_date}`;

  const issueRows = (list, extra) => list.slice(0, config.maxListItems).map((i) =>
    `<tr><td style="padding:4px 8px;width:90px"><a href="${esc(browse(i.key))}">${esc(i.key)}</a></td>`
    + `<td style="padding:4px 8px">${esc(i.summary)}</td>`
    + `<td style="padding:4px 8px;width:120px">${esc(i.assignee || 'Unassigned')}</td>`
    + `<td style="padding:4px 8px;width:170px">${esc(extra(i))}</td></tr>`).join('');
  const section = (title, list, extra) => list.length
    ? `<h3 style="margin:18px 0 6px;font-size:15px">${esc(title)} (${list.length})</h3>`
      + `<table style="border-collapse:collapse;font-size:13px;width:100%;table-layout:fixed">${issueRows(list, extra)}</table>`
      + (list.length > config.maxListItems ? `<p style="font-size:12px;color:#5f6b7a">+${list.length - config.maxListItems} more</p>` : '')
    : '';
  const work = d.workload.map((p) =>
    `<tr><td style="padding:4px 8px">${esc(p.name)}${p.overloaded ? ' <b style="color:#c62828">(overloaded)</b>' : ''}</td>`
    + `<td style="padding:4px 8px;text-align:right">${p.open}</td><td style="padding:4px 8px;text-align:right">${p.inProgress}</td>`
    + `<td style="padding:4px 8px;text-align:right">${p.blocked}</td></tr>`).join('');

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1b2430;max-width:720px">
<h2 style="margin:0 0 4px">${esc(d.sprint_name)}: <span style="color:${HEALTH_COLOR[d.health]}">${esc(d.health)}</span></h2>
<p style="margin:0 0 12px;color:#5f6b7a">Daily sprint health digest for ${esc(d.run_date)} (${esc(config.timezone)}). ${esc(d.health_reasons.join('; '))}.</p>
${d.sprint_goal ? `<p style="margin:0 0 12px"><b>Goal:</b> ${esc(d.sprint_goal)}</p>` : ''}
<table style="border-collapse:collapse;font-size:14px;margin-bottom:8px"><tr>
<td style="padding:6px 12px;background:#eef2f7"><b>${m.completionPct}%</b> of issues done (${m.done}/${m.total})</td>
${m.pointsTotal ? `<td style="padding:6px 12px;background:#eef2f7"><b>${m.pointsPct}%</b> of story points (${m.pointsDone}/${m.pointsTotal})</td>` : ''}
<td style="padding:6px 12px;background:#eef2f7"><b>${m.elapsedPct}%</b> of sprint elapsed${m.daysLeft != null ? `, ${m.daysLeft} day(s) left` : ''}</td>
<td style="padding:6px 12px;background:#eef2f7">${esc(deltaTxt)}</td></tr></table>
<table style="border-collapse:collapse;font-size:14px"><tr>
<td style="padding:6px 12px">To Do: <b>${m.todo}</b></td><td style="padding:6px 12px">In Progress: <b>${m.inProgress}</b></td>
<td style="padding:6px 12px">Done: <b>${m.done}</b></td><td style="padding:6px 12px">Blocked: <b>${m.blocked}</b></td></tr></table>
<p style="font-size:13px;color:#5f6b7a">Health compares sprint time elapsed with ${esc(basisTxt)} (${esc(m.progressBy)}: ${m.progressPct}%). ${esc(pointsTxt)}${boardsTxt ? ' ' + esc(boardsTxt) + '.' : ''}</p>
${section('Blocked', d.lists.blocked, (i) => i.blockedReason)}
${section(`In Progress for more than ${config.staleInProgressDays} days`, d.lists.stale, (i) => `${i.inProgressDays} days`)}
${section('Overdue', d.lists.overdue, (i) => `due ${i.due} (${i.overdueDays}d late)`)}
${section('Unassigned', d.lists.unassigned, (i) => i.status)}
${d.workload.length ? `<h3 style="margin:18px 0 6px;font-size:15px">Workload (unresolved issues)</h3>
<table style="border-collapse:collapse;font-size:13px"><tr style="color:#5f6b7a"><td style="padding:4px 8px">Member</td><td style="padding:4px 8px">Open</td><td style="padding:4px 8px">In progress</td><td style="padding:4px 8px">Blocked</td></tr>${work}</table>` : ''}
<p style="margin-top:20px;font-size:11px;color:#8a94a3">Generated by the n8n Jira Sprint Health Monitor. Run ${esc(d.run_id)}. Overload threshold: ${config.overloadThreshold} open issues.</p>
</div>`;

  const line = (title, list, extra) => list.length
    ? `\n${title} (${list.length}):\n` + list.slice(0, config.maxListItems).map((i) => `  - ${i.key} ${i.summary} [${i.assignee || 'Unassigned'}] ${extra(i)}`).join('\n')
    : '';
  const text = `${d.sprint_name}: ${d.health} (${d.health_reasons.join('; ')})
Date: ${d.run_date} (${config.timezone})
Completion: ${m.completionPct}% (${m.done}/${m.total}); sprint elapsed ${m.elapsedPct}%; ${deltaTxt}${pointsTxt ? '\n' + pointsTxt : ''}
Health basis: ${basisTxt} (${m.progressBy}: ${m.progressPct}%)${boardsTxt ? '\n' + boardsTxt : ''}
To Do ${m.todo} | In Progress ${m.inProgress} | Done ${m.done} | Blocked ${m.blocked}`
    + line('Blocked', d.lists.blocked, (i) => i.blockedReason)
    + line(`In Progress > ${config.staleInProgressDays} days`, d.lists.stale, (i) => `${i.inProgressDays}d`)
    + line('Overdue', d.lists.overdue, (i) => `due ${i.due}`)
    + line('Unassigned', d.lists.unassigned, (i) => i.status)
    + (d.workload.length ? '\n\nWorkload: ' + d.workload.map((p) => `${p.name} ${p.open}${p.overloaded ? ' (overloaded)' : ''}`).join(', ') : '')
    + '\n';
  return { subject, html, text };
}

// pages: [{ sprint: {id,name,boardId,startDate,endDate,goal}, issues: [...] }]
function analyzeSprints({ pages, config, history, recipients, now, runId, dryRun, force }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const today = localDate(nowMs, config.timezone);
  const bySprint = new Map();
  for (const p of pages) {
    if (!p || !p.sprint) continue;
    const id = String(p.sprint.id);
    if (!bySprint.has(id)) bySprint.set(id, { sprint: p.sprint, issues: [] });
    bySprint.get(id).issues.push(...(p.issues || []));
  }
  const ctx = { config, nowMs, today, history: history || [], recipients: recipients || [], runId, dryRun: !!dryRun, force: !!force };
  return [...bySprint.values()].map(({ sprint, issues }) => analyzeSprint(sprint, issues, ctx));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyzeSprints, parseJiraDate, localDate, normalizeIssue, blockedReason, healthOf, progressOf, renderEmail };
}
