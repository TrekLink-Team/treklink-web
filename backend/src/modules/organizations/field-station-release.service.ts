import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

export interface ReleaseFile {
  os: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface FieldStationRelease {
  version: string;
  publishedAt: string;
  files: ReleaseFile[];
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)/;
const SHA256 = /^[0-9a-f]{64}$/i;
// A file name only: the download path is built from it, so it never carries a separator.
const FILE_NAME = /^[^/\\]+$/;

// The three numbers of a version such as 1.2.0 (a pre-release or build suffix is ignored), or null when
// the text does not start with them.
const parse = (text: string): [number, number, number] | null => {
  const match = VERSION.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

// Semantic-version order of two versions: negative when `a` is older, zero when equal, positive when
// newer; null when either is not a version.
export function compareVersions(a: string, b: string): number | null {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

// A station is outdated when it reported a version older than the current release. A station that has
// not reported, a version that is not a version, and a release that cannot be read are all "not
// outdated": nothing is known to be old.
export function isOutdatedAgainst(reported: string | null, currentVersion: string | null): boolean {
  if (reported === null || currentVersion === null) return false;
  const order = compareVersions(reported, currentVersion);
  return order !== null && order < 0;
}

const unavailable = () =>
  new DomainException(
    HttpStatus.SERVICE_UNAVAILABLE,
    ErrorCode.RELEASE_UNAVAILABLE,
    'The Field Station download is unavailable. Try again later.',
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The current Field Station release (task 2.8, api-design 26, D-039): `release.json` in
// FIELD_STATION_RELEASE_DIR, read again only when the file changes. Publishing a release is a
// deployment step, never an API call; this service only reads it. The executables are served from
// `/downloads/field-station/<version>/` by the deployment, outside the envelope.
@Injectable()
export class FieldStationReleaseService {
  private cached: { key: string; release: FieldStationRelease } | null = null;

  constructor(private readonly config: ConfigService<ValidatedEnvironment, true>) {}

  // 503 RELEASE_UNAVAILABLE when the directory is not set or `release.json` is missing or invalid.
  async current(): Promise<FieldStationRelease> {
    const dir = this.config.get('FIELD_STATION_RELEASE_DIR', { infer: true });
    if (!dir) throw unavailable();
    const path = join(dir, 'release.json');
    try {
      const info = await stat(path);
      const key = `${path}:${info.mtimeMs}:${info.size}`;
      if (this.cached?.key === key) return this.cached.release;
      const release = toRelease(JSON.parse(await readFile(path, 'utf8')) as unknown);
      if (!release) throw unavailable();
      this.cached = { key, release };
      return release;
    } catch (error) {
      this.cached = null;
      throw error instanceof DomainException ? error : unavailable();
    }
  }

  // The current release, or null when it cannot be read: a list of stations never fails for it.
  async currentOrNull(): Promise<FieldStationRelease | null> {
    try {
      return await this.current();
    } catch {
      return null;
    }
  }

  // For `monitoring` (system health, FR-EVT-18) and the station list: is this reported version older
  // than the current release?
  async isOutdated(reported: string | null): Promise<boolean> {
    return isOutdatedAgainst(reported, (await this.currentOrNull())?.version ?? null);
  }
}

// `release.json`: `version`, `publishedAt` and `files[]` with `os`, `fileName`, `sha256` and
// `sizeBytes` (requirements §4). Null when it does not have that shape.
function toRelease(data: unknown): FieldStationRelease | null {
  if (!isRecord(data) || typeof data.version !== 'string' || !parse(data.version)) return null;
  if (typeof data.publishedAt !== 'string' || Number.isNaN(Date.parse(data.publishedAt)))
    return null;
  if (!Array.isArray(data.files) || data.files.length === 0) return null;
  const files: ReleaseFile[] = [];
  for (const file of data.files as unknown[]) {
    if (
      !isRecord(file) ||
      typeof file.os !== 'string' ||
      typeof file.fileName !== 'string' ||
      !FILE_NAME.test(file.fileName) ||
      typeof file.sha256 !== 'string' ||
      !SHA256.test(file.sha256) ||
      typeof file.sizeBytes !== 'number' ||
      !Number.isInteger(file.sizeBytes) ||
      file.sizeBytes < 0
    ) {
      return null;
    }
    files.push({
      os: file.os,
      downloadUrl: `/downloads/field-station/${data.version}/${file.fileName}`,
      sha256: file.sha256.toLowerCase(),
      sizeBytes: file.sizeBytes,
    });
  }
  return { version: data.version, publishedAt: new Date(data.publishedAt).toISOString(), files };
}
