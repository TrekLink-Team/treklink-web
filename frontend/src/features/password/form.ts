import { ApiError } from '../../shared/api/apiClient';

const GENERIC_FAILURE = 'Something went wrong. Please try again.';
export const PASSWORDS_DIFFER = 'Passwords do not match.';

// Where screens 2.1 and 2.2 place each error: MSG08 under the code field, a wrong current password
// under Current password (auth 08), the password policy under the new password, everything else in
// line above the form.
export interface FormErrors {
  form?: string;
  code?: string;
  current?: string;
  password?: string;
  confirm?: string;
}

export const errorsFrom = (failure: unknown): FormErrors => {
  if (!(failure instanceof ApiError)) return { form: GENERIC_FAILURE };
  if (failure.errorCode === 'CODE_INVALID') return { code: failure.message };
  if (failure.errorCode === 'INVALID_CREDENTIALS') return { current: failure.message };
  if (failure.errorCode === 'PASSWORD_POLICY') return { password: failure.message };
  return { form: failure.message };
};

export const CARD =
  'w-full max-w-sm bg-white border border-slate-200 rounded-xl p-7 flex flex-col gap-4';
export const PRIMARY = 'h-12 rounded-lg bg-blue-700 font-semibold text-white disabled:opacity-60';
export const LINK = 'self-start text-sm font-semibold text-blue-700';
