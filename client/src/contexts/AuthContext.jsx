import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, setUser, getUser } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(getUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getUser();
    if (stored) {
      api.me().then(u => {
        setUserState(u);
        setUser(u);
      }).catch(() => {
        setUserState(null);
        setToken(null);
        setUser(null);
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const { token, user } = await api.login(email, password);
    setToken(token);
    setUser(user);
    setUserState(user);
    return user;
  };

  const register = async (name, email, password) => {
    const { token, user } = await api.register(name, email, password);
    setToken(token);
    setUser(user);
    setUserState(user);
    return user;
  };

  const refreshUser = useCallback(async () => {
    const u = await api.me();
    setUserState(u);
    setUser(u);
    return u;
  }, []);

  const logout = () => {
    setToken(null);
    setUser(null);
    setUserState(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
