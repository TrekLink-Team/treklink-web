import { ApiError } from '../../shared/api/apiClient';
import { messageOf } from '../../shared/ui/errors';

// The message of a refused device write (screen 4.2), shared by the device page and the fleet table.
export const MSG29 = 'Finish the open maintenance record first.';

export const deviceFailure = (error: unknown, status: string): string => {
  if (error instanceof ApiError) {
    if (error.errorCode === 'INVALID_STATE_TRANSITION')
      return `This cannot be done while it is ${status}.`;
    if (error.errorCode === 'MAINTENANCE_OPEN') return MSG29;
    return error.message;
  }
  return messageOf(error);
};
