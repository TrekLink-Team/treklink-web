import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../../common/errors';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { DevicesService } from '../devices.service';
import {
  FirmwareReleaseService,
  MANIFEST_ASSET,
  MAX_IMAGE_BYTES,
  md5ForVerify,
  parseManifest,
} from './firmware-release.service';

// devices task 8.2, design sections 9.1 and 9.3: manifest parsing, the variant filter, the SHA-256 check,
// the size limit and the cache window, all against a fake HTTP client (never the network).
const REPO = 'TrekLink-Team/treklink-firmware';
const APP = Uint8Array.from([0xe9, 1, 2, 3, 4, 5, 6, 7]);
const FACTORY = Uint8Array.from([0xe9, 9, 9, 9]);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const url = (name: string) =>
  `https://github.com/${REPO}/releases/download/v2.7.26-treklink.2/${name}`;

const entry = (variantCode: string, chip: string, overrides: object = {}) => ({
  variantCode,
  pioEnv: `${variantCode}-env`,
  chip,
  app: { file: `${variantCode}-firmware.bin`, offset: 0x10000, size: APP.length, sha256: sha(APP) },
  factory: {
    file: `${variantCode}-firmware.factory.bin`,
    offset: 0,
    size: FACTORY.length,
    sha256: sha(FACTORY),
  },
  ...overrides,
});

const MANIFEST = {
  version: '2.7.26-treklink.2',
  variants: [entry('treklink-v3', 'ESP32'), entry('treklink-v4', 'ESP32-S3')],
};

const release = (tag: string, publishedAt: string, assets: string[]) => ({
  tag_name: tag,
  draft: false,
  published_at: publishedAt,
  assets: assets.map((name) => ({ name, browser_download_url: url(name) })),
});

describe('FirmwareReleaseService (devices task 8.2)', () => {
  let files: Map<string, Uint8Array>;
  let listing: unknown;
  let http: { json: jest.Mock; bytes: jest.Mock };
  let parameters: { get: jest.Mock };
  let service: FirmwareReleaseService;

  beforeEach(() => {
    files = new Map([
      [url(MANIFEST_ASSET), Buffer.from(JSON.stringify(MANIFEST))],
      [url('treklink-v3-firmware.bin'), APP],
      [url('treklink-v3-firmware.factory.bin'), FACTORY],
      [url('treklink-v4-firmware.bin'), APP],
      [url('treklink-v4-firmware.factory.bin'), FACTORY],
    ]);
    listing = [
      release('v2.7.26-treklink.2', '2026-10-20T03:15:00Z', [
        MANIFEST_ASSET,
        'treklink-v3-firmware.bin',
        'treklink-v3-firmware.factory.bin',
        'treklink-v4-firmware.bin',
        'treklink-v4-firmware.factory.bin',
      ]),
      // No manifest: not a TrekLink release.
      release('v2.7.25', '2026-10-25T03:15:00Z', ['firmware.bin']),
    ];
    http = {
      json: jest.fn(() => Promise.resolve(listing)),
      bytes: jest.fn((address: string) => {
        const found = files.get(address);
        return found
          ? Promise.resolve(found)
          : Promise.reject(new Error(`GET ${address} answered 404`));
      }),
    };
    const values: Record<string, unknown> = {
      'devices.firmwareReleaseRepo': REPO,
      'devices.firmwareReleaseCacheSeconds': 300,
    };
    parameters = { get: jest.fn((key: string) => Promise.resolve(values[key])) };
    const devices = {
      variants: jest.fn().mockResolvedValue([
        { code: 'treklink-v3', firmwareBaseline: '2.7.26-treklink.2' },
        { code: 'treklink-v4', firmwareBaseline: '2.7.26-treklink.1' },
        { code: 'treklink-v2', firmwareBaseline: '2.7.19-treklink.3' },
      ]),
    };
    service = new FirmwareReleaseService(
      parameters as unknown as ParameterService,
      devices as unknown as DevicesService,
      http,
    );
  });

  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(DomainException);
    return error as DomainException;
  };

  describe('list (api-design 28)', () => {
    it('reads the releases of the configured repository without a token and skips one with no manifest', async () => {
      const releases = await service.list();

      expect(http.json).toHaveBeenCalledWith(
        `https://api.github.com/repos/${REPO}/releases?per_page=30`,
        expect.not.objectContaining({ Authorization: expect.anything() as unknown }),
      );
      expect(releases).toEqual([
        {
          version: '2.7.26-treklink.2',
          publishedAt: '2026-10-20T03:15:00Z',
          isBaseline: true,
          variants: [
            {
              variantCode: 'treklink-v3',
              chip: 'ESP32',
              app: { offset: 0x10000, sizeBytes: APP.length },
              factory: { offset: 0, sizeBytes: FACTORY.length },
            },
            expect.objectContaining({ variantCode: 'treklink-v4', chip: 'ESP32-S3' }),
          ],
        },
      ]);
    });

    it('keeps only the releases that carry the variant, and marks its own baseline', async () => {
      expect(await service.list('treklink-v4')).toEqual([
        expect.objectContaining({
          isBaseline: false,
          variants: [expect.objectContaining({ variantCode: 'treklink-v4' })],
        }),
      ]);
      expect(await service.list('treklink-v2')).toEqual([]);
    });

    it('answers an empty list while no release is published', async () => {
      listing = [];
      await expect(service.list('treklink-v3')).resolves.toEqual([]);
    });

    it('serves the list from the cache inside devices.firmwareReleaseCacheSeconds, then reads again', async () => {
      await service.list(undefined, 1_000_000);
      await service.list(undefined, 1_000_000 + 299_000);
      expect(http.json).toHaveBeenCalledTimes(1);
      await service.list(undefined, 1_000_000 + 300_000);
      expect(http.json).toHaveBeenCalledTimes(2);
    });

    it('reads every time when the cache window is 0', async () => {
      parameters.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'devices.firmwareReleaseRepo' ? REPO : 0),
      );
      await service.list(undefined, 5);
      await service.list(undefined, 5);
      expect(http.json).toHaveBeenCalledTimes(2);
    });

    it('answers 502 FIRMWARE_SOURCE_UNAVAILABLE when GitHub cannot be read or the repository is malformed', async () => {
      http.json.mockRejectedValueOnce(new Error('GET answered 403'));
      const error = await refusal(service.list());
      expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(error.errorCode).toBe(ErrorCode.FIRMWARE_SOURCE_UNAVAILABLE);

      parameters.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'devices.firmwareReleaseRepo' ? 'not a repository' : 300),
      );
      expect((await refusal(service.list())).errorCode).toBe(ErrorCode.FIRMWARE_SOURCE_UNAVAILABLE);
    });

    it('skips a release whose manifest is unreadable', async () => {
      files.set(url(MANIFEST_ASSET), Buffer.from('{not json'));
      await expect(service.list()).resolves.toEqual([]);
    });
  });

  describe('image (api-design 29)', () => {
    it('returns the app image with its offset, SHA-256, MD5 and chip', async () => {
      await expect(service.image('2.7.26-treklink.2', 'treklink-v3', 'APP')).resolves.toEqual({
        version: '2.7.26-treklink.2',
        variantCode: 'treklink-v3',
        kind: 'APP',
        chip: 'ESP32',
        offset: 0x10000,
        sizeBytes: APP.length,
        sha256: sha(APP),
        md5: md5(APP),
        imageBase64: Buffer.from(APP).toString('base64'),
      });
    });

    it('returns the factory image at offset 0', async () => {
      await expect(
        service.image('2.7.26-treklink.2', 'treklink-v4', 'FACTORY'),
      ).resolves.toMatchObject({
        offset: 0,
        md5: md5(FACTORY),
        chip: 'ESP32-S3',
      });
    });

    it('answers 502 FIRMWARE_IMAGE_INVALID and no image when the SHA-256 differs (AC-20)', async () => {
      files.set(url('treklink-v3-firmware.bin'), Uint8Array.from([0xe9, 0, 0, 0, 0, 0, 0, 0]));
      const error = await refusal(service.image('2.7.26-treklink.2', 'treklink-v3', 'APP'));
      expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(error.errorCode).toBe(ErrorCode.FIRMWARE_IMAGE_INVALID);
    });

    it('refuses a manifest entry above 3 300 000 bytes before downloading it', async () => {
      files.set(
        url(MANIFEST_ASSET),
        Buffer.from(
          JSON.stringify({
            ...MANIFEST,
            variants: [
              entry('treklink-v3', 'ESP32', {
                factory: {
                  file: 'big.bin',
                  offset: 0,
                  size: MAX_IMAGE_BYTES + 1,
                  sha256: sha(FACTORY),
                },
              }),
            ],
          }),
        ),
      );
      const error = await refusal(service.image('2.7.26-treklink.2', 'treklink-v3', 'FACTORY'));
      expect(error.errorCode).toBe(ErrorCode.FIRMWARE_IMAGE_TOO_LARGE);
      expect(http.bytes).not.toHaveBeenCalledWith(url('big.bin'), expect.anything());
    });

    it('refuses a downloaded image above the limit even when the manifest under-states it', async () => {
      const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
      files.set(url('treklink-v3-firmware.bin'), big);
      expect(
        (await refusal(service.image('2.7.26-treklink.2', 'treklink-v3', 'APP'))).errorCode,
      ).toBe(ErrorCode.FIRMWARE_IMAGE_TOO_LARGE);
    });

    it('answers 404 for a version or a variant the releases do not carry', async () => {
      expect((await refusal(service.image('9.9.9', 'treklink-v3', 'APP'))).getStatus()).toBe(
        HttpStatus.NOT_FOUND,
      );
      expect(
        (await refusal(service.image('2.7.26-treklink.2', 'treklink-v2', 'APP'))).getStatus(),
      ).toBe(HttpStatus.NOT_FOUND);
    });

    it('answers 502 FIRMWARE_SOURCE_UNAVAILABLE when the asset cannot be downloaded', async () => {
      files.delete(url('treklink-v3-firmware.bin'));
      expect(
        (await refusal(service.image('2.7.26-treklink.2', 'treklink-v3', 'APP'))).errorCode,
      ).toBe(ErrorCode.FIRMWARE_SOURCE_UNAVAILABLE);
    });
  });

  describe('parseManifest (design section 9.1)', () => {
    it('drops an entry that misses a field or carries a malformed SHA-256, and a manifest with none left', () => {
      expect(
        parseManifest({
          version: '1',
          variants: [entry('treklink-v3', 'ESP32'), { variantCode: 'x' }],
        })?.variants,
      ).toHaveLength(1);
      expect(
        parseManifest({
          version: '1',
          variants: [
            entry('treklink-v3', 'ESP32', {
              app: { file: 'a', offset: 0, size: 1, sha256: 'xyz' },
            }),
          ],
        }),
      ).toBeNull();
      expect(parseManifest({ variants: [] })).toBeNull();
      expect(parseManifest('nope')).toBeNull();
    });
  });

  describe('md5ForVerify', () => {
    it('hashes the image padded to 4 bytes with 0xFF, as esptool-js does before its check', () => {
      expect(md5ForVerify(APP)).toBe(md5(APP));
      const odd = Uint8Array.from([1, 2, 3, 4, 5]);
      expect(md5ForVerify(odd)).toBe(md5(Uint8Array.from([1, 2, 3, 4, 5, 0xff, 0xff, 0xff])));
    });
  });
});
