import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '../shared/components/AppLayout';
import { ProtectedRoute } from '../shared/components/ProtectedRoute';
import { LoginPage } from '../pages/public/LoginPage';
import { SignupPage } from '../pages/public/SignupPage';
import { DashboardPage } from '../pages/user/DashboardPage';
import { ApplicationListPage } from '../pages/user/ApplicationListPage';
import { ApplicationFormPage } from '../pages/user/ApplicationFormPage';
import { ApplicationDetailPage } from '../pages/user/ApplicationDetailPage';
import { ApiKeyListPage } from '../pages/user/ApiKeyListPage';
import { ApiKeyDetailPage } from '../pages/user/ApiKeyDetailPage';
import { AuthRequestListPage } from '../pages/user/AuthRequestListPage';
import { StatisticsPage } from '../pages/user/StatisticsPage';
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
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/admin/login', element: <LoginPage admin /> },
  { path: '/m/ars/:token', element: <MobileDialPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/applications', element: <ApplicationListPage /> },
          { path: '/applications/new', element: <ApplicationFormPage /> },
          { path: '/applications/:id', element: <ApplicationDetailPage /> },
          { path: '/api-keys', element: <ApiKeyListPage /> },
          { path: '/api-keys/:id', element: <ApiKeyDetailPage /> },
          { path: '/auth-requests', element: <AuthRequestListPage /> },
          { path: '/statistics', element: <StatisticsPage /> },
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
