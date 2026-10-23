import { createContext, useContext } from 'react';
import type { SessionUser } from '../../entities/session/model';

export interface AuthContextValue {
  user: SessionUser | null;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
