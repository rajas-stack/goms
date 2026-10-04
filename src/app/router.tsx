import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { GlobalErrorScreen } from './routes/GlobalErrorScreen'
import { isBidTrackerEnabled } from '@/modules/bid-tracker/enabled'

const Home = lazy(() => import('./routes/Home').then((m) => ({ default: m.Home })))
const Landing = lazy(() => import('./routes/Landing').then((m) => ({ default: m.Landing })))
const StateWorkspace = lazy(() => import('./routes/StateWorkspace').then((m) => ({ default: m.StateWorkspace })))
const Directory = lazy(() => import('./routes/Directory').then((m) => ({ default: m.Directory })))
const Insights = lazy(() => import('./routes/Insights').then((m) => ({ default: m.Insights })))
const Meetings = lazy(() => import('./routes/Meetings').then((m) => ({ default: m.Meetings })))
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

// Bid Tracker is dark-launched behind its own build flag, same convention as
// the admin-import routes above: absent from the router entirely when off.
const bidTrackerRoutes = isBidTrackerEnabled()
  ? [
      { path: '/bid-tracker', element: <OpportunityWorkspace tab="bid-tracker" /> },
      { path: '/bid-tracker/bid/:bidId', element: <BidDetailWorkspace /> },
      { path: '/bid-tracker/pipeline', element: <OpportunityWorkspace tab="pipeline" /> },
      { path: '/bid-tracker/pipeline/:tab', element: <OpportunityWorkspace tab="pipeline" /> },
      { path: '/bid-tracker/campaign', element: <OpportunityWorkspace tab="campaign" /> },
      { path: '/bid-tracker/master', element: <OpportunityWorkspace tab="master" /> },
      { path: '/bid-tracker/:section', element: <OpportunityWorkspace tab="bid-tracker" /> },
    ]
  : []

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <GlobalErrorScreen />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/map', element: <Landing /> },
      { path: '/state/:code', element: <StateWorkspace /> },
      { path: '/directory', element: <Directory /> },
      { path: '/analytics', element: <Insights /> },
      { path: '/meetings', element: <Meetings /> },
      { path: '/sales', element: <SalesWorkspace /> },
      { path: '/sales/:section', element: <SalesWorkspace /> },
      { path: '/teams', element: <TeamsWorkspace /> },
      { path: '/teams/:team', element: <TeamsWorkspace /> },
      { path: '/teams/:team/:section', element: <TeamsWorkspace /> },
      { path: '/commercial-calculator', element: <CommercialCalculatorWorkspace /> },
      { path: '/commercial-calculator/:section', element: <CommercialCalculatorWorkspace /> },
      { path: '/commercial-calculator/boq/:boqId', element: <CommercialCalculatorWorkspace /> },
      ...bidTrackerRoutes,
      ...adminImportRoutes,
      { path: '*', element: <NotFound /> },
    ],
  },
])
