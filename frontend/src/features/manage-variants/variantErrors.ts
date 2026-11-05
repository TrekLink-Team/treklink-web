import { SPEC_KEYS } from '../../entities/variant/spec';
import { ApiError } from '../../shared/api/apiClient';

type Errors = Record<string, string | undefined>;

// A server error goes under the field it names (chapter 06 §8.7); anything else above the form.
export const variantErrorsOf = (failure: unknown): Errors => {
  if (!(failure instanceof ApiError)) return { form: 'Something went wrong. Please try again.' };
  switch (failure.errorCode) {
    case 'CONFLICT_UNIQUE':
      return { code: failure.message };
    case 'SCHEDULE_INVALID':
      return { schedule: failure.message };
    case 'CHECKLIST_REQUIRED':
      return { checklist: failure.message };
    case 'VARIANT_MEDIA_INVALID': {
      const key = SPEC_KEYS.find(([name]) => failure.message.startsWith(`${name} `));
      return key ? { [`spec-${key[0]}`]: failure.message } : { imageUrl: failure.message };
    }
    default: {
      const field = ['name', 'firmwareBaseline', 'serviceIntervalDays', 'serviceChecklist', 'code'].find(
        (name) => failure.message.includes(name),
      );
      if (field === 'serviceChecklist') return { checklist: failure.message };
      return field ? { [field]: failure.message } : { form: failure.message };
    }
  }
};

