import { lazy } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from './AppLayout'

const Home = lazy(() => import('./routes/Home').then((m) => ({ default: m.Home })))
const Landing = lazy(() => import('./routes/Landing').then((m) => ({ default: m.Landing })))
const StateWorkspace = lazy(() => import('./routes/StateWorkspace').then((m) => ({ default: m.StateWorkspace })))
const Directory = lazy(() => import('./routes/Directory').then((m) => ({ default: m.Directory })))
const RelationshipAnalytics = lazy(() => import('./routes/RelationshipAnalytics').then((m) => ({ default: m.RelationshipAnalytics })))
const Meetings = lazy(() => import('./routes/Meetings').then((m) => ({ default: m.Meetings })))
const SalesWorkspace = lazy(() => import('./routes/SalesWorkspace').then((m) => ({ default: m.SalesWorkspace })))
const CommercialCalculatorWorkspace = lazy(() =>
  import('@/modules/commercial-calculator/CommercialCalculatorWorkspace').then((m) => ({ default: m.CommercialCalculatorWorkspace })),
)
const NotFound = lazy(() => import('./routes/NotFound').then((m) => ({ default: m.NotFound })))

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/map', element: <Landing /> },
      { path: '/state/:code', element: <StateWorkspace /> },
      { path: '/directory', element: <Directory /> },
      { path: '/analytics', element: <RelationshipAnalytics /> },
      { path: '/meetings', element: <Meetings /> },
      { path: '/sales', element: <SalesWorkspace /> },
      { path: '/sales/:section', element: <SalesWorkspace /> },
      { path: '/commercial-calculator', element: <CommercialCalculatorWorkspace /> },
      { path: '/commercial-calculator/:section', element: <CommercialCalculatorWorkspace /> },
      { path: '/commercial-calculator/boq/:boqId', element: <CommercialCalculatorWorkspace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
