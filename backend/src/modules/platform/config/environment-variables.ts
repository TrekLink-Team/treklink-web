import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  validateSync,
} from 'class-validator';

// Environment-level configuration owned by `platform` (specs/platform/requirements.md §4).
// Validated once at boot; the process refuses to start on any missing or malformed value
// (REQ-EVT-01, AC-04). Database selection is by DATABASE_URL alone (REQ-STA-01, D-010).

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

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

  // JWT_* are owned by `auth` and validated here (platform requirements §4).
  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;

  @Matches(DURATION, { message: 'JWT_ACCESS_TTL must look like 15m, 1h or 7d' })
  JWT_ACCESS_TTL = '15m';

  @Matches(DURATION, { message: 'JWT_REFRESH_TTL must look like 15m, 1h or 7d' })
  JWT_REFRESH_TTL = '7d';

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
