import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString } from '../../shared/api/query';

// The firmware releases and images of devices api-design 28 and 29 (task 8.2, design section 9.1).

export interface FirmwareImageInfo {
  offset: number;
  sizeBytes: number;
}

export interface FirmwareRelease {
  version: string;
  publishedAt: string;
  // The release whose version is the variant's firmware baseline (preselected on the panel).
  isBaseline: boolean;
  variants: {
    variantCode: string;
    // The manifest's chip in esptool's lower-case form (`esp32`, `esp32s3`), which the unit must report
    // (REQ-ERR-16, treklink-firmware#30).
    chip: string;
    app: FirmwareImageInfo;
    factory: FirmwareImageInfo;
  }[];
}

export type FirmwareImageKind = 'APP' | 'FACTORY';

export interface FirmwareImage {
  version: string;
  variantCode: string;
  kind: FirmwareImageKind;
  chip: string;
  offset: number;
  sizeBytes: number;
  sha256: string;
  // Of the image padded to 4 bytes, as esptool-js hashes it for its write verification.
  md5: string;
  imageBase64: string;
}

// Shown as text, never as an error, while no release carries a variant (W32, chapter 06 §11.4).
export const NO_RELEASE_TEXT = 'No firmware release is published yet.';

export const firmwareKeys = {
  releases: (variantCode?: string) => ['firmware-releases', variantCode ?? null] as const,
};

export const fetchFirmwareReleases = (variantCode?: string) =>
  apiClient<FirmwareRelease[]>(`/firmware-releases${queryString({ variantCode })}`);

export const fetchFirmwareImage = (version: string, variantCode: string, kind: FirmwareImageKind) =>
  apiClient<FirmwareImage>(
    `/firmware-releases/${encodeURIComponent(version)}/images/${encodeURIComponent(variantCode)}${queryString({ kind })}`,
  );

// The list is cached on the server for devices.firmwareReleaseCacheSeconds; the client keeps it a minute.
export const useFirmwareReleases = (variantCode: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: firmwareKeys.releases(variantCode),
    queryFn: () => fetchFirmwareReleases(variantCode),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

// Base64 from api-design 29 to the bytes the flasher writes.
export const imageBytes = (image: Pick<FirmwareImage, 'imageBase64'>): Uint8Array =>
  Uint8Array.from(atob(image.imageBase64), (character) => character.charCodeAt(0));
