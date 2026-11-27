// Validate Config: run by the Config node before anything touches Jira or email,
// and by scripts/build-workflows.js at build time. Pure function, no n8n globals.
//
// Errors stop the run (the Error Workflow then emails the admins with the list),
// warnings are reported in the run summary.

const PLACEHOLDER_HOSTS = ['your-team.atlassian.net', 'your-domain.com', 'example.atlassian.net'];
const BOARD_TYPES = ['scrum', 'simple', 'kanban'];
const FIELD_ID = /^[A-Za-z_][A-Za-z0-9_]*$/; // customfield_10016, duedate, ...
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

// IANA name -> canonical name, or null if the runtime does not know the zone.
function canonicalTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return null;
  // Region/City names (or UTC) only: abbreviations such as IST or EST are ambiguous
  // (IST = India, Israel or Ireland) even where the runtime happens to accept them.
  if (!/^(UTC|GMT|Etc\/[A-Za-z0-9+-]+|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/.test(tz.trim())) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }).resolvedOptions().timeZone;
  } catch (e) {
    return null;
  }
}

// Minimal URL parser: the n8n Code-node sandbox has no global URL class.
function parseUrl(s) {
  const m = /^([a-z][a-z0-9+.-]*:)\/\/(\[[0-9a-f:]+\]|[^/?#:\s[\]]+)(?::(\d{1,5}))?(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i.exec(String(s));
  if (!m) return null;
  return { protocol: m[1].toLowerCase(), hostname: m[2].toLowerCase().replace(/^\[|\]$/g, ''), port: m[3] || '', pathname: m[4] || '', search: m[5] || '' };
}

// "Name <addr@x.y>" or "addr@x.y" -> addr@x.y, or null
function emailAddress(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/<([^<>]+)>\s*$/);
  const addr = (m ? m[1] : s).trim();
  return EMAIL.test(addr) ? addr : null;
}

function validateConfig(cfg, opts = {}) {
  const errors = [];
  const warnings = [];
  const c = cfg || {};

  const int = (key, min, max) => {
    const v = c[key];
    if (v === undefined || v === null || v === '') return errors.push(`${key} is required`);
    if (typeof v !== 'number' || !Number.isInteger(v)) return errors.push(`${key} must be a whole number (got ${JSON.stringify(v)})`);
    if (v < min || (max != null && v > max)) errors.push(`${key} must be between ${min} and ${max == null ? 'any' : max} (got ${v})`);
  };

  // --- Jira site
  if (typeof c.jiraBaseUrl !== 'string' || !c.jiraBaseUrl.trim()) {
    errors.push('jiraBaseUrl is required (e.g. https://your-site.atlassian.net)');
  } else {
    const u = parseUrl(c.jiraBaseUrl.trim());
    if (!u) errors.push(`jiraBaseUrl is not a valid URL (${c.jiraBaseUrl}); expected e.g. https://your-site.atlassian.net`);
    if (u) {
      const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
      if (!['https:', 'http:'].includes(u.protocol)) errors.push('jiraBaseUrl must start with https://');
      else if (u.protocol === 'http:' && !local) warnings.push('jiraBaseUrl uses http://; Jira Cloud requires https://');
      if (PLACEHOLDER_HOSTS.includes(u.hostname)) errors.push(`jiraBaseUrl is still the placeholder (${u.hostname}); set it to your Jira site`);
      if (u.pathname.replace(/\/+$/, '') !== '' || u.search) errors.push('jiraBaseUrl must be the site root only, without a path or query (e.g. https://your-site.atlassian.net)');
    }
  }

  // --- boards
  if (!Array.isArray(c.boardIds)) errors.push('boardIds must be a list of board ids ([] = all boards)');
  else {
    const bad = c.boardIds.filter((b) => !(Number.isInteger(Number(b)) && Number(b) > 0));
    if (bad.length) errors.push(`boardIds contains invalid ids: ${bad.map((b) => JSON.stringify(b)).join(', ')}`);
  }
  if (!Array.isArray(c.boardTypes) || !c.boardTypes.length) errors.push('boardTypes must be a non-empty list (e.g. ["scrum","simple"])');
  else {
    const bad = c.boardTypes.filter((t) => !BOARD_TYPES.includes(String(t)));
    if (bad.length) errors.push(`boardTypes has unknown types: ${bad.join(', ')} (allowed: ${BOARD_TYPES.join(', ')})`);
  }

  // --- timezone (calendar for "today", overdue and the digest date)
  const tz = canonicalTimeZone(c.timezone);
  if (!tz) errors.push(`timezone is not a valid IANA time zone (got ${JSON.stringify(c.timezone)}; e.g. "Asia/Kolkata", not "IST")`);

  // The Schedule trigger fires in the WORKFLOW timezone (Settings -> Timezone, or the
  // instance's GENERIC_TIMEZONE), while the digest logic uses Config.timezone. If they
  // differ, "09:00" and "today" refer to different calendars.
  if (opts.workflowTimezone !== undefined) {
    const wtz = canonicalTimeZone(opts.workflowTimezone);
    if (!opts.workflowTimezone) warnings.push('could not read the workflow timezone; check Settings -> Timezone matches Config.timezone');
    else if (!wtz) errors.push(`workflow timezone ${JSON.stringify(opts.workflowTimezone)} is not a valid IANA time zone`);
    else if (tz && wtz !== tz) {
      errors.push(`workflow timezone is ${opts.workflowTimezone} but Config.timezone is ${c.timezone}; set Workflow Settings -> Timezone to ${c.timezone} (or change Config.timezone) so the schedule and the digest date use the same calendar`);
    }
  }

  // --- business rules
  int('staleInProgressDays', 0, 365);
  int('overloadThreshold', 1, 1000);
  int('criticalBlockedCount', 1, 1000);
  int('criticalBehindPct', 1, 100);
  int('atRiskBehindPct', 1, 100);
  if (Number.isInteger(c.atRiskBehindPct) && Number.isInteger(c.criticalBehindPct) && c.atRiskBehindPct > c.criticalBehindPct) {
    errors.push(`atRiskBehindPct (${c.atRiskBehindPct}) must not be greater than criticalBehindPct (${c.criticalBehindPct})`);
  }
  if (!['issues', 'points', 'both'].includes(c.progressBasis)) errors.push(`progressBasis must be "issues", "points" or "both" (got ${JSON.stringify(c.progressBasis)})`);
  int('minPointsCoveragePct', 0, 100);
  if (['points', 'both'].includes(c.progressBasis) && !c.storyPointsField) warnings.push(`progressBasis is "${c.progressBasis}" but storyPointsField is empty; issue count is used`);
  if (!['all', 'origin'].includes(c.sprintBoardRouting)) errors.push(`sprintBoardRouting must be "all" or "origin" (got ${JSON.stringify(c.sprintBoardRouting)})`);
  if (!Array.isArray(c.blockedStatusNames) || c.blockedStatusNames.some((s) => typeof s !== 'string' || !s.trim())) {
    errors.push('blockedStatusNames must be a list of status names (e.g. ["Blocked"])');
  } else if (!c.blockedStatusNames.length) warnings.push('blockedStatusNames is empty; only the Flagged field and "is blocked by" links mark issues as Blocked');
  for (const key of ['flaggedField', 'storyPointsField']) {
    const v = c[key];
    if (v === undefined || v === null || v === '') { if (key === 'flaggedField') warnings.push('flaggedField is empty; flagged issues will not count as Blocked'); continue; }
    if (typeof v !== 'string' || !FIELD_ID.test(v)) errors.push(`${key} must be a Jira field id like customfield_10016 (got ${JSON.stringify(v)})`);
  }

  // --- Jira API
  int('pageSize', 1, 100); // Jira caps maxResults at 100 for these endpoints
  int('maxPages', 1, 1000);
  int('jiraMaxRetries', 0, 10);
  int('jiraRetryBaseDelayMs', 100, 60000);
  int('jiraRetryMaxDelayMs', 1000, 60000); // >65 s would turn the Wait node into a persisted wait
  int('jiraPageIntervalMs', 0, 10000);
  if (Number.isInteger(c.jiraRetryBaseDelayMs) && Number.isInteger(c.jiraRetryMaxDelayMs) && c.jiraRetryBaseDelayMs > c.jiraRetryMaxDelayMs) {
    errors.push('jiraRetryBaseDelayMs must not be greater than jiraRetryMaxDelayMs');
  }

  // --- delivery
  const from = emailAddress(c.fromEmail);
  if (!from) errors.push(`fromEmail must be an address like "Sprint Digest <digest@your-company.com>" (got ${JSON.stringify(c.fromEmail)})`);
  else if (PLACEHOLDER_HOSTS.includes(from.split('@')[1].toLowerCase())) errors.push(`fromEmail is still the placeholder (${from}); set your sender address`);
  int('staleClaimMinutes', 1, 1440);
  int('maxListItems', 1, 200);

  return { errors, warnings };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { validateConfig, canonicalTimeZone, emailAddress, parseUrl };
