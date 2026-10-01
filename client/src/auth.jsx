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
    }),
    [token, user, logout, finish]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function RequireAuth({ children }) {
  const { token } = useAuth();
  const location = useLocation();
  return token ? children : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
