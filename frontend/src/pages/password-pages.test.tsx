// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../app/providers/AuthProvider';
import { AppRoutes } from '../app/router';
import { useSession, type SessionUser } from '../entities/session/model';
import { forgotPassword, resetPassword, setPassword } from '../features/password/api';
import { errorsFrom } from '../features/password/form';
import { ApiError } from '../shared/api/apiClient';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignInPage } from './SignInPage';
import { WelcomePage } from './WelcomePage';

vi.mock('../features/password/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/password/api')>()),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  setPassword: vi.fn(),
}));
vi.mock('./LiveMapPage', () => ({ LiveMapPage: () => <p>landing page</p> }));

const STAFF: SessionUser = {
  id: 'staff-1',
  email: 'staff@treklink.vn',
  fullName: 'Staff',
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  organization: null,
};
const TOKENS = {
  accessToken: 'a',
  accessTokenExpiresIn: 900,
  refreshToken: 'r',
  refreshTokenExpiresIn: 1209600,
};
const CODE_INVALID = new ApiError(
  400,
  'CODE_INVALID',
  'This code is invalid or has expired. Request a new one.',
);

const Where: React.FC = () => <p data-testid="where">{useLocation().pathname}</p>;

const show = (path: string, state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/forgot" element={<ForgotPasswordPage />} />
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const submit = (name: string | RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });

afterEach(() => {
  cleanup();
  vi.mocked(forgotPassword).mockReset();
  vi.mocked(resetPassword).mockReset();
  vi.mocked(setPassword).mockReset();
  act(() => useSession.getState().signOut());
});

describe('/forgot (auth api-design 05)', () => {
  it('sends the code, confirms with the fixed answer and carries the email to /reset', async () => {
    vi.mocked(forgotPassword).mockResolvedValue(null);
    show('/forgot');

    type('Email', 'admin@treklink.vn');
    await submit('Send code');

    expect(forgotPassword).toHaveBeenCalledWith('admin@treklink.vn');
    expect(screen.getByRole('status').textContent).toContain(
      'If the email is registered, a code has been sent.',
    );
    fireEvent.click(screen.getByRole('link', { name: 'I have a code: enter it' }));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('admin@treklink.vn');
  });

  it('shows the cooldown answer under the button', async () => {
    vi.mocked(forgotPassword).mockRejectedValue(
      new ApiError(429, 'OTP_COOLDOWN', 'Please wait a minute before requesting another code.'),
    );
    show('/forgot');

    type('Email', 'admin@treklink.vn');
    await submit('Send code');

    expect(screen.getByRole('alert').textContent).toBe(
      'Please wait a minute before requesting another code.',
    );
  });
});

describe('/reset (auth api-design 06)', () => {
  const fill = (confirm = 'brand-new-password') => {
    type('Code', '482913');
    type('New password', 'brand-new-password');
    type('Confirm new password', confirm);
  };

  it('refuses different passwords in the browser without sending', async () => {
    show('/reset', { email: 'admin@treklink.vn' });
    fill('something-else');
    await submit('Reset password');

    expect(screen.getByRole('alert').textContent).toBe('Passwords do not match.');
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('puts MSG08 under the code field', async () => {
    vi.mocked(resetPassword).mockRejectedValue(CODE_INVALID);
    show('/reset', { email: 'admin@treklink.vn' });
    fill();
    await submit('Reset password');

    const code = screen.getByLabelText('Code');
    expect(code.getAttribute('aria-describedby')).toBe('reset-code-error');
    expect(document.getElementById('reset-code-error')?.textContent).toBe(CODE_INVALID.message);
  });

  it('puts the password policy under the password field', async () => {
    vi.mocked(resetPassword).mockRejectedValue(
      new ApiError(400, 'PASSWORD_POLICY', 'password must be at least 8 characters.'),
    );
    show('/reset', { email: 'admin@treklink.vn' });
    fill();
    await submit('Reset password');

    expect(document.getElementById('reset-password-error')?.textContent).toBe(
      'password must be at least 8 characters.',
    );
  });

  it('resets, then signs in again with the "Password changed" banner', async () => {
    vi.mocked(resetPassword).mockResolvedValue(null);
    show('/reset', { email: 'admin@treklink.vn' });
    fill();
    await submit('Reset password');

    expect(resetPassword).toHaveBeenCalledWith({
      email: 'admin@treklink.vn',
      code: '482913',
      newPassword: 'brand-new-password',
    });
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Password changed');
  });

  it('sends a new code from the same page, and shows a refusal in line', async () => {
    vi.mocked(forgotPassword).mockResolvedValueOnce(null);
    show('/reset', { email: 'admin@treklink.vn' });

    await submit('Send a new code');
    expect(forgotPassword).toHaveBeenCalledWith('admin@treklink.vn');
    expect(screen.getByRole('status').textContent).toBe(
      'If the email is registered, a code has been sent.',
    );

    vi.mocked(forgotPassword).mockRejectedValueOnce(
      new ApiError(429, 'OTP_COOLDOWN', 'Please wait a minute before requesting another code.'),
    );
    await submit('Send a new code');
    expect(screen.getByRole('alert').textContent).toBe(
      'Please wait a minute before requesting another code.',
    );
  });

  it('toggles the password visibility with a labelled button', () => {
    show('/reset');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect((screen.getByLabelText('New password') as HTMLInputElement).type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });
});

describe('/sign-in links', () => {
  it('offers Set password for an invited account, as the invitation email says', () => {
    show('/sign-in');
    fireEvent.click(screen.getByRole('link', { name: 'Set password' }));
    expect(screen.getByRole('button', { name: 'Set password and sign in' })).toBeTruthy();
  });
});

describe('/welcome (auth api-design 07)', () => {
  const fill = (confirm = 'first-password') => {
    type('Email', 'staff@treklink.vn');
    type('Invitation code', '739104');
    type('Password', 'first-password');
    type('Confirm password', confirm);
  };

  it('sets the first password, signs in and lands on the role route', async () => {
    vi.mocked(setPassword).mockResolvedValue({ ...TOKENS, user: STAFF });
    show('/welcome');
    fill();
    await submit('Set password and sign in');

    expect(setPassword).toHaveBeenCalledWith({
      email: 'staff@treklink.vn',
      code: '739104',
      password: 'first-password',
    });
    expect(useSession.getState().user).toEqual(STAFF);
    expect(screen.getByTestId('where').textContent).toBe('/t/map');
  });

  it('offers a new invitation from /forgot when the code is refused (D-059 rule 6)', async () => {
    vi.mocked(setPassword).mockRejectedValue(CODE_INVALID);
    show('/welcome');
    fill();
    await submit('Set password and sign in');

    expect(document.getElementById('welcome-code-error')?.textContent).toBe(CODE_INVALID.message);
    expect(screen.getByRole('link', { name: 'Request a new one' }).getAttribute('href')).toBe(
      '/forgot',
    );
  });

  it('refuses different passwords, and shows any other refusal above the form', async () => {
    show('/welcome');
    fill('other');
    await submit('Set password and sign in');
    expect(screen.getByRole('alert').textContent).toBe('Passwords do not match.');

    vi.mocked(setPassword).mockRejectedValue(new Error('offline'));
    type('Confirm password', 'first-password');
    await submit('Set password and sign in');
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Please try again.');
  });
});

describe('signed-in visitors', () => {
  it.each(['/sign-in', '/forgot', '/reset', '/welcome'])(
    'are sent from %s to their landing route',
    (path) => {
      useSession.getState().signIn(TOKENS, STAFF);
      render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(screen.getByText('landing page')).toBeTruthy();
    },
  );
});

describe('errorsFrom', () => {
  it('places each refusal where screen 2.1 shows it', () => {
    expect(errorsFrom(CODE_INVALID)).toEqual({ code: CODE_INVALID.message });
    expect(errorsFrom(new ApiError(400, 'VALIDATION_FAILED', 'email is required.'))).toEqual({
      form: 'email is required.',
    });
    expect(errorsFrom('boom')).toEqual({ form: 'Something went wrong. Please try again.' });
  });
});
