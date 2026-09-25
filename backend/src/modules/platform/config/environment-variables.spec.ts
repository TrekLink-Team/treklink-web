import { EnvironmentValidationError, validate } from './environment-variables';

const REQUIRED = {
  DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5432/treklink?schema=public',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

const problemsOf = (raw: Record<string, unknown>): string[] => {
  try {
    validate(raw);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected validate() to throw');
};

describe('validate (environment)', () => {
  it('accepts the required variables and fills every documented default', () => {
    const env = validate({ ...REQUIRED });

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT_BACKEND: 3000,
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
      CORS_ORIGINS: 'http://localhost:5173',
      HTTP_BODY_LIMIT: '1mb',
      SWAGGER_ENABLED: true,
      PARAMETER_CACHE_TTL_SECONDS: 30,
      DEFAULT_PAGE_SIZE: 20,
      MAX_PAGE_SIZE: 100,
      DISPLAY_TIMEZONE_DEFAULT: 'Asia/Ho_Chi_Minh',
    });
    expect(env.DATABASE_DIRECT_URL).toBeUndefined();
  });

  it('names every missing required variable in one error (AC-04)', () => {
    const problems = problemsOf({});

    for (const name of Object.keys(REQUIRED)) {
      expect(problems.some((p) => p.startsWith(`${name}:`))).toBe(true);
    }
  });

  it('rejects a DATABASE_URL that is not a Postgres URL', () => {
    expect(problemsOf({ ...REQUIRED, DATABASE_URL: 'mysql://localhost/treklink' })).toEqual([
      expect.stringMatching(/^DATABASE_URL:/),
    ]);
  });

  it('accepts DATABASE_DIRECT_URL when it is a Postgres URL and rejects it otherwise', () => {
    const direct = 'postgresql://user:pw@direct.example:5432/treklink';
    expect(validate({ ...REQUIRED, DATABASE_DIRECT_URL: direct }).DATABASE_DIRECT_URL).toBe(direct);
    expect(problemsOf({ ...REQUIRED, DATABASE_DIRECT_URL: 'not-a-url' })).toEqual([
      expect.stringMatching(/^DATABASE_DIRECT_URL:/),
    ]);
  });

  it('converts numeric and boolean strings from the process environment', () => {
    const env = validate({
      ...REQUIRED,
      PORT_BACKEND: '4000',
      DEFAULT_PAGE_SIZE: '10',
      SWAGGER_ENABLED: 'false',
    });

    expect(env.PORT_BACKEND).toBe(4000);
    expect(env.DEFAULT_PAGE_SIZE).toBe(10);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('turns Swagger off by default in production only', () => {
    expect(validate({ ...REQUIRED, NODE_ENV: 'production' }).SWAGGER_ENABLED).toBe(false);
    expect(validate({ ...REQUIRED, NODE_ENV: 'test' }).SWAGGER_ENABLED).toBe(true);
  });

  it('rejects malformed values with the variable name', () => {
    const problems = problemsOf({
      ...REQUIRED,
      NODE_ENV: 'staging',
      MQTT_BROKER_URL: 'localhost:1883',
      JWT_ACCESS_TTL: 'fifteen minutes',
      HTTP_BODY_LIMIT: 'huge',
      SWAGGER_ENABLED: 'yes',
      PARAMETER_CACHE_TTL_SECONDS: '0',
      DISPLAY_TIMEZONE_DEFAULT: 'Mars/Olympus_Mons',
    });

    for (const name of [
      'NODE_ENV',
      'MQTT_BROKER_URL',
      'JWT_ACCESS_TTL',
      'HTTP_BODY_LIMIT',
      'SWAGGER_ENABLED',
      'PARAMETER_CACHE_TTL_SECONDS',
      'DISPLAY_TIMEZONE_DEFAULT',
    ]) {
      expect(problems.some((p) => p.startsWith(`${name}:`))).toBe(true);
    }
  });

  it('rejects a default page size above the maximum', () => {
    expect(problemsOf({ ...REQUIRED, DEFAULT_PAGE_SIZE: '200', MAX_PAGE_SIZE: '100' })).toEqual([
      expect.stringMatching(/^DEFAULT_PAGE_SIZE:/),
    ]);
  });
});
