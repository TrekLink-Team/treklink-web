import { ApiError } from '../api/apiClient';

// MSG26 for 403 and 404 (another organization's record answers 404, auth REQ-ERR-06); otherwise
// the server's message.
export const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.statusCode === 403 || error.statusCode === 404)
      return 'You do not have access to this.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
};

// The aria attributes of a field with an error, pointing at the message Field renders.
export const invalid = (id: string, error?: string) =>
  error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};
