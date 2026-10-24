import { useQuery } from '@tanstack/react-query';
import { useSession, type SessionUser } from '../../entities/session/model';
import { apiClient } from '../../shared/api/apiClient';

export const ME_KEY = ['me'] as const;

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

// GET /api/auth/me (auth api-design 04).
export const fetchMe = (): Promise<SessionUser> => apiClient<SessionUser>('/auth/me');

// POST /api/auth/password/change (auth api-design 08). Every session ends, the caller's included
// (D-063 rule 1).
export const changePassword = (change: PasswordChange): Promise<null> =>
  post<null>('/auth/password/change', change);

// POST /api/auth/logout (auth api-design 03): revokes the presented refresh token.
export const logout = (refreshToken: string): Promise<null> =>
  post<null>('/auth/logout', { refreshToken });

// The caller's account, `['me']`, read once per session and shown from the sign-in response until it
// answers (screen 2.2).
export const useMe = () => {
  const user = useSession((state) => state.user);
  return useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    enabled: user !== null,
    placeholderData: user ?? undefined,
    staleTime: Infinity,
  });
};
