import { apiClient } from '../../shared/api/apiClient';
import type { SessionTokens, SessionUser } from '../../entities/session/model';

// The fixed answers of auth api-design 05 and 06. `apiClient` returns `result`, which is null for
// both, so the pages show the same text the server sends as `message`.
export const CODE_SENT_NOTICE = 'If the email is registered, a code has been sent.';
export const PASSWORD_CHANGED_NOTICE = 'Password changed';

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

export interface SetPasswordRequest {
  email: string;
  code: string;
  password: string;
}

export type SetPasswordResponse = SessionTokens & { user: SessionUser };

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

// POST /api/auth/password/forgot (auth api-design 05).
export const forgotPassword = (email: string): Promise<null> =>
  post<null>('/auth/password/forgot', { email });

// POST /api/auth/password/reset (auth api-design 06).
export const resetPassword = (request: ResetPasswordRequest): Promise<null> =>
  post<null>('/auth/password/reset', request);

// POST /api/auth/password/set (auth api-design 07): the invitation, which also signs the user in.
export const setPassword = (request: SetPasswordRequest): Promise<SetPasswordResponse> =>
  post<SetPasswordResponse>('/auth/password/set', request);
