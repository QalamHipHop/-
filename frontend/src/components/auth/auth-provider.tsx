'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = React.useState<AuthState>({ user: null, loading: true });

  const refresh = React.useCallback(async () => {
    if (typeof window === 'undefined') {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const user = await api.get<User>('/api/auth/me');
      setState({ user, loading: false });
    } catch {
      setState({ user: null, loading: false });
    }
  }, []);

  React.useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.removeItem('rial_token');
    refresh();
  }, [refresh]);

  const login = React.useCallback(
    async (email: string, password: string, mfaCode?: string) => {
      await api.post('/api/auth/login', { identifier: email, password, mfaCode });
      await refresh();
      router.push('/portfolio');
    },
    [refresh, router]
  );

  const register = React.useCallback(
    async (email: string, password: string, username: string) => {
      await api.post('/api/auth/register', { email, password, username });
      await refresh();
      router.push('/portfolio');
    },
    [refresh, router]
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
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
