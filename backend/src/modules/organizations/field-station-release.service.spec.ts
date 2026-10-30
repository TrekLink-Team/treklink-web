import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'node:fs/promises';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import {
  compareVersions,
  FieldStationReleaseService,
  isOutdatedAgainst,
} from './field-station-release.service';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn(), stat: jest.fn() }));

const SHA = 'AB'.repeat(32);
const RELEASE = {
  version: '1.2.0',
  publishedAt: '2026-10-20T03:15:00Z',
  files: [
    {
      os: 'windows-x64',
      fileName: 'treklink-field-station-1.2.0-win-x64.exe',
      sha256: SHA,
      sizeBytes: 48211456,
    },
  ],
};

const statOf = (mtimeMs: number, size = 100) => ({ mtimeMs, size });

describe('compareVersions and isOutdatedAgainst (organizations 2.8, REQ-EVT-11)', () => {
  it('orders versions by major, minor and patch numbers', () => {
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
  });

  it('ignores a pre-release or build suffix, and is null for text that is not a version', () => {
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBeNull();
    expect(compareVersions('latest', '1.2.0')).toBeNull();
    expect(compareVersions('1.2.0', '')).toBeNull();
  });

  it('is outdated only for a reported version older than the release', () => {
    expect(isOutdatedAgainst('1.1.0', '1.2.0')).toBe(true);
    expect(isOutdatedAgainst('1.2.0', '1.2.0')).toBe(false);
    expect(isOutdatedAgainst('1.3.0', '1.2.0')).toBe(false);
    expect(isOutdatedAgainst(null, '1.2.0')).toBe(false);
    expect(isOutdatedAgainst('1.1.0', null)).toBe(false);
    expect(isOutdatedAgainst('dev-build', '1.2.0')).toBe(false);
  });
});

describe('FieldStationReleaseService (organizations 2.8, api-design 26, AC-08, D-039)', () => {
  let dir: string | undefined;
  let service: FieldStationReleaseService;

  const unavailable = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).errorCode).toBe(ErrorCode.RELEASE_UNAVAILABLE);
    expect((error as DomainException).getStatus()).toBe(503);
    expect((error as DomainException).message).toBe(
      'The Field Station download is unavailable. Try again later.',
    );
  };

  beforeEach(() => {
    dir = '/releases';
    jest
      .mocked(stat)
      .mockReset()
      .mockResolvedValue(statOf(1) as never);
    jest.mocked(readFile).mockReset().mockResolvedValue(JSON.stringify(RELEASE));
    const config = { get: () => dir } as unknown as ConfigService<ValidatedEnvironment, true>;
    service = new FieldStationReleaseService(config);
  });

  it('reads release.json and gives the version and one download per file with its SHA-256', async () => {
    await expect(service.current()).resolves.toEqual({
      version: '1.2.0',
      publishedAt: '2026-10-20T03:15:00.000Z',
      files: [
        {
          os: 'windows-x64',
          downloadUrl: '/downloads/field-station/1.2.0/treklink-field-station-1.2.0-win-x64.exe',
          sha256: SHA.toLowerCase(),
          sizeBytes: 48211456,
        },
      ],
    });
    expect(String(jest.mocked(stat).mock.calls[0][0]).replace(/\\/g, '/')).toBe(
      '/releases/release.json',
    );
  });

  it('keeps the release until the file changes, then reads it again', async () => {
    await service.current();
    await service.current();
    expect(readFile).toHaveBeenCalledTimes(1);

    jest.mocked(stat).mockResolvedValue(statOf(2) as never);
    jest.mocked(readFile).mockResolvedValue(JSON.stringify({ ...RELEASE, version: '1.3.0' }));
    await expect(service.current()).resolves.toMatchObject({ version: '1.3.0' });
    expect(readFile).toHaveBeenCalledTimes(2);

    jest.mocked(stat).mockResolvedValue(statOf(2, 999) as never);
    await service.current();
    expect(readFile).toHaveBeenCalledTimes(3);
  });

  it('answers 503 RELEASE_UNAVAILABLE when the directory is not set or the file is missing', async () => {
    dir = undefined;
    await unavailable(service.current());

    dir = '/releases';
    jest.mocked(stat).mockRejectedValue(new Error('ENOENT'));
    await unavailable(service.current());
  });

  it('answers 503 for a file that is not JSON or does not have the shape of release.json', async () => {
    jest.mocked(readFile).mockResolvedValue('not json');
    await unavailable(service.current());

    const wrong: unknown[] = [
      null,
      [],
      { ...RELEASE, version: 5 },
      { ...RELEASE, version: 'latest' },
      { ...RELEASE, publishedAt: 'yesterday' },
      { ...RELEASE, publishedAt: 5 },
      { ...RELEASE, files: [] },
      { ...RELEASE, files: 'none' },
      { ...RELEASE, files: [null] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], os: 1 }] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], fileName: '../secret.exe' }] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], fileName: 7 }] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], sha256: 'abc' }] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], sha256: 5 }] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], sizeBytes: -1 }] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], sizeBytes: 1.5 }] },
      { ...RELEASE, files: [{ ...RELEASE.files[0], sizeBytes: '10' }] },
    ];
    let mtime = 10;
    for (const data of wrong) {
      mtime += 1;
      jest.mocked(stat).mockResolvedValue(statOf(mtime) as never);
      jest.mocked(readFile).mockResolvedValue(JSON.stringify(data));
      await unavailable(service.current());
    }
  });

  it('forgets a release that can no longer be read, and recovers when the file is valid again', async () => {
    await service.current();
    jest.mocked(stat).mockRejectedValueOnce(new Error('EACCES'));
    await unavailable(service.current());

    await expect(service.current()).resolves.toMatchObject({ version: '1.2.0' });
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('gives null instead of failing for the list of stations, and tells outdated by the release', async () => {
    await expect(service.currentOrNull()).resolves.toMatchObject({ version: '1.2.0' });
    await expect(service.isOutdated('1.1.0')).resolves.toBe(true);
    await expect(service.isOutdated('1.2.0')).resolves.toBe(false);
    await expect(service.isOutdated(null)).resolves.toBe(false);

    jest.mocked(stat).mockRejectedValue(new Error('ENOENT'));
    await expect(service.currentOrNull()).resolves.toBeNull();
    await expect(service.isOutdated('1.0.0')).resolves.toBe(false);
  });
});
