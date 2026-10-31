import axios from 'axios';
import { useAuthStore } from '../auth/authStore';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  config.headers['x-request-id'] = crypto.randomUUID();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // expired / invalid login: back to the login page instead of showing empty screens
    const url: string = error.config?.url ?? '';
    if (error.response?.status === 401 && !url.includes('/auth/login')) {
      const admin = useAuthStore.getState().principal?.kind === 'admin' || window.location.pathname.startsWith('/admin');
      useAuthStore.getState().logout();
      const target = admin ? '/admin/login' : '/login';
      if (window.location.pathname !== target) window.location.assign(target);
    }
    const message =
      error.response?.data?.message ??
      error.response?.data?.error_code ??
      error.message;
    return Promise.reject(new Error(Array.isArray(message) ? message.join(', ') : message));
  },
);
