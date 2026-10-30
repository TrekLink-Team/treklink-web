import { EnvironmentValidationError, validate } from './environment-variables';

const REQUIRED = {
  DATABASE_URL: 'postgresql://postgres:postgrespassword@localhost:5432/treklink?schema=public',
  DATABASE_DIRECT_URL:
    'postgresql://postgres:postgrespassword@localhost:5432/treklink?schema=public',
  MQTT_BROKER_URL: 'mqtt://localhost:1883',
  JWT_ACCESS_SECRET: 'access-secret',
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
      JWT_REFRESH_TTL: '14d',
      MQTT_INGESTION_ENABLED: true,
      MQTT_ROOT: 'treklink',
      MQTT_CLIENT_ID_BACKEND: 'treklink-backend-service',
      CORS_ORIGINS: 'http://localhost:5173',
      HTTP_BODY_LIMIT: '1mb',
      RENTALS_HANDOVER_BODY_LIMIT: '2mb',
      SWAGGER_ENABLED: true,
      PARAMETER_CACHE_TTL_SECONDS: 30,
      HEALTH_DB_TIMEOUT_MS: 2000,
      DEFAULT_PAGE_SIZE: 20,
      MAX_PAGE_SIZE: 100,
      DISPLAY_TIMEZONE_DEFAULT: 'Asia/Ho_Chi_Minh',
      BCRYPT_COST: 12,
      MAIL_TRANSPORT: 'console',
      MAIL_FROM: 'TrekLink <no-reply@treklink.local>',
      COMPANY_LEGAL_NAME: 'TrekLink Technology Company Limited',
      COMPANY_TAX_CODE: '0000000000',
      COMPANY_HOTLINE: '1900 0000',
    });
  });

  it('reads the handover note issuer and rejects a malformed tax code or hotline', () => {
    const env = validate({
      ...REQUIRED,
      COMPANY_LEGAL_NAME: 'Công ty TNHH TrekLink',
      COMPANY_TAX_CODE: '0312345678-001',
      COMPANY_HOTLINE: '+84 28 1234 5678',
      HANDOVER_PLACE: 'Counter 1',
    });
    expect(env).toMatchObject({
      COMPANY_LEGAL_NAME: 'Công ty TNHH TrekLink',
      COMPANY_TAX_CODE: '0312345678-001',
      COMPANY_HOTLINE: '+84 28 1234 5678',
      HANDOVER_PLACE: 'Counter 1',
    });
    const problems = problemsOf({
      ...REQUIRED,
      COMPANY_TAX_CODE: '12345',
      COMPANY_HOTLINE: 'call us',
      COMPANY_ADDRESS: '',
    });
    expect(problems).toContainEqual(expect.stringMatching(/^COMPANY_TAX_CODE:/));
    expect(problems).toContainEqual(expect.stringMatching(/^COMPANY_HOTLINE:/));
    expect(problems).toContainEqual(expect.stringMatching(/^COMPANY_ADDRESS:/));
  });

  it('validates the independent handover signature body limit', () => {
    expect(
      validate({ ...REQUIRED, RENTALS_HANDOVER_BODY_LIMIT: '512kb' }).RENTALS_HANDOVER_BODY_LIMIT,
    ).toBe('512kb');
    expect(problemsOf({ ...REQUIRED, RENTALS_HANDOVER_BODY_LIMIT: 'unlimited' })).toContainEqual(
      expect.stringMatching(/^RENTALS_HANDOVER_BODY_LIMIT:/),
    );
  });

  it('reads the auth variables and rejects a bcrypt cost or mail transport out of range', () => {
    expect(validate({ ...REQUIRED, BCRYPT_COST: '10', SMTP_URL: 'smtp://mail:25' })).toMatchObject({
      BCRYPT_COST: 10,
      SMTP_URL: 'smtp://mail:25',
    });
    expect(problemsOf({ ...REQUIRED, BCRYPT_COST: '3', MAIL_TRANSPORT: 'pigeon' })).toEqual([
      expect.stringMatching(/^BCRYPT_COST:/),
      expect.stringMatching(/^MAIL_TRANSPORT:/),
    ]);
  });

  it('keeps values that are already typed and rejects an empty number', () => {
    expect(validate({ ...REQUIRED, SWAGGER_ENABLED: true, BCRYPT_COST: 11 })).toMatchObject({
      SWAGGER_ENABLED: true,
      BCRYPT_COST: 11,
    });
    expect(validate({ ...REQUIRED, SWAGGER_ENABLED: ' TRUE ' }).SWAGGER_ENABLED).toBe(true);
    expect(problemsOf({ ...REQUIRED, BCRYPT_COST: '' })).toEqual([
      expect.stringMatching(/^BCRYPT_COST:/),
    ]);
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

  it('requires DATABASE_DIRECT_URL (REQ-OPT-02)', () => {
    const withoutDirect = { ...REQUIRED, DATABASE_DIRECT_URL: undefined };
    expect(problemsOf(withoutDirect)).toEqual([expect.stringMatching(/^DATABASE_DIRECT_URL:/)]);
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
      HEALTH_DB_TIMEOUT_MS: '500',
      SWAGGER_ENABLED: 'false',
    });

    expect(env.PORT_BACKEND).toBe(4000);
    expect(env.HEALTH_DB_TIMEOUT_MS).toBe(500);
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
      HEALTH_DB_TIMEOUT_MS: '1.5',
      DISPLAY_TIMEZONE_DEFAULT: 'Mars/Olympus_Mons',
    });

    for (const name of [
      'NODE_ENV',
      'MQTT_BROKER_URL',
      'JWT_ACCESS_TTL',
      'HTTP_BODY_LIMIT',
      'SWAGGER_ENABLED',
      'PARAMETER_CACHE_TTL_SECONDS',
      'HEALTH_DB_TIMEOUT_MS',
      'DISPLAY_TIMEZONE_DEFAULT',
    ]) {
      expect(problems.some((p) => p.startsWith(`${name}:`))).toBe(true);
    }
  });

  it('leaves the Field Station release directory and broker address unset, and checks the broker address (organizations 2.8)', () => {
    const env = validate({ ...REQUIRED });
    expect(env.FIELD_STATION_RELEASE_DIR).toBeUndefined();
    expect(env.FIELD_STATION_BROKER_URL).toBeUndefined();

    expect(
      validate({
        ...REQUIRED,
        FIELD_STATION_RELEASE_DIR: '/srv/field-station',
        FIELD_STATION_BROKER_URL: 'mqtts://mqtt.treklink.vn:8883',
      }),
    ).toMatchObject({
      FIELD_STATION_RELEASE_DIR: '/srv/field-station',
      FIELD_STATION_BROKER_URL: 'mqtts://mqtt.treklink.vn:8883',
    });
    expect(
      problemsOf({ ...REQUIRED, FIELD_STATION_BROKER_URL: 'http://mqtt.treklink.vn' }),
    ).toEqual([expect.stringContaining('FIELD_STATION_BROKER_URL')]);
  });

  it('rejects a default page size above the maximum', () => {
    expect(problemsOf({ ...REQUIRED, DEFAULT_PAGE_SIZE: '200', MAX_PAGE_SIZE: '100' })).toEqual([
      expect.stringMatching(/^DEFAULT_PAGE_SIZE:/),
    ]);
  });
});
