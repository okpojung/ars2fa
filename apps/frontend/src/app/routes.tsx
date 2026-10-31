import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '../shared/components/AppLayout';
import { ProtectedRoute } from '../shared/components/ProtectedRoute';
import { LoginPage } from '../pages/public/LoginPage';
import { SignupPage } from '../pages/public/SignupPage';
import { ConsoleDashboardPage } from '../pages/user/ConsoleDashboardPage';
import { ConsoleSessionsPage } from '../pages/user/ConsoleSessionsPage';
import { HomePage } from '../pages/public/HomePage';
import { DocsPage } from '../pages/public/DocsPage';
import { ApplicationListPage } from '../pages/user/ApplicationListPage';
import { ApplicationFormPage } from '../pages/user/ApplicationFormPage';
import { ApplicationDetailPage } from '../pages/user/ApplicationDetailPage';
import { ApiKeyListPage } from '../pages/user/ApiKeyListPage';
import { ApiKeyDetailPage } from '../pages/user/ApiKeyDetailPage';
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminApplicationsPage } from '../pages/admin/AdminApplicationsPage';
import { AdminApiKeysPage } from '../pages/admin/AdminApiKeysPage';
import { AdminAuthLogsPage } from '../pages/admin/AdminAuthLogsPage';
import { AdminNumberPoolPage } from '../pages/admin/AdminNumberPoolPage';
import { AdminArsSettingsPage } from '../pages/admin/AdminArsSettingsPage';
import { AdminArsSessionsPage } from '../pages/admin/AdminArsSessionsPage';
import { AdminAppSecurityPage } from '../pages/admin/AdminAppSecurityPage';
import { AdminArsTestPage } from '../pages/admin/AdminArsTestPage';
import { MobileDialPage } from '../pages/public/MobileDialPage';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/docs', element: <DocsPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/admin/login', element: <LoginPage admin /> },
  { path: '/m/ars/:token', element: <MobileDialPage /> },
  // old customer paths
  ...['/applications', '/api-keys', '/auth-requests', '/statistics'].map((p) => ({ path: p, element: <Navigate to={p === '/auth-requests' ? '/console/sessions' : p === '/statistics' ? '/console' : `/console${p}`} replace /> })),
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/console', element: <ConsoleDashboardPage /> },
          { path: '/console/applications', element: <ApplicationListPage /> },
          { path: '/console/applications/new', element: <ApplicationFormPage /> },
          { path: '/console/applications/:id', element: <ApplicationDetailPage /> },
          { path: '/console/api-keys', element: <ApiKeyListPage /> },
          { path: '/console/api-keys/:id', element: <ApiKeyDetailPage /> },
          { path: '/console/sessions', element: <ConsoleSessionsPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute admin />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/admin', element: <AdminDashboardPage /> },
          { path: '/admin/applications', element: <AdminApplicationsPage /> },
          { path: '/admin/api-keys', element: <AdminApiKeysPage /> },
          { path: '/admin/auth-logs', element: <AdminAuthLogsPage /> },
          { path: '/admin/ars/sessions', element: <AdminArsSessionsPage /> },
          { path: '/admin/ars/pool', element: <AdminNumberPoolPage /> },
          { path: '/admin/ars/apps', element: <AdminAppSecurityPage /> },
          { path: '/admin/ars/settings', element: <AdminArsSettingsPage /> },
          { path: '/admin/ars/test', element: <AdminArsTestPage /> },
        ],
      },
    ],
  },
]);
