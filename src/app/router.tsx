import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { RequireSignIn } from './RequireSignIn'
import { GlobalErrorScreen } from './routes/GlobalErrorScreen'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'
import { RequireAccess } from '@/components/NoAccess'
import { RouteFallback } from '@/components/RouteFallback'
import { NAV_MODULES } from '@/lib/routeModules'
import { RequireNode } from '@/lib/rbacTree/RequireNode'
import { ROUTE_NODES, rbacHandle } from './routeNodes'
import { MASTER_PAGE_LIST } from '@/features/masters/mastersList'
import type { ReactNode } from 'react'

const Home = lazy(() => import('./routes/Home').then((m) => ({ default: m.Home })))
const Landing = lazy(() => import('./routes/Landing').then((m) => ({ default: m.Landing })))
const StateWorkspace = lazy(() => import('./routes/StateWorkspace').then((m) => ({ default: m.StateWorkspace })))
const Insights = lazy(() => import('./routes/Insights').then((m) => ({ default: m.Insights })))
const VisualLibraryPage = lazy(() => import('@/features/insights-studio/pages/VisualLibraryPage').then((m) => ({ default: m.VisualLibraryPage })))
const VisualBuilderPage = lazy(() => import('@/features/insights-studio/pages/VisualBuilderPage').then((m) => ({ default: m.VisualBuilderPage })))
const ReportsPage = lazy(() => import('@/features/insights-studio/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const ReportPage = lazy(() => import('@/features/insights-studio/pages/ReportPage').then((m) => ({ default: m.ReportPage })))
const DataSourcesPage = lazy(() => import('@/features/insights-studio/pages/DataSourcesPage').then((m) => ({ default: m.DataSourcesPage })))
const Meetings = lazy(() => import('./routes/Meetings').then((m) => ({ default: m.Meetings })))
const MeetingDetails = lazy(() => import('./routes/MeetingDetails').then(m => ({ default: m.MeetingDetails })))
const CredentialsSettingsPage = lazy(() => import('./routes/CredentialsSettingsPage').then(m => ({ default: m.CredentialsSettingsPage })))
const IntegrationsSettingsPage = lazy(() => import('./routes/IntegrationsSettingsPage').then(m => ({ default: m.IntegrationsSettingsPage })))
const SettingsPage = lazy(() => import('./routes/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const DmsSettingsPage = lazy(() => import('./routes/DmsSettingsPage').then((m) => ({ default: m.DmsSettingsPage })))
const DmsConnectionPage = lazy(() => import('./routes/DmsConnectionPage').then((m) => ({ default: m.DmsConnectionPage })))
const DmsDocumentsPage = lazy(() => import('./routes/DmsDocumentsPage').then((m) => ({ default: m.DmsDocumentsPage })))
const TenderWebsitesSettingsPage = lazy(() =>
  import('./routes/TenderWebsitesSettingsPage').then((m) => ({ default: m.TenderWebsitesSettingsPage })),
)
const DocumentVerificationsSettingsPage = lazy(() =>
  import('./routes/TenderWebsitesSettingsPage').then((m) => ({ default: m.DocumentVerificationsSettingsPage })),
)
const CompetitorsSettingsPage = lazy(() =>
  import('./routes/CompetitorsSettingsPage').then((m) => ({ default: m.CompetitorsSettingsPage })),
)
const MasterSettingsPage = lazy(() => import('./routes/MasterSettingsPage').then((m) => ({ default: m.MasterSettingsPage })))
const EmployeeMasterSettingsPage = lazy(() =>
  import('./routes/SettingsEmployeeMasterPage').then((m) => ({ default: m.SettingsEmployeeMasterPage })),
)
const SalesWorkspace = lazy(() => import('./routes/SalesWorkspace').then((m) => ({ default: m.SalesWorkspace })))
const TeamsWorkspace = lazy(() => import('./routes/TeamsWorkspace').then((m) => ({ default: m.TeamsWorkspace })))
const CommercialCalculatorWorkspace = lazy(() =>
  import('@/modules/commercial-calculator/CommercialCalculatorWorkspace').then((m) => ({ default: m.CommercialCalculatorWorkspace })),
)
const OpportunityWorkspace = lazy(() =>
  import('@/modules/bid-tracker/OpportunityWorkspace').then((m) => ({ default: m.OpportunityWorkspace })),
)
const BidDetailWorkspace = lazy(() =>
  import('@/modules/bid-tracker/BidDetailWorkspace').then((m) => ({ default: m.BidDetailWorkspace })),
)
const AdminImportDashboard = lazy(() =>
  import('@/modules/admin-data-import/AdminImportDashboard').then((m) => ({ default: m.AdminImportDashboard })),
)
const SessionImportWizard = lazy(() =>
  import('@/modules/admin-data-import/SessionImportWizard').then((m) => ({ default: m.SessionImportWizard })),
)
const GeographyLoadPanel = lazy(() =>
  import('@/modules/admin-data-import/GeographyLoadPanel').then((m) => ({ default: m.GeographyLoadPanel })),
)
const AdminImportAuthGate = lazy(() =>
  import('@/modules/admin-data-import/auth/AdminImportAuthGate').then((m) => ({ default: m.AdminImportAuthGate })),
)
const RolesAccessPage = lazy(() => import('@/modules/rbac-tree/RolesAccessPage').then((m) => ({ default: m.RolesAccessPage })))
const DocumentMakerHome = lazy(() =>
  import('@/modules/document-maker/DocumentMakerHome').then((m) => ({ default: m.DocumentMakerHome })),
)
const DocumentMakerEditor = lazy(() =>
  import('@/modules/document-maker/DocumentMakerEditor').then((m) => ({ default: m.DocumentMakerEditor })),
)
const EmailPage = lazy(() => import('./routes/EmailPage').then((m) => ({ default: m.EmailPage })))
const WhatsAppWorkspace = lazy(() => import('@/features/whatsapp/WhatsAppWorkspace').then((m) => ({ default: m.WhatsAppWorkspace })))
const MarketingPage = lazy(() => import('./routes/MarketingPage').then((m) => ({ default: m.MarketingPage })))
const FinanceWorkspace = lazy(() => import('@/features/finance/FinanceWorkspace').then((m) => ({ default: m.FinanceWorkspace })))
const Login = lazy(() => import('./routes/Login').then((m) => ({ default: m.Login })))
const NotFound = lazy(() => import('./routes/NotFound').then((m) => ({ default: m.NotFound })))

/** A route with its permission-tree node (docs/superpowers/specs/2026-10-14-dynamic-rbac-design.md): `handle.rbac` names
 *  the node (collected into the manifest; manifest.test.tsx fails for a route without one) and RequireNode enforces it. */
const routed = (path: string, node: string, element: ReactNode) => ({ path, handle: rbacHandle(node), element: <RequireNode node={node}>{element}</RequireNode> })

// Admin Data Import is gated behind its own env flag — unset/false by
// default everywhere, including goms-prod — since it has no real
// authentication yet (see AdminImportBanner). Building the route list
// conditionally (rather than gating inside each route's element) keeps the
// routes entirely absent from the router when the flag is off.
const adminImportRoutes =
  import.meta.env.VITE_ADMIN_IMPORT_ENABLED === 'true'
    ? [
        routed('/admin/data-import', ROUTE_NODES.dataImport, <AdminImportAuthGate><AdminImportDashboard /></AdminImportAuthGate>),
        // Geography is a one-click load with no uploaded file at all, so it
        // keeps its own dedicated panel — it never goes through the session
        // wizard (design spec §4 treats it as an always-'ready' root with no
        // uploaded rows).
        routed('/admin/data-import/geography', ROUTE_NODES.dataImport, <AdminImportAuthGate><GeographyLoadPanel /></AdminImportAuthGate>),
        routed('/admin/data-import/session', ROUTE_NODES.dataImport, <AdminImportAuthGate><SessionImportWizard /></AdminImportAuthGate>),
      ]
    : []

/** Old /bid-tracker/... links and bookmarks keep working: same page under the Live Bids address. */
function LegacyLiveBidsRedirect() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={`${pathname.replace(/^\/bid-tracker/, '/live-bids')}${search}${hash}`} replace />
}

function DirectoryRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/teams/directory${search}`} replace />
}

/** The Opportunity module opens for any role that can read at least one sheet (its tabs then follow their own sheet). */
const Opp = ({ children }: { children: React.ReactNode }) => <RequireAccess anyOf={NAV_MODULES.opportunity}>{children}</RequireAccess>

// Live Bids is dark-launched behind its own build flag, same convention as
// the admin-import routes above: absent from the router entirely when off.
const bidTrackerRoutes = isBidTrackerEnabled()
  ? [
      routed('/live-bids', ROUTE_NODES.bidTracker, <Opp><OpportunityWorkspace tab="bid-tracker" /></Opp>),
      routed('/live-bids/bid/:bidId', ROUTE_NODES.bid, <Opp><BidDetailWorkspace /></Opp>),
      routed('/live-bids/pipeline', ROUTE_NODES.pipeline, <Opp><OpportunityWorkspace tab="pipeline" /></Opp>),
      routed('/live-bids/pipeline/:tab', ROUTE_NODES.pipeline, <Opp><OpportunityWorkspace tab="pipeline" /></Opp>),
      routed('/live-bids/campaign', ROUTE_NODES.campaign, <Opp><OpportunityWorkspace tab="campaign" /></Opp>),
      routed('/live-bids/master', ROUTE_NODES.master, <Opp><OpportunityWorkspace tab="master" /></Opp>),
      routed('/live-bids/dashboard', ROUTE_NODES.dashboard, <Opp><OpportunityWorkspace tab="dashboard" /></Opp>),
      routed('/live-bids/:section', ROUTE_NODES.bidTracker, <Opp><OpportunityWorkspace tab="bid-tracker" /></Opp>),
      { path: '/bid-tracker/*', handle: rbacHandle(ROUTE_NODES.bidTracker), element: <LegacyLiveBidsRedirect /> },
    ]
  : []

export const router = createBrowserRouter([
  {
    element: <RequireSignIn><AppLayout /></RequireSignIn>,
    errorElement: <GlobalErrorScreen />,
    children: [
      routed('/', ROUTE_NODES.home, <Home />),
      routed('/map', ROUTE_NODES.map, <RequireAccess anyOf={NAV_MODULES.map}><Landing /></RequireAccess>),
      routed('/state/:code', ROUTE_NODES.state, <RequireAccess anyOf={NAV_MODULES.map}><StateWorkspace /></RequireAccess>),
      // Directory moved from Account Mapping to the sidebar Directory; old links (with ?sel=) still land on the same person.
      { path: '/directory', handle: rbacHandle(ROUTE_NODES.directory), element: <DirectoryRedirect /> },
      routed('/analytics', ROUTE_NODES.insights, <RequireAccess anyOf={NAV_MODULES.insights}><Insights /></RequireAccess>),
      routed('/insights', ROUTE_NODES.insights, <RequireAccess anyOf={NAV_MODULES.insights}><Insights /></RequireAccess>),
      routed('/insights/studio/visuals', ROUTE_NODES.insightsStudioVisuals, <RequireAccess anyOf={NAV_MODULES.insights}><VisualLibraryPage /></RequireAccess>),
      routed('/insights/studio/visuals/new', ROUTE_NODES.insightsStudioVisuals, <RequireAccess anyOf={NAV_MODULES.insights}><VisualBuilderPage /></RequireAccess>),
      routed('/insights/studio/visuals/:id', ROUTE_NODES.insightsStudioVisuals, <RequireAccess anyOf={NAV_MODULES.insights}><VisualBuilderPage /></RequireAccess>),
      routed('/insights/studio/reports', ROUTE_NODES.insightsStudioReports, <RequireAccess anyOf={NAV_MODULES.insights}><ReportsPage /></RequireAccess>),
      routed('/insights/studio/reports/:id', ROUTE_NODES.insightsStudioReports, <RequireAccess anyOf={NAV_MODULES.insights}><ReportPage /></RequireAccess>),
      routed('/insights/data-sources', ROUTE_NODES.insightsDataSources, <RequireAccess anyOf={NAV_MODULES.insights}><DataSourcesPage /></RequireAccess>),
      routed('/meetings', ROUTE_NODES.meetings, <RequireAccess anyOf={NAV_MODULES.meetings}><Meetings /></RequireAccess>),
      routed('/meetings/:meetingId', ROUTE_NODES.meeting, <RequireAccess anyOf={NAV_MODULES.meetings}><MeetingDetails /></RequireAccess>),
      routed('/sales', ROUTE_NODES.sales, <RequireAccess anyOf={NAV_MODULES.sales}><SalesWorkspace /></RequireAccess>),
      routed('/sales/:section', ROUTE_NODES.sales, <RequireAccess anyOf={NAV_MODULES.sales}><SalesWorkspace /></RequireAccess>),
      routed('/teams/directory', ROUTE_NODES.directory, <RequireAccess anyOf={NAV_MODULES.directory}><TeamsWorkspace /></RequireAccess>),
      routed('/teams', ROUTE_NODES.teams, <RequireAccess anyOf={NAV_MODULES.teams}><TeamsWorkspace /></RequireAccess>),
      routed('/teams/:team', ROUTE_NODES.teams, <RequireAccess anyOf={NAV_MODULES.teams}><TeamsWorkspace /></RequireAccess>),
      routed('/teams/:team/:section', ROUTE_NODES.teams, <RequireAccess anyOf={NAV_MODULES.teams}><TeamsWorkspace /></RequireAccess>),
      routed('/commercial-calculator', ROUTE_NODES.commercial, <RequireAccess anyOf={NAV_MODULES.commercial}><CommercialCalculatorWorkspace /></RequireAccess>),
      routed('/commercial-calculator/:section', ROUTE_NODES.commercial, <RequireAccess anyOf={NAV_MODULES.commercial}><CommercialCalculatorWorkspace /></RequireAccess>),
      routed('/commercial-calculator/boq/:boqId', ROUTE_NODES.boq, <RequireAccess anyOf={NAV_MODULES.commercial}><CommercialCalculatorWorkspace /></RequireAccess>),
      // Roles & Access lives in Settings → System settings; the old /admin/access screens (bookmarks) forward there.
      // Employees used to be a Teams tab; keep old bookmarks working now that the screen is Settings → Masters → Employee Master.
      { path: '/teams/employees', element: <Navigate to="/settings/masters/employees" replace /> },
      { path: '/admin/access', element: <Navigate to="/settings/access" replace /> },
      { path: '/admin/access/*', element: <Navigate to="/settings/access" replace /> },
      { path: '/settings/access', handle: rbacHandle(ROUTE_NODES.access), element: <RequireAccess anyOf={NAV_MODULES.adminAccess}><RequireNode node={ROUTE_NODES.access}><RolesAccessPage /></RequireNode></RequireAccess> },
      routed('/settings/credentials', ROUTE_NODES.credentials, <CredentialsSettingsPage />),
      routed('/settings/integrations', ROUTE_NODES.integrations, <IntegrationsSettingsPage />),
      routed('/settings', ROUTE_NODES.settings, <SettingsPage />),
      routed('/settings/dms', ROUTE_NODES.dms, <DmsSettingsPage />),
      routed('/settings/dms/new', ROUTE_NODES.dms, <DmsConnectionPage />),
      routed('/settings/dms/:connectionId', ROUTE_NODES.dms, <DmsConnectionPage />),
      routed('/documents/:module', ROUTE_NODES.documents, <DmsDocumentsPage />),
      // Personal Office files: every signed-in user; the API scopes each file to its owner.
      routed('/document-maker', ROUTE_NODES.documentMaker, <DocumentMakerHome />),
      routed('/document-maker/:id', ROUTE_NODES.documentEditor, <DocumentMakerEditor />),
      routed('/email', ROUTE_NODES.email, <EmailPage />),
      // Each user's own WhatsApp, linked through the OpenWA gateway (features/whatsapp/api.ts).
      routed('/whatsapp', ROUTE_NODES.whatsapp, <WhatsAppWorkspace />),
      routed('/marketing', ROUTE_NODES.marketing, <MarketingPage />),
      routed('/finance', ROUTE_NODES.finance, <FinanceWorkspace />),
      routed('/finance/:tab', ROUTE_NODES.finance, <FinanceWorkspace />),
      routed('/settings/tender-websites', ROUTE_NODES.tenderWebsites, <TenderWebsitesSettingsPage />),
      routed('/settings/document-verifications', ROUTE_NODES.verifications, <DocumentVerificationsSettingsPage />),
      routed('/settings/competitors', ROUTE_NODES.competitors, <CompetitorsSettingsPage />),
      routed('/settings/masters/employees', ROUTE_NODES.employeeMaster, <EmployeeMasterSettingsPage />),
      // Every other master: Settings > Masters > <title> (src/features/masters/mastersList.ts).
      ...MASTER_PAGE_LIST.filter((m) => m.kind !== 'employees')
        .map((m) => routed(`/settings/masters/${m.kind}`, `settings.masters.${m.kind}`, <MasterSettingsPage kind={m.kind} />)),
      ...bidTrackerRoutes,
      ...adminImportRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
  // Full-page sign-in, deliberately outside AppLayout (no TopBar/nav/FAB). Kept
  // AFTER the layout route: router.test.tsx reads `routes[0].children`.
  {
    path: '/login',
    element: <Suspense fallback={<RouteFallback />}><Login /></Suspense>,
    errorElement: <GlobalErrorScreen />,
  },
])
