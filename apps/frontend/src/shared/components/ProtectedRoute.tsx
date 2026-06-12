import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../auth/authStore';

export function ProtectedRoute({ admin = false }: { admin?: boolean }) {
  const location = useLocation();
  const principal = useAuthStore((state) => state.principal);

  if (!principal) {
    return <Navigate to={admin ? '/admin/login' : '/login'} replace state={{ from: location }} />;
  }

  if (admin && principal.kind !== 'admin') {
    return <Navigate to="/admin/login" replace />;
  }

  if (!admin && principal.kind !== 'user') {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}
