import { apiClient } from '../../shared/api/apiClient';
import type { SessionTokens, SessionUser } from '../../entities/session/model';

export interface SignInRequest {
  email: string;
  password: string;
}

export type SignInResponse = SessionTokens & { user: SessionUser };

// POST /api/auth/login (auth api-design 01).
export const signIn = (credentials: SignInRequest): Promise<SignInResponse> =>
  apiClient<SignInResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
