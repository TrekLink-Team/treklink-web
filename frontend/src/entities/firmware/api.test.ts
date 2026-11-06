import { describe, expect, it } from 'vitest';
import { compareFirmware, latestReleaseFor, type FirmwareRelease } from './api';

// The version comparison behind "Update available" and the flash panel's "Newer than the unit" (devices design
// section 12.14).

describe('compareFirmware', () => {
  it('orders by the base version, then the TrekLink build number', () => {
    expect(compareFirmware('2.7.19-treklink.3', '2.7.26-treklink.1')).toBeLessThan(0);
    expect(compareFirmware('2.7.26-treklink.2', '2.7.26-treklink.1')).toBeGreaterThan(0);
    expect(compareFirmware('v2.7.26-treklink.1', '2.7.26-treklink.1')).toBe(0);
  });

  it('reads the Meshtastic form a unit reports and ignores its build hash', () => {
    expect(compareFirmware('2.7.26.a4aa98d', '2.7.26-treklink.1')).toBeLessThan(0);
    expect(compareFirmware('2.7.27.a4aa98d', '2.7.26-treklink.1')).toBeGreaterThan(0);
  });
});

describe('latestReleaseFor', () => {
  const release = (version: string, codes: string[]): FirmwareRelease => ({
    version,
    publishedAt: '2026-11-06T00:00:00Z',
    isBaseline: false,
    variants: codes.map((variantCode) => ({
      variantCode,
      chip: 'esp32s3',
      app: { offset: 65536, sizeBytes: 1 },
      factory: { offset: 0, sizeBytes: 1 },
    })),
  });

  it('takes the first, newest, release that carries the variant', () => {
    const list = [release('2.7.26-treklink.2', ['treklink-v3']), release('2.7.26-treklink.1', ['treklink-v2', 'treklink-v3'])];
    expect(latestReleaseFor(list, 'treklink-v2')?.version).toBe('2.7.26-treklink.1');
    expect(latestReleaseFor(list, 'treklink-v4')).toBeNull();
  });
});
