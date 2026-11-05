import { useCallback } from 'react';
import { NO_RELEASE_TEXT, useFirmwareReleases } from '../../../entities/firmware/api';
import { messageOf } from '../../../shared/ui/errors';

// Whether a variant can be flashed now (devices task 8.3, W32): the releases of api-design 28, read once
// for every variant. The answer is the reason Update firmware stays disabled in its slot, as text
// (chapter 06 §11.4), or null when a release carries the variant.
export const useFlashAvailability = (enabled: boolean) => {
  const releases = useFirmwareReleases(undefined, enabled);
  const { data, error, isLoading } = releases;
  return useCallback(
    (variantCode: string): string | null => {
      if (isLoading) return 'Reading the firmware releases…';
      if (error) return messageOf(error);
      return data?.some((release) => release.variants.some((entry) => entry.variantCode === variantCode))
        ? null
        : NO_RELEASE_TEXT;
    },
    [data, error, isLoading],
  );
};
