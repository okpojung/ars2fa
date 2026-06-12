import { create } from 'zustand';

export type Principal = {
  id: string;
  email: string;
  kind: 'user' | 'admin';
  role?: string;
};

type AuthState = {
  accessToken: string | null;
  principal: Principal | null;
  setSession: (accessToken: string, principal: Principal) => void;
  logout: () => void;
};

const tokenKey = 'ars2fa.accessToken';
const principalKey = 'ars2fa.principal';

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: localStorage.getItem(tokenKey),
  principal: readPrincipal(),
  setSession: (accessToken, principal) => {
    localStorage.setItem(tokenKey, accessToken);
    localStorage.setItem(principalKey, JSON.stringify(principal));
    set({ accessToken, principal });
  },
  logout: () => {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(principalKey);
    set({ accessToken: null, principal: null });
  },
}));

function readPrincipal(): Principal | null {
  const raw = localStorage.getItem(principalKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Principal;
  } catch {
    return null;
  }
}
