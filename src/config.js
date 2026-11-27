// Config node defaults. Everything site-specific or tunable lives here, so the
// rest of the workflow has no hard-coded values. Secrets do NOT belong here:
// the Jira token and SMTP password live in n8n credentials, and recipient email
// addresses live in the sprint_digest_recipients Data Table.
// Every key is checked by src/validate.js when the workflow starts.

const DEFAULT_CONFIG = {
  // Jira site root, e.g. https://your-team.atlassian.net (must match the credential's domain)
  jiraBaseUrl: 'https://your-team.atlassian.net',
  // Board ids to monitor. Empty = every sprint-capable board the API user can see.
  boardIds: [],
  // Board types that can have sprints: 'scrum' = company-managed, 'simple' = team-managed.
  // Team-managed Kanban boards are also 'simple'; their "no sprints" 400 is skipped.
  boardTypes: ['scrum', 'simple'],
  // Calendar used for "today", overdue checks and the digest date
  timezone: 'Asia/Kolkata',
  // Business rules
  staleInProgressDays: 3,          // flag issues In Progress longer than this
  overloadThreshold: 5,            // flag members with >= this many unresolved issues
  blockedStatusNames: ['Blocked'], // statuses that count as Blocked (case-insensitive)
  flaggedField: 'customfield_10021',   // Jira "Flagged" (impediment) field
  storyPointsField: 'customfield_10016', // story point estimate field; '' to disable
  criticalBlockedCount: 3,         // >= this many blocked -> Critical
  criticalBehindPct: 30,           // completion behind elapsed time by >= this -> Critical
  atRiskBehindPct: 15,             // ... by >= this -> At Risk
  // Progress used for "behind schedule": 'issues' (Done / total issues), 'points'
  // (done story points / total), or 'both' = whichever is lower (the safer view).
  progressBasis: 'both',
  minPointsCoveragePct: 50,        // story points count only if >= this % of issues are estimated
  // Recipient routing when a sprint shows on several boards:
  // 'all' = recipients of any board that shows the sprint; 'origin' = the sprint's own board only
  sprintBoardRouting: 'all',
  // Jira API: paging and rate limits
  pageSize: 100,                   // maxResults per request (Jira caps it at 100)
  maxPages: 50,                    // safety cap per call
  jiraMaxRetries: 4,               // retries per request on 429 / 5xx / network errors (0 = no retry)
  jiraRetryBaseDelayMs: 1000,      // exponential backoff: base * 2^attempt (+ jitter), when Jira sends no Retry-After
  jiraRetryMaxDelayMs: 30000,      // longest single wait; a longer Retry-After fails the run instead of stalling it
  jiraPageIntervalMs: 200,         // pause between pages
  // Delivery
  fromEmail: 'n8n Sprint Digest <sprint-digest@your-domain.com>',
  staleClaimMinutes: 30,           // a 'pending' claim older than this is treated as a crashed run
  maxListItems: 10,                // rows per list in the email
};

if (typeof module !== 'undefined' && module.exports) module.exports = { DEFAULT_CONFIG };
