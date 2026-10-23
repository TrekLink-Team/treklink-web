import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

// Environment-level configuration owned by `platform` (specs/platform/requirements.md §4).
// Validated once at boot; the process refuses to start on any missing or malformed value
// (REQ-EVT-01, AC-04). Database selection is by DATABASE_URL alone (REQ-STA-01, D-010).

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const MAIL_TRANSPORTS = ['smtp', 'console'] as const;
export type MailTransportName = (typeof MAIL_TRANSPORTS)[number];

const POSTGRES_URL = /^postgres(ql)?:\/\/\S+$/;
const MQTT_URL = /^(mqtts?|wss?|tcp|ssl):\/\/\S+$/;
const DURATION = /^\d+[smhd]$/;
const BODY_LIMIT = /^\d+(b|kb|mb)$/i;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return value;
};

const toInteger = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string' || value.trim() === '') return value;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : value;
};

const isIanaTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export class EnvironmentVariables {
  @IsIn(NODE_ENVIRONMENTS)
  NODE_ENV: NodeEnvironment = 'development';

  @Transform(toInteger)
  @IsInt()
  @Min(1)
  PORT_BACKEND = 3000;

  @Matches(POSTGRES_URL, { message: 'DATABASE_URL must be a postgres:// or postgresql:// URL' })
  DATABASE_URL!: string;

  // Required (REQ-OPT-02): Prisma migrations connect through it; equals DATABASE_URL locally.
  @Matches(POSTGRES_URL, {
    message: 'DATABASE_DIRECT_URL must be a postgres:// or postgresql:// URL',
  })
  DATABASE_DIRECT_URL!: string;

  @Matches(MQTT_URL, {
    message: 'MQTT_BROKER_URL must be an mqtt://, mqtts://, ws:// or wss:// URL',
  })
  MQTT_BROKER_URL!: string;

  // MQTT_* below are owned by `gateway-sync` (specs/gateway-sync/requirements.md §4).
  // false keeps the subscriber from connecting: the e2e suite and a backend run without a broker.
  @Transform(toBoolean)
  @IsBoolean()
  MQTT_INGESTION_ENABLED = true;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'MQTT_ROOT must be one topic level such as treklink' })
  MQTT_ROOT = 'treklink';

  // A persistent session (clean: false) is keyed by the client id, so it must be stable per backend.
  @IsString()
  @IsNotEmpty()
  MQTT_CLIENT_ID_BACKEND = 'treklink-backend-service';

  // The subscribe-only backend credential; unset against the open local broker of docker-compose.yml.
  @IsOptional()
  @IsString()
  MQTT_USERNAME?: string;

  @IsOptional()
  @IsString()
  MQTT_PASSWORD?: string;

  // JWT_* are owned by `auth` and validated here (platform requirements §4).
  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  // Reserved and unused: the refresh token is opaque and stored as SHA-256 (D-060 rule 6).
  @IsOptional()
  @IsString()
  JWT_REFRESH_SECRET?: string;

  @Matches(DURATION, { message: 'JWT_ACCESS_TTL must look like 15m, 1h or 7d' })
  JWT_ACCESS_TTL = '15m';

  @Matches(DURATION, { message: 'JWT_REFRESH_TTL must look like 15m, 1h or 7d' })
  JWT_REFRESH_TTL = '14d'; // auth requirements §4 (D-060 rule 4)

  // BCRYPT_COST and MAIL_* are owned by `auth` (specs/auth/requirements.md §4).
  @Transform(toInteger)
  @IsInt()
  @Min(4)
  @Max(15)
  BCRYPT_COST = 12;

  // `console` writes outbound email to the server log, for local development and CI (REQ-OPT-01).
  @IsIn(MAIL_TRANSPORTS)
  MAIL_TRANSPORT: MailTransportName = 'console';

  @IsString()
  @IsNotEmpty()
  MAIL_FROM = 'TrekLink <no-reply@treklink.local>';

  @IsOptional()
  @IsString()
  SMTP_URL?: string;

  // Comma-separated list of allowed browser origins.
  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS = 'http://localhost:5173';

  @Matches(BODY_LIMIT, { message: 'HTTP_BODY_LIMIT must look like 512kb or 1mb' })
  HTTP_BODY_LIMIT = '1mb';

  // Default depends on NODE_ENV: true outside production. Resolved in validate().
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED?: boolean;

  @Transform(toInteger)
  @IsInt()
  @Min(1)
  PARAMETER_CACHE_TTL_SECONDS = 30;

  // Upper bound for the health endpoint's `SELECT 1`; slower counts as unreachable (TK-90, D-015).
  @Transform(toInteger)
  @IsInt()
  @Min(1)
  HEALTH_DB_TIMEOUT_MS = 2000;

  @Transform(toInteger)
  @IsInt()
  @Min(1)
  DEFAULT_PAGE_SIZE = 20;

  @Transform(toInteger)
  @IsInt()
  @Min(1)
  MAX_PAGE_SIZE = 100;

  @IsString()
  DISPLAY_TIMEZONE_DEFAULT = 'Asia/Ho_Chi_Minh';
}

export type ValidatedEnvironment = EnvironmentVariables & { SWAGGER_ENABLED: boolean };

export class EnvironmentValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

// Passed to ConfigModule.forRoot({ validate }). Throws naming every invalid variable at once.
export function validate(raw: Record<string, unknown>): ValidatedEnvironment {
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true });
  const problems = validateSync(env, { skipMissingProperties: false }).map(
    (error) =>
      `${error.property}: ${Object.values(error.constraints ?? {}).join('; ') || 'invalid value'}`,
  );

  if (!isIanaTimeZone(env.DISPLAY_TIMEZONE_DEFAULT)) {
    problems.push('DISPLAY_TIMEZONE_DEFAULT: must be an IANA time zone such as Asia/Ho_Chi_Minh');
  }
  if (
    Number.isInteger(env.DEFAULT_PAGE_SIZE) &&
    Number.isInteger(env.MAX_PAGE_SIZE) &&
    env.DEFAULT_PAGE_SIZE > env.MAX_PAGE_SIZE
  ) {
    problems.push('DEFAULT_PAGE_SIZE: must not exceed MAX_PAGE_SIZE');
  }
  if (problems.length > 0) {
    throw new EnvironmentValidationError(problems);
  }

  return Object.assign(env, {
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
  });
}
