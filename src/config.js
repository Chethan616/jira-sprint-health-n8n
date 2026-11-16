// Config node defaults. Everything site-specific or tunable lives here, so the
// rest of the workflow has no hard-coded values. Secrets do NOT belong here:
// the Jira token and SMTP password live in n8n credentials, and recipient email
// addresses live in the sprint_digest_recipients Data Table.

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
  // API paging
  pageSize: 100,
  maxPages: 50,
  // Delivery
  fromEmail: 'n8n Sprint Digest <sprint-digest@your-domain.com>',
  staleClaimMinutes: 30,           // a 'pending' claim older than this is treated as a crashed run
  maxListItems: 10,                // rows per list in the email
};

if (typeof module !== 'undefined' && module.exports) module.exports = { DEFAULT_CONFIG };
