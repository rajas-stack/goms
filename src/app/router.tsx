import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from './AppLayout'
import { Home } from './routes/Home'
import { Landing } from './routes/Landing'
import { StateWorkspace } from './routes/StateWorkspace'
import { Directory } from './routes/Directory'
import { RelationshipAnalytics } from './routes/RelationshipAnalytics'
import { Meetings } from './routes/Meetings'
import { NotFound } from './routes/NotFound'

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
      { path: '*', element: <NotFound /> },
    ],
  },
])
