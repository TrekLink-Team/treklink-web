import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../../common/errors';
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
  file: string;
  offset: number;
  size: number;
  sha256: string;
}

export interface ManifestVariant {
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
    !text(entry.file) ||
    !whole(entry.offset) ||
    !whole(entry.size) ||
    !text(entry.sha256)
  ) {
    return null;
  }
  const sha256 = entry.sha256.toLowerCase();
  return SHA256.test(sha256)
    ? { file: entry.file, offset: entry.offset, size: entry.size, sha256 }
    : null;
};

// The manifest of design section 9.1: `version`, and per variant `variantCode`, `pioEnv`, `chip`, and for
// `app` and `factory` the file name, offset, size and SHA-256. An entry that misses a field is dropped; a
// manifest with no valid entry is no release.
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
      ? [{ variantCode: entry.variantCode, pioEnv: entry.pioEnv, chip: entry.chip, app, factory }]
      : [];
  });
  return variants.length > 0 ? { version: manifest.version, variants } : null;
};

@Injectable()
export class FirmwareReleaseService {
  private readonly logger = new Logger(FirmwareReleaseService.name);
  private cache: { repo: string; at: number; releases: Release[] } | null = null;

  constructor(
    private readonly parameters: ParameterService,
    private readonly devices: DevicesService,
    @Inject(FIRMWARE_HTTP) private readonly http: FirmwareHttp,
  ) {}

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
    const release = (await this.releases(now)).find((candidate) => candidate.version === version);
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
      version,
      variantCode,
      kind,
      chip: entry.chip,
      offset: wanted.offset,
      sizeBytes: bytes.length,
      sha256,
      md5: createHash('md5').update(bytes).digest('hex'),
      imageBase64: Buffer.from(bytes).toString('base64'),
    };
  }

  // The release list with each manifest, kept for `devices.firmwareReleaseCacheSeconds` (0 reads every
  // time). A release without a valid manifest asset is skipped and logged; an unreadable source is 502.
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

    let listed: unknown;
    try {
      listed = await this.http.json(
        `${GITHUB_API}/repos/${repo}/releases?per_page=30`,
        API_HEADERS,
      );
    } catch (error) {
      this.logger.warn(`Firmware releases of ${repo}: ${String(error)}`);
      throw unavailable();
    }
    if (!Array.isArray(listed)) throw unavailable();

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
    return releases;
  }
}
