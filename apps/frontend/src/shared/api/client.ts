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
    const message =
      error.response?.data?.message ??
      error.response?.data?.error_code ??
      error.message;
    return Promise.reject(new Error(Array.isArray(message) ? message.join(', ') : message));
  },
);
