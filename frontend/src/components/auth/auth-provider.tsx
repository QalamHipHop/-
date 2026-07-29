'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: 'user' | 'admin' | 'moderator';
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string, mfaCode?: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasRole: (...roles: User['role'][]) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'rial_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = React.useState<AuthState>({ user: null, loading: true });

  const refresh = React.useCallback(async () => {
    if (typeof window === 'undefined' || !localStorage.getItem(STORAGE_KEY)) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const user = await api.get<User>('/api/auth/me');
      setState({ user, loading: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
      }
      setState({ user: null, loading: false });
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const login = React.useCallback(
    async (email: string, password: string, mfaCode?: string) => {
      const res = await api.post<{ accessToken: string; user: User }>('/api/auth/login', { email, password, mfaCode });
      localStorage.setItem(STORAGE_KEY, res.accessToken);
      setState({ user: res.user, loading: false });
      router.push('/portfolio');
    },
    [router]
  );

  const register = React.useCallback(
    async (email: string, password: string, username: string) => {
      const res = await api.post<{ accessToken: string; user: User }>('/api/auth/register', { email, password, username });
      localStorage.setItem(STORAGE_KEY, res.accessToken);
      setState({ user: res.user, loading: false });
      router.push('/portfolio');
    },
    [router]
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    localStorage.removeItem(STORAGE_KEY);
    setState({ user: null, loading: false });
    router.push('/');
  }, [router]);

  const hasRole = React.useCallback(
    (...roles: User['role'][]) => Boolean(state.user && roles.includes(state.user.role)),
    [state.user]
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, refresh, hasRole }),
    [state, login, register, logout, refresh, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
