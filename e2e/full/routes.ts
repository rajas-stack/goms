/** Every static route of the GOMS router (src/app/router.tsx), with an expectation about what proves it rendered.
 *  Dynamic routes (/meetings/:id, /bid-tracker/bid/:id, /commercial-calculator/boq/:id, /document-maker/:id) are
 *  covered in their own area specs because they need seeded data. */
export interface RouteSpec {
  path: string;
  /** Visible text expected in the page body. */
  expect: RegExp;
  /** Final pathname after any redirect (defaults to path). */
  finalPath?: string;
}

export const STATIC_ROUTES: RouteSpec[] = [
  { path: '/', expect: /mapped to its ground/i },
  { path: '/map', expect: /mapped to its ground/i },
  { path: '/state/0', expect: /Central Ministries/i },
  { path: '/directory', expect: /Directory/ },
  { path: '/analytics', expect: /Opportunity Pipeline by Stage/ },
  { path: '/insights', expect: /Opportunity Pipeline by Stage/ },
  { path: '/meetings', expect: /Meetings/ },
  { path: '/sales', expect: /Total sales people/ },
  { path: '/sales/roster', expect: /Total sales people/ },
  { path: '/sales/orgchart', expect: /Total sales people/ },
  { path: '/sales/ownership', expect: /Total sales people/ },
  { path: '/teams', expect: /Org Structure/ },
  { path: '/teams/org', expect: /Org Structure/ },
  { path: '/teams/employees', expect: /Employees/ },
  { path: '/teams/sales', expect: /Total sales people/ },
  { path: '/teams/preSales', expect: /Pre-sales/ },
  { path: '/teams/preSales/roster', expect: /Pre-sales/ },
  { path: '/teams/preSales/orgchart', expect: /Pre-sales/ },
  { path: '/teams/preSales/ownership', expect: /Pre-sales/ },
  { path: '/teams/legal', expect: /Legal/ },
  { path: '/teams/bid', expect: /Bid/ },
  { path: '/commercial-calculator', expect: /Commercial Calculator/ },
  { path: '/commercial-calculator/dashboard', expect: /Commercial Calculator/ },
  { path: '/commercial-calculator/create-boq', expect: /Commercial Calculator/ },
  { path: '/commercial-calculator/boq-management', expect: /Commercial Calculator/ },
  { path: '/commercial-calculator/catalog', expect: /Commercial Calculator/ },
  { path: '/commercial-calculator/settings', expect: /Commercial Calculator/ },
  { path: '/bid-tracker', expect: /Master Grid/ },
  { path: '/bid-tracker/pipeline', expect: /Funnel/, finalPath: '/bid-tracker/pipeline/funnel' },
  { path: '/bid-tracker/pipeline/funnel', expect: /Funnel/ },
  { path: '/bid-tracker/pipeline/backup', expect: /Backup/ },
  { path: '/bid-tracker/pipeline/commits', expect: /Commits/ },
  { path: '/bid-tracker/campaign', expect: /Add to Campaign/ },
  { path: '/bid-tracker/master', expect: /Manage columns/ },
  { path: '/bid-tracker/dashboard', expect: /Opportunity dashboard/ },
  { path: '/settings', expect: /System settings/ },
  { path: '/settings/access', expect: /Roles/i },
  { path: '/settings/credentials', expect: /Credentials/ },
  { path: '/settings/integrations', expect: /Integrations/ },
  { path: '/settings/dms', expect: /DMS Settings/ },
  { path: '/settings/dms/new', expect: /DMS|connection|Connect/i },
  { path: '/settings/tender-websites', expect: /Tender websites/i },
  { path: '/settings/document-verifications', expect: /Document verifications/i },
  { path: '/settings/competitors', expect: /Competitors/ },
  { path: '/settings/masters/employees', expect: /Employee Master/i },
  { path: '/documents/accounts', expect: /documents/i },
  { path: '/documents/meetings', expect: /documents/i },
  { path: '/documents/sales', expect: /documents/i },
  { path: '/documents/teams', expect: /documents/i },
  { path: '/documents/commercial', expect: /documents/i },
  { path: '/documents/opportunity', expect: /Opportunity \/ Bid tracker documents/ },
  { path: '/document-maker', expect: /Start a new file/ },
];

/** Legacy redirects. */
export const REDIRECTS: { from: string; to: string }[] = [
  { from: '/admin/access', to: '/settings/access' },
  { from: '/admin/access/users', to: '/settings/access' },
];
