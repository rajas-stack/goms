import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { GlobalErrorScreen } from './routes/GlobalErrorScreen'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'
import { RequireAccess } from '@/components/NoAccess'
import { NAV_MODULES } from '@/lib/routeModules'

const Home = lazy(() => import('./routes/Home').then((m) => ({ default: m.Home })))
const Landing = lazy(() => import('./routes/Landing').then((m) => ({ default: m.Landing })))
const StateWorkspace = lazy(() => import('./routes/StateWorkspace').then((m) => ({ default: m.StateWorkspace })))
const Directory = lazy(() => import('./routes/Directory').then((m) => ({ default: m.Directory })))
const Insights = lazy(() => import('./routes/Insights').then((m) => ({ default: m.Insights })))
const Meetings = lazy(() => import('./routes/Meetings').then((m) => ({ default: m.Meetings })))
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
const AccessManagement = lazy(() =>
  import('@/modules/admin-access/AccessManagement').then((m) => ({ default: m.AccessManagement })),
)
const NotFound = lazy(() => import('./routes/NotFound').then((m) => ({ default: m.NotFound })))

// Admin Data Import is gated behind its own env flag — unset/false by
// default everywhere, including goms-prod — since it has no real
// authentication yet (see AdminImportBanner). Building the route list
// conditionally (rather than gating inside each route's element) keeps the
// routes entirely absent from the router when the flag is off.
const adminImportRoutes =
  import.meta.env.VITE_ADMIN_IMPORT_ENABLED === 'true'
    ? [
        { path: '/admin/data-import', element: <AdminImportAuthGate><AdminImportDashboard /></AdminImportAuthGate> },
        // Geography is a one-click load with no uploaded file at all, so it
        // keeps its own dedicated panel — it never goes through the session
        // wizard (design spec §4 treats it as an always-'ready' root with no
        // uploaded rows).
        { path: '/admin/data-import/geography', element: <AdminImportAuthGate><GeographyLoadPanel /></AdminImportAuthGate> },
        { path: '/admin/data-import/session', element: <AdminImportAuthGate><SessionImportWizard /></AdminImportAuthGate> },
      ]
    : []

/** The Opportunity module opens for any role that can read at least one sheet (its tabs then follow their own sheet). */
const Opp = ({ children }: { children: React.ReactNode }) => <RequireAccess anyOf={NAV_MODULES.opportunity}>{children}</RequireAccess>

// Bid Tracker is dark-launched behind its own build flag, same convention as
// the admin-import routes above: absent from the router entirely when off.
const bidTrackerRoutes = isBidTrackerEnabled()
  ? [
      { path: '/bid-tracker', element: <Opp><OpportunityWorkspace tab="bid-tracker" /></Opp> },
      { path: '/bid-tracker/bid/:bidId', element: <Opp><BidDetailWorkspace /></Opp> },
      { path: '/bid-tracker/pipeline', element: <Opp><OpportunityWorkspace tab="pipeline" /></Opp> },
      { path: '/bid-tracker/pipeline/:tab', element: <Opp><OpportunityWorkspace tab="pipeline" /></Opp> },
      { path: '/bid-tracker/campaign', element: <Opp><OpportunityWorkspace tab="campaign" /></Opp> },
      { path: '/bid-tracker/master', element: <Opp><OpportunityWorkspace tab="master" /></Opp> },
      { path: '/bid-tracker/dashboard', element: <Opp><OpportunityWorkspace tab="dashboard" /></Opp> },
      { path: '/bid-tracker/:section', element: <Opp><OpportunityWorkspace tab="bid-tracker" /></Opp> },
    ]
  : []

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <GlobalErrorScreen />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/map', element: <RequireAccess anyOf={NAV_MODULES.map}><Landing /></RequireAccess> },
      { path: '/state/:code', element: <RequireAccess anyOf={NAV_MODULES.map}><StateWorkspace /></RequireAccess> },
      { path: '/directory', element: <RequireAccess anyOf={NAV_MODULES.directory}><Directory /></RequireAccess> },
      { path: '/analytics', element: <RequireAccess anyOf={NAV_MODULES.insights}><Insights /></RequireAccess> },
      { path: '/meetings', element: <RequireAccess anyOf={NAV_MODULES.meetings}><Meetings /></RequireAccess> },
      { path: '/sales', element: <RequireAccess anyOf={NAV_MODULES.sales}><SalesWorkspace /></RequireAccess> },
      { path: '/sales/:section', element: <RequireAccess anyOf={NAV_MODULES.sales}><SalesWorkspace /></RequireAccess> },
      { path: '/teams', element: <RequireAccess anyOf={NAV_MODULES.teams}><TeamsWorkspace /></RequireAccess> },
      { path: '/teams/:team', element: <RequireAccess anyOf={NAV_MODULES.teams}><TeamsWorkspace /></RequireAccess> },
      { path: '/teams/:team/:section', element: <RequireAccess anyOf={NAV_MODULES.teams}><TeamsWorkspace /></RequireAccess> },
      { path: '/commercial-calculator', element: <RequireAccess anyOf={NAV_MODULES.commercial}><CommercialCalculatorWorkspace /></RequireAccess> },
      { path: '/commercial-calculator/:section', element: <RequireAccess anyOf={NAV_MODULES.commercial}><CommercialCalculatorWorkspace /></RequireAccess> },
      { path: '/commercial-calculator/boq/:boqId', element: <RequireAccess anyOf={NAV_MODULES.commercial}><CommercialCalculatorWorkspace /></RequireAccess> },
      { path: '/admin/access', element: <RequireAccess anyOf={NAV_MODULES.adminAccess}><AccessManagement /></RequireAccess> },
      { path: '/settings/credentials', element: <CredentialsSettingsPage /> },
      { path: '/settings/integrations', element: <IntegrationsSettingsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/settings/dms', element: <DmsSettingsPage /> },
      { path: '/settings/dms/new', element: <DmsConnectionPage /> },
      { path: '/settings/dms/:connectionId', element: <DmsConnectionPage /> },
      { path: '/documents/:module', element: <DmsDocumentsPage /> },
      { path: '/settings/tender-websites', element: <TenderWebsitesSettingsPage /> },
      { path: '/settings/document-verifications', element: <DocumentVerificationsSettingsPage /> },
      ...bidTrackerRoutes,
      ...adminImportRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
])
