import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import * as api from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('docqa_token'));
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('docqa_user') || 'null');
    } catch {
      return null;
    }
  });

  // sign-in / create-account card (opened from anywhere with openAuth)
  const [authUi, setAuthUi] = useState({ open: false, mode: 'login' });
  const openAuth = useCallback((mode = 'login') => setAuthUi({ open: true, mode }), []);
  const closeAuth = useCallback(() => setAuthUi((s) => ({ ...s, open: false })), []);
  const setAuthMode = useCallback((mode) => setAuthUi((s) => ({ ...s, mode })), []);

  const logout = useCallback(() => {
    localStorage.removeItem('docqa_token');
    localStorage.removeItem('docqa_user');
    setToken(null);
    setUser(null);
  }, []);

  const finish = useCallback(({ token: t, user: u }) => {
    localStorage.setItem('docqa_token', t);
    localStorage.setItem('docqa_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  useEffect(() => {
    window.addEventListener('docqa:unauthorized', logout);
    return () => window.removeEventListener('docqa:unauthorized', logout);
  }, [logout]);

  const value = useMemo(
    () => ({
      token,
      user,
      logout,
      login: async (email, password) => finish(await api.login(email, password)),
      register: async (name, email, password) => finish(await api.register(name, email, password)),
      authOpen: authUi.open,
      authMode: authUi.mode,
      openAuth,
      closeAuth,
      setAuthMode,
    }),
    [token, user, logout, finish, authUi, openAuth, closeAuth, setAuthMode]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// no longer used by App.jsx (guests can browse), kept so old imports do not break
export function RequireAuth({ children }) {
  const { token } = useAuth();
  const location = useLocation();
  return token ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}