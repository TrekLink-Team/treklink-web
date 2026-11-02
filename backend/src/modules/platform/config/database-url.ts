import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from './environment-variables';

// Pure checks of a Postgres connection URL for the demo control panel (specs/demo/design.md §2) and the
// field simulation (§9). They live in platform because both `demo` and `gateway-sync` run them, and
// `gateway-sync` must not import `demo` (demo depends on gateway-sync).

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Query parameters that move a Postgres connection away from the URL's host. Prisma's Postgres driver
// connects to `host` when the query carries it (a socket directory or a host name), so
// `postgresql://u:p@localhost/db?host=ep-x.neon.tech` reaches Neon (review of treklink-web#245). The
// libpq names `hostaddr`, `service` and `servicefile` are refused too: a later driver or a tool reading
// the same variable may honour them.
export const TARGET_PARAMETERS: readonly string[] = ['host', 'hostaddr', 'service', 'servicefile'];

const decodeOnce = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// A query key as any parser could read it: trimmed and lower-cased, and decoded once more, so a
// double-encoded `%2568ost` counts as `host`. Refusing too much is safe here.
const keyForms = (key: string): string[] => {
  const plain = key.trim().toLowerCase();
  return [plain, decodeOnce(plain).trim().toLowerCase()];
};

// True when any query key of `url`, in any of its forms above, is one of `names` (lower case). Shared by
// the loopback check and the staging check below.
export const carriesQueryParameter = (url: URL, names: readonly string[]): boolean => {
  for (const key of url.searchParams.keys()) {
    if (keyForms(key).some((form) => names.includes(form))) return true;
  }
  return false;
};

// True only when the URL's host is `localhost`, an IPv4 address in 127.0.0.0/8 or `::1`, and its query
// carries no parameter that changes the connection target. False for anything else, including a
// string that does not parse as a URL. The case it exists for is a Neon host (`*.neon.tech`, D-062).
export const isLoopbackDatabaseUrl = (databaseUrl: string): boolean => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  if (carriesQueryParameter(url, TARGET_PARAMETERS)) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost') return true;
  if (host === '[::1]' || host === '::1') return true;
  const v4 = IPV4_LOOPBACK.exec(host);
  return v4 !== null && v4.slice(1).every((octet) => Number(octet) <= 255);
};

// The database of the Vercel staging (D-094), the name `backend/scripts/vercel-build.sh` requires before
// it migrates and seeds.
export const STAGING_DATABASE = 'treklink_prod';

// The database name of a Postgres URL: its path without the leading slash, decoded once; null for a
// string that does not parse as a URL.
export const databaseNameOf = (databaseUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  const name = url.pathname.replace(/^\//, '');
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

// Query parameters the staging branch refuses: the connection-target parameters of the loopback check,
// plus the libpq and driver names that override the database of the path (review of treklink-web#307:
// `.../treklink_prod?host=ep-dev.neon.tech` or `?dbname=neondb` would otherwise reach the shared `dev`).
export const STAGING_REFUSED_PARAMETERS: readonly string[] = [
  ...TARGET_PARAMETERS,
  'dbname',
  'database',
];

// The staging branch: the path names `treklink_prod` and the query carries none of the parameters above,
// in any case and after one more decoding (the helper of the loopback check).
const isStagingDatabaseUrl = (databaseUrl: string): boolean => {
  if (databaseNameOf(databaseUrl) !== STAGING_DATABASE) return false;
  return !carriesQueryParameter(new URL(databaseUrl), STAGING_REFUSED_PARAMETERS);
};

// REQ-SIM-02: a loopback database (the same test as the control panel, design §2) or one named
// `treklink_prod`. The shared Neon `dev` database of D-062 is neither. The demo guard checks it on
// every write, the field simulation's `run` on every run.
export const isSimulationDatabaseUrl = (databaseUrl: string): boolean =>
  isLoopbackDatabaseUrl(databaseUrl) || isStagingDatabaseUrl(databaseUrl);

// Both connections: the backend's (DATABASE_URL) and the one `prisma migrate` uses.
export const simulationDatabaseAllowed = (
  config: ConfigService<ValidatedEnvironment, true>,
): boolean =>
  isSimulationDatabaseUrl(config.get('DATABASE_URL', { infer: true })) &&
  isSimulationDatabaseUrl(config.get('DATABASE_DIRECT_URL', { infer: true }));
