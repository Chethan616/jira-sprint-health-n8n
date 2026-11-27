// Jira GET with pagination, Retry-After and exponential backoff.
//
// Used by the "Jira Sprint Health - Jira GET" sub-workflow, which runs this loop:
//   Init -> Request State -> Jira Request (HTTP, full response, never error) -> Evaluate
//        -> done?  yes -> Output
//                  no  -> Wait (waitMs) -> Request State ...
// n8n's built-in HTTP retry waits a fixed time and ignores Retry-After, so the
// retry policy lives here instead, where it is unit-tested:
//   * 2xx                 -> keep the page, request the next one (or finish)
//   * 429 / 503 / any response with Retry-After (or X-RateLimit-Reset)
//                         -> wait exactly what Jira asked for
//   * 408/425/429/5xx and network errors without a hint
//                         -> exponential backoff with jitter: base * 2^attempt, capped
//   * other 4xx           -> fail immediately (retrying a 400/401/403/404 never helps)
// Pure functions, no n8n globals.

const RETRYABLE_STATUS = [408, 425, 429, 500, 502, 503, 504];

function header(headers, name) {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === want) {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

// Milliseconds Jira asked us to wait, or null if it gave no hint.
// Retry-After is either delta-seconds ("2") or an HTTP-date; Atlassian also sends
// X-RateLimit-Reset as an ISO timestamp on 429s.
function retryAfterMs(headers, nowMs) {
  const ra = header(headers, 'retry-after');
  if (ra !== undefined && ra !== null && String(ra).trim() !== '') {
    const s = Number(String(ra).trim());
    if (Number.isFinite(s)) return Math.max(0, Math.round(s * 1000));
    const t = Date.parse(String(ra));
    if (!Number.isNaN(t)) return Math.max(0, t - nowMs);
  }
  const reset = header(headers, 'x-ratelimit-reset');
  if (reset) {
    const t = Date.parse(String(reset));
    if (!Number.isNaN(t)) return Math.max(0, t - nowMs);
  }
  return null;
}

// "Equal jitter": half the exponential step plus a random half, so retries from
// parallel runs spread out but never collapse to ~0 ms.
function backoffMs(attempt, baseMs, maxMs, random = Math.random) {
  const step = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(step / 2 + random() * (step / 2));
}

// spec (from the calling workflow):
//   { path, query, paging: 'startAt'|'nextPageToken'|'none', context, failOnError, cfg }
function initState(spec) {
  const cfg = spec.cfg || {};
  return {
    url: String(cfg.jiraBaseUrl || '').replace(/\/+$/, '') + spec.path,
    path: spec.path,
    query: { ...(spec.query || {}) },
    paging: spec.paging || 'none',
    context: spec.context === undefined ? null : spec.context,
    failOnError: spec.failOnError !== false,
    maxPages: Number(cfg.maxPages) || 50,
    maxRetries: cfg.jiraMaxRetries == null ? 4 : Number(cfg.jiraMaxRetries),
    baseDelayMs: Number(cfg.jiraRetryBaseDelayMs) || 1000,
    maxDelayMs: Number(cfg.jiraRetryMaxDelayMs) || 30000,
    pageIntervalMs: cfg.jiraPageIntervalMs == null ? 200 : Number(cfg.jiraPageIntervalMs),
    cursor: null,
    attempt: 0,
    requests: 0,
    retries: 0,
    waitedMs: 0,
    pages: [],
    truncated: false,
    error: null,
  };
}

// What the HTTP node should call next.
function requestFor(state) {
  const query = { ...state.query };
  if (state.cursor !== null && state.cursor !== undefined) {
    if (state.paging === 'startAt') query.startAt = state.cursor;
    if (state.paging === 'nextPageToken') query.nextPageToken = state.cursor;
  }
  return { url: state.url, query };
}

function parseBody(body) {
  if (typeof body !== 'string') return body || {};
  try { return JSON.parse(body); } catch (e) { return { raw: body.slice(0, 500) }; }
}

function describe(res, status) {
  if (status == null) {
    const e = (res && res.error) || {};
    return e.message || e.description || e.code || 'network error';
  }
  const b = parseBody(res.body);
  const msgs = [].concat(b.errorMessages || [], b.message || [], b.errors ? Object.values(b.errors) : [], b.raw || []);
  return `HTTP ${status}${msgs.length ? ': ' + msgs.join('; ') : (res.statusMessage ? ' ' + res.statusMessage : '')}`;
}

// res: the HTTP node's output item json, either
//   { statusCode, headers, body }  (full response, neverError)  or  { error: {...} } (network error)
// returns { action: 'continue' | 'done', waitMs, state }
function evaluate(state, res, { nowMs = Date.now(), random = Math.random } = {}) {
  const s = { ...state, requests: state.requests + 1 };
  const status = res && typeof res.statusCode === 'number' ? res.statusCode : null;

  if (status !== null && status >= 200 && status < 300) {
    const body = parseBody(res.body);
    s.pages = [...s.pages, body];
    s.attempt = 0;
    let next = null;
    if (s.paging === 'startAt' && body.isLast === false) {
      const step = Number(body.maxResults) || (Array.isArray(body.values) ? body.values.length : 0);
      if (step > 0) next = Number(body.startAt || 0) + step;
    } else if (s.paging === 'nextPageToken' && body.nextPageToken && body.isLast !== true) {
      // a repeated token would loop forever; treat it as the last page
      if (body.nextPageToken !== s.cursor) next = body.nextPageToken;
    }
    if (next === null) return { action: 'done', waitMs: 0, state: s };
    if (s.pages.length >= s.maxPages) { s.truncated = true; return { action: 'done', waitMs: 0, state: s }; }
    s.cursor = next;
    return { action: 'continue', waitMs: s.pageIntervalMs, state: s };
  }

  const reason = describe(res, status);
  const retryable = status === null || RETRYABLE_STATUS.includes(status);
  const hinted = status === null ? null : retryAfterMs(res.headers, nowMs);
  const fail = (message) => {
    s.error = { statusCode: status, message, attempts: s.attempt + 1 };
    return { action: 'done', waitMs: 0, state: s };
  };

  if (!retryable) return fail(`Jira GET ${s.path} failed: ${reason}`);
  if (s.attempt >= s.maxRetries) return fail(`Jira GET ${s.path} failed after ${s.attempt + 1} attempts: ${reason}`);
  if (hinted !== null && hinted > s.maxDelayMs) {
    return fail(`Jira GET ${s.path} rate-limited: Jira asked to retry after ${Math.ceil(hinted / 1000)} s, more than jiraRetryMaxDelayMs (${s.maxDelayMs} ms). ${reason}`);
  }
  const waitMs = hinted !== null ? hinted : backoffMs(s.attempt, s.baseDelayMs, s.maxDelayMs, random);
  s.attempt += 1;
  s.retries += 1;
  s.waitedMs += waitMs;
  s.lastRetry = { reason, waitMs, source: hinted !== null ? 'retry-after' : 'backoff' };
  return { action: 'continue', waitMs, state: s };
}

// Items returned to the calling workflow: one per page (same shape as Jira's
// response, plus _context and _jira stats), or a single { error } item when the
// caller asked for failOnError=false.
function outputItems(state) {
  const meta = { requests: state.requests, retries: state.retries, waitedMs: state.waitedMs, pages: state.pages.length, truncated: state.truncated };
  if (state.error) {
    if (state.failOnError) throw new Error(state.error.message);
    return [{ error: state.error, _context: state.context, _jira: meta }];
  }
  // an endpoint that returns a bare JSON array (e.g. /rest/api/3/field) becomes { values: [...] }
  return state.pages.map((body) => ({ ...(Array.isArray(body) ? { values: body } : body), _context: state.context, _jira: meta }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { retryAfterMs, backoffMs, initState, requestFor, evaluate, outputItems, RETRYABLE_STATUS };
}
