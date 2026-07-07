import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '../domain/types';

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
};

const storageKey = 'brainx.auth';
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = loadInitialAuth();
  const [token, setToken] = useState<string | null>(initial.token);
  const [user, setUser] = useState<AuthUser | null>(initial.user);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      setAuth(nextToken, nextUser) {
        setToken(nextToken);
        setUser(nextUser);
        window.localStorage.setItem(storageKey, JSON.stringify({ token: nextToken, user: nextUser }));
      },
      clearAuth() {
        setToken(null);
        setUser(null);
        window.localStorage.removeItem(storageKey);
      }
    }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}

function loadInitialAuth(): Pick<AuthState, 'token' | 'user'> {
  if (import.meta.env.MODE === 'test') {
    return { token: 'test-token', user: { id: 'u_test', username: 'test' } };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { token: null, user: null };
    }
    const parsed = JSON.parse(raw) as Pick<AuthState, 'token' | 'user'>;
    return { token: parsed.token ?? null, user: parsed.user ?? null };
  } catch {
    return { token: null, user: null };
  }
}
