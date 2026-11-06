import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { DevicesService } from '../devices.service';
import { FIRMWARE_HTTP, type FirmwareHttp } from './firmware-http.port';

// The firmware release reader (devices task 8.2, design section 9.1, api-design 28 and 29). The browser
// cannot download a GitHub release asset (no CORS), so the backend reads the releases of
// `devices.firmwareReleaseRepo`, parses each release's `treklink-manifest.json`, and serves one image after
// checking its SHA-256 against the manifest, with its MD5 for the flasher's write verification.

export const MANIFEST_ASSET = 'treklink-manifest.json';
// A Vercel Function answers at most 4.5 MB; base64 adds a third, so the raw image stays under this
// (design section 9.1).
export const MAX_IMAGE_BYTES = 3_300_000;
// How long a failed read of the release list is kept, so the hub does not call GitHub again on every
// open while the unauthenticated rate limit is spent (design section 9.1, leader ruling 2026-11-06). A
// technical constant like MAX_IMAGE_BYTES, not a business parameter.
export const FAILURE_CACHE_MS = 60_000;
const GITHUB_API = 'https://api.github.com';
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'treklink-backend',
};
const ASSET_HEADERS = { Accept: 'application/octet-stream', 'User-Agent': 'treklink-backend' };
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type ImageKind = 'APP' | 'FACTORY';

export interface ManifestImage {
  // The release asset's name, `fileName` in the manifest.
  file: string;
  offset: number;
  size: number;
  sha256: string;
}

export interface ManifestVariant {
  // The platform's hardware variant code (`treklink-v3`), from the manifest's short code (`v3`).
  variantCode: string;
  pioEnv: string;
  chip: string;
  app: ManifestImage;
  factory: ManifestImage;
}

interface Release {
  version: string;
  publishedAt: string;
  variants: ManifestVariant[];
  // Asset name to its download URL.
  assets: Map<string, string>;
}

export interface ReleaseView {
  version: string;
  publishedAt: string;
  isBaseline: boolean;
  variants: {
    variantCode: string;
    chip: string;
    app: { offset: number; sizeBytes: number };
    factory: { offset: number; sizeBytes: number };
  }[];
}

export interface FirmwareImage {
  version: string;
  variantCode: string;
  kind: ImageKind;
  chip: string;
  offset: number;
  sizeBytes: number;
  sha256: string;
  md5: string;
  imageBase64: string;
}

const unavailable = () =>
  new DomainException(
    HttpStatus.BAD_GATEWAY,
    ErrorCode.FIRMWARE_SOURCE_UNAVAILABLE,
    'Firmware releases cannot be read right now. Try again later.',
  );

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const imageOf = (value: unknown): ManifestImage | null => {
  const entry = record(value);
  if (
    !entry ||
    !text(entry.fileName) ||
    !whole(entry.offset) ||
    !whole(entry.size) ||
    !text(entry.sha256)
  ) {
    return null;
  }
  const sha256 = entry.sha256.toLowerCase();
  return SHA256.test(sha256)
    ? { file: entry.fileName, offset: entry.offset, size: entry.size, sha256 }
    : null;
};

// The manifest firmware task 8.1 publishes (treklink-firmware#30, design section 9.1, ruling of
// 2026-11-06): `version`, the release tag; per variant the short `variantCode` (`v2`, `v3`, `v4`), `pioEnv`,
// `chip` in esptool's lower-case form (`esp32`, `esp32s3`), and for `app` and `factory` the `fileName`,
// integer `offset` and `size`, and `sha256`. The short code maps to the platform's variant code
// `treklink-<code>`, and the tag's leading `v` is dropped, so versions read as `firmwareBaseline` does.
// An entry that misses a field is dropped; a manifest with no valid entry is no release.
export const variantCodeOf = (manifestCode: string): string =>
  manifestCode.startsWith('treklink-') ? manifestCode : `treklink-${manifestCode}`;

export const versionOf = (tag: string): string => tag.replace(/^v(?=\d)/, '');

export const parseManifest = (
  value: unknown,
): { version: string; variants: ManifestVariant[] } | null => {
  const manifest = record(value);
  if (!manifest || !text(manifest.version) || !Array.isArray(manifest.variants)) return null;
  const variants = manifest.variants.flatMap((raw): ManifestVariant[] => {
    const entry = record(raw);
    if (!entry || !text(entry.variantCode) || !text(entry.pioEnv) || !text(entry.chip)) return [];
    const app = imageOf(entry.app);
    const factory = imageOf(entry.factory);
    return app && factory
      ? [
          {
            variantCode: variantCodeOf(entry.variantCode),
            pioEnv: entry.pioEnv,
            chip: entry.chip.toLowerCase(),
            app,
            factory,
          },
        ]
      : [];
  });
  return variants.length > 0 ? { version: versionOf(manifest.version), variants } : null;
};

// The MD5 esptool-js compares with the chip's flash after the write: of the image padded to 4 bytes with
// 0xFF, as writeFlash pads it before hashing (esptool-js 0.7.1 lib/esploader.js:1596, util.js padTo).
export const md5ForVerify = (bytes: Uint8Array): string => {
  const pad = (4 - (bytes.length % 4)) % 4;
  const hash = createHash('md5').update(bytes);
  if (pad > 0) hash.update(Buffer.alloc(pad, 0xff));
  return hash.digest('hex');
};

@Injectable()
export class FirmwareReleaseService {
  private readonly logger = new Logger(FirmwareReleaseService.name);
  private cache: { repo: string; at: number; releases: Release[] } | null = null;
  // The last failed read of the release list, kept for FAILURE_CACHE_MS.
  private failure: { repo: string; at: number } | null = null;

  constructor(
    private readonly parameters: ParameterService,
    private readonly devices: DevicesService,
    @Inject(FIRMWARE_HTTP) private readonly http: FirmwareHttp,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // The GitHub API headers, with the optional read-only GITHUB_TOKEN when it is set. Only the API calls
  // carry it: the asset downloads are not counted by the API limit and follow redirects to another host.
  private apiHeaders(): Record<string, string> {
    const token = this.config.get('GITHUB_TOKEN', { infer: true })?.trim();
    return token ? { ...API_HEADERS, Authorization: `Bearer ${token}` } : API_HEADERS;
  }

  // api-design 28: the releases, newest first, that carry `variantCode` when one is given. `isBaseline`
  // marks the release whose version is the variant's `firmwareBaseline` (any variant's without a filter).
  async list(variantCode?: string, now: number = Date.now()): Promise<ReleaseView[]> {
    const [releases, variants] = await Promise.all([
      this.releases(now),
      this.devices.variants(false),
    ]);
    const baselines = new Set(
      variants
        .filter((variant) => !variantCode || variant.code === variantCode)
        .map((variant) => variant.firmwareBaseline),
    );
    return releases
      .map((release) => ({
        release,
        carried: release.variants.filter(
          (entry) => !variantCode || entry.variantCode === variantCode,
        ),
      }))
      .filter(({ carried }) => carried.length > 0)
      .map(({ release, carried }) => ({
        version: release.version,
        publishedAt: release.publishedAt,
        isBaseline: baselines.has(release.version),
        variants: carried.map((entry) => ({
          variantCode: entry.variantCode,
          chip: entry.chip,
          app: { offset: entry.app.offset, sizeBytes: entry.app.size },
          factory: { offset: entry.factory.offset, sizeBytes: entry.factory.size },
        })),
      }));
  }

  // api-design 29: one image, refused above MAX_IMAGE_BYTES (502 FIRMWARE_IMAGE_TOO_LARGE) and when its
  // SHA-256 differs from the manifest (502 FIRMWARE_IMAGE_INVALID, REQ-ERR-17); never cached here.
  async image(
    version: string,
    variantCode: string,
    kind: ImageKind,
    now: number = Date.now(),
  ): Promise<FirmwareImage> {
    const release = (await this.releases(now)).find(
      (candidate) => candidate.version === versionOf(version),
    );
    const entry = release?.variants.find((candidate) => candidate.variantCode === variantCode);
    if (!release || !entry) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Firmware image not found.',
      );
    }
    const wanted = kind === 'FACTORY' ? entry.factory : entry.app;
    const tooLarge = () =>
      new DomainException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.FIRMWARE_IMAGE_TOO_LARGE,
        'This firmware image is too large to send. Flash it on the bench.',
      );
    if (wanted.size > MAX_IMAGE_BYTES) throw tooLarge();
    const url = release.assets.get(wanted.file);
    if (!url) throw unavailable();

    let bytes: Uint8Array;
    try {
      bytes = await this.http.bytes(url, ASSET_HEADERS);
    } catch (error) {
      this.logger.warn(`Firmware image ${wanted.file} of ${version}: ${String(error)}`);
      throw unavailable();
    }
    if (bytes.length > MAX_IMAGE_BYTES) throw tooLarge();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== wanted.sha256) {
      this.logger.warn(
        `Firmware image ${wanted.file} of ${version}: SHA-256 ${sha256} is not the manifest's.`,
      );
      throw new DomainException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.FIRMWARE_IMAGE_INVALID,
        'The firmware image failed its check and was not sent. Try again later.',
      );
    }
    return {
      version: release.version,
      variantCode,
      kind,
      chip: entry.chip,
      offset: wanted.offset,
      sizeBytes: bytes.length,
      sha256,
      md5: md5ForVerify(bytes),
      imageBase64: Buffer.from(bytes).toString('base64'),
    };
  }

  // The release list with each manifest, kept for `devices.firmwareReleaseCacheSeconds` (0 reads every
  // time). A release without a valid manifest asset is skipped and logged; an unreadable source is 502,
  // and that failure is kept for FAILURE_CACHE_MS.
  private async releases(now: number): Promise<Release[]> {
    const [repo, cacheSeconds] = await Promise.all([
      this.parameters.get('devices.firmwareReleaseRepo'),
      this.parameters.get('devices.firmwareReleaseCacheSeconds'),
    ]);
    if (typeof repo !== 'string' || !REPO.test(repo)) {
      this.logger.error(`devices.firmwareReleaseRepo is not owner/name: ${JSON.stringify(repo)}`);
      throw unavailable();
    }
    const cached = this.cache;
    if (cached && cached.repo === repo && now - cached.at < cacheSeconds * 1000)
      return cached.releases;
    // A read that failed inside the last FAILURE_CACHE_MS answers 502 again without calling GitHub.
    const failed = this.failure;
    if (failed && failed.repo === repo && now - failed.at < FAILURE_CACHE_MS) throw unavailable();

    let listed: unknown;
    try {
      listed = await this.http.json(
        `${GITHUB_API}/repos/${repo}/releases?per_page=30`,
        this.apiHeaders(),
      );
    } catch (error) {
      this.logger.warn(`Firmware releases of ${repo}: ${String(error)}`);
      this.failure = { repo, at: now };
      throw unavailable();
    }
    if (!Array.isArray(listed)) {
      this.failure = { repo, at: now };
      throw unavailable();
    }

    const releases: Release[] = [];
    for (const raw of listed) {
      const release = record(raw);
      if (!release || release.draft === true) continue;
      const assets = new Map<string, string>();
      for (const asset of Array.isArray(release.assets) ? release.assets : []) {
        const entry = record(asset);
        if (entry && text(entry.name) && text(entry.browser_download_url)) {
          assets.set(entry.name, entry.browser_download_url);
        }
      }
      const manifestUrl = assets.get(MANIFEST_ASSET);
      if (!manifestUrl) continue;
      let manifest: ReturnType<typeof parseManifest>;
      try {
        manifest = parseManifest(
          JSON.parse(
            Buffer.from(await this.http.bytes(manifestUrl, ASSET_HEADERS)).toString('utf8'),
          ),
        );
      } catch (error) {
        this.logger.warn(`Firmware manifest of ${String(release.tag_name)}: ${String(error)}`);
        continue;
      }
      if (!manifest) {
        this.logger.warn(
          `Firmware manifest of ${String(release.tag_name)} has no valid variant entry.`,
        );
        continue;
      }
      releases.push({
        version: manifest.version,
        publishedAt: text(release.published_at) ? release.published_at : new Date(0).toISOString(),
        variants: manifest.variants,
        assets,
      });
    }
    releases.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    this.cache = { repo, at: now, releases };
    this.failure = null;
    return releases;
  }
}
