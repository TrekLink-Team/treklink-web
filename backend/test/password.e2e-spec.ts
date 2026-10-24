import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MAIL_PORT, MailMessage } from '../src/modules/auth';

// Forgot, reset, invitation, change and the Staff-triggered reset through the real HTTP pipeline
// (specs/auth/api-design 05 to 08 and 14, US-UC09). The database is an in-memory stub of the calls
// `auth` makes, as in auth.e2e-spec.ts. Mail goes to a capturing port, so the tests read the code the
// way the user would, from the email. AC-06: no response and no log line holds a code or a password.

interface StoredCode {
  id: string;
  userId: string;
  purpose: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

interface StoredToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

interface Session {
  accessToken: string;
  refreshToken: string;
}

const PARAMETERS: Record<string, number> = {
  'auth.passwordMinLength': 8,
  'auth.loginMaxFailures': 5,
  'auth.loginFailureWindowMinutes': 15,
  'auth.lockoutMinutes': 15,
  'auth.resetCodeTtlMinutes': 10,
  'auth.invitationTtlHours': 72,
  'auth.codeMaxAttempts': 5,
  'auth.codeResendCooldownSeconds': 60,
};

const PERMISSIONS: Record<string, unknown[]> = {
  STAFF: [
    {
      key: 'account.triggerReset',
      action: 'triggerReset',
      subject: 'Account',
      conditions: null,
      fields: [],
      inverted: false,
      reason: null,
    },
  ],
};

const resultOf = <T>(response: request.Response): T => (response.body as { result: T }).result;

const codeIn = (message: MailMessage): string => /code is (\d{6})/.exec(message.text)![1];

describe('password flows (e2e)', () => {
  let app: NestExpressApplication;
  let users: Record<string, Record<string, unknown>>;
  let codes: StoredCode[];
  let tokens: StoredToken[];
  let audit: Record<string, unknown>[];
  const mails: MailMessage[] = [];
  const output: string[] = [];

  const matches = (row: object, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const field = (row as Record<string, unknown>)[key];
      // The two range filters the repository uses: `{ gt }` on a date, `{ lt }` on a count.
      if (value && typeof value === 'object' && 'gt' in value) {
        return (field as Date) > (value as { gt: Date }).gt;
      }
      if (value && typeof value === 'object' && 'lt' in value) {
        return (field as number) < (value as { lt: number }).lt;
      }
      return field === value;
    });

  const byWhere = (where: { email?: string; id?: string }) =>
    Object.values(users).find((user) => user.email === where.email || user.id === where.id);

  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    businessParameter: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve({ key: where.key, value: PARAMETERS[where.key] }),
    },
    user: {
      findUnique: ({ where }: { where: { email?: string; id?: string } }) => {
        const user = byWhere(where);
        return Promise.resolve(user ? { ...user } : null);
      },
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(users[where.id], data);
        return Promise.resolve(users[where.id]);
      },
    },
    authEvent: {
      create: ({ data }: { data: unknown }) => Promise.resolve(data),
      count: () => Promise.resolve(0),
    },
    auditLog: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return Promise.resolve(data);
      },
    },
    rolePermission: {
      findMany: ({ where }: { where: { role: { key: string } } }) =>
        Promise.resolve((PERMISSIONS[where.role.key] ?? []).map((permission) => ({ permission }))),
    },
    oneTimeCode: {
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        const newest = codes
          .filter((code) => matches(code, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return Promise.resolve(newest ?? null);
      },
      create: ({
        data,
      }: {
        data: Omit<StoredCode, 'id' | 'attempts' | 'consumedAt' | 'createdAt'>;
      }) => {
        const row = {
          ...data,
          id: `otp-${codes.length + 1}`,
          attempts: 0,
          consumedAt: null,
          createdAt: new Date(Date.now() + codes.length),
        };
        codes.push(row);
        return Promise.resolve(row);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Omit<StoredCode, 'attempts'>> & { attempts?: { increment: number } };
      }) => {
        const hits = codes.filter((code) => matches(code, where));
        hits.forEach((code) => {
          const { attempts, ...rest } = data;
          Object.assign(code, rest);
          if (attempts) code.attempts += attempts.increment;
        });
        return Promise.resolve({ count: hits.length });
      },
    },
    refreshToken: {
      create: ({ data }: { data: Omit<StoredToken, 'id' | 'revokedAt' | 'replacedById'> }) => {
        const row = { ...data, id: `rt-${tokens.length + 1}`, revokedAt: null, replacedById: null };
        tokens.push(row);
        return Promise.resolve({ id: row.id });
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(tokens.find((token) => token.tokenHash === where.tokenHash) ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<StoredToken>;
      }) => {
        const hits = tokens.filter((token) => matches(token, where));
        hits.forEach((token) => Object.assign(token, data));
        return Promise.resolve({ count: hits.length });
      },
    },
  };

  const post = (path: string, body: object, accessToken?: string) => {
    const call = request(app.getHttpServer()).post(path).send(body);
    return accessToken ? call.set('Authorization', `Bearer ${accessToken}`) : call;
  };
  const login = (email: string, password: string) => post('/api/auth/login', { email, password });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(MAIL_PORT)
      .useValue({
        send: (message: MailMessage) => {
          mails.push(message);
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
      jest.spyOn(stream, 'write').mockImplementation((chunk: unknown, ...rest: unknown[]) => {
        output.push(String(chunk));
        return write(chunk, ...rest);
      });
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  beforeEach(async () => {
    const hash = await bcrypt.hash('old-password', 4);
    const account = (id: string, email: string, role: string, passwordHash: string | null) => ({
      id,
      email,
      fullName: id,
      accountType: 'TREKLINK',
      isActive: true,
      deletedAt: null,
      passwordHash,
      lockedUntil: null,
      lastLoginAt: null,
      roles: [{ role: { key: role } }],
    });
    users = {
      'staff-1': account('staff-1', 'staff@treklink.vn', 'STAFF', hash),
      'admin-1': account('admin-1', 'admin@treklink.vn', 'ADMIN', hash),
      'invitee-1': account('invitee-1', 'invitee@treklink.vn', 'STAFF', null),
    };
    codes = [];
    tokens = [];
    audit = [];
    mails.length = 0;
  });

  it('answers forgot the same for a known and an unknown email, and emails the code (api-design 05)', async () => {
    const unknown = await post('/api/auth/password/forgot', { email: 'ghost@treklink.vn' }).expect(
      200,
    );
    const known = await post('/api/auth/password/forgot', { email: 'Admin@TrekLink.vn' }).expect(
      200,
    );

    expect(known.body).toEqual(unknown.body);
    expect(known.body).toEqual({
      result: null,
      isSuccess: true,
      statusCode: 200,
      message: 'If the email is registered, a code has been sent.',
    });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      to: 'admin@treklink.vn',
      subject: 'Your TrekLink password reset code',
    });
  });

  it('answers a second request inside the cooldown as usual and sends nothing (REQ-ERR-08, D-063 rule 2)', async () => {
    const first = await post('/api/auth/password/forgot', { email: 'admin@treklink.vn' }).expect(
      200,
    );
    const again = await post('/api/auth/password/forgot', { email: 'admin@treklink.vn' }).expect(
      200,
    );

    expect(again.body).toEqual(first.body);
    expect(mails).toHaveLength(1);
  });

  it('resets with the emailed code, ends every session and refuses the code twice (api-design 06)', async () => {
    const before = resultOf<Session>(await login('admin@treklink.vn', 'old-password').expect(200));
    await post('/api/auth/password/forgot', { email: 'admin@treklink.vn' }).expect(200);
    const code = codeIn(mails[0]);

    const wrong = await post('/api/auth/password/reset', {
      email: 'admin@treklink.vn',
      code: code === '000000' ? '111111' : '000000',
      newPassword: 'brand-new-password',
    }).expect(400);
    expect(wrong.body).toMatchObject({
      result: { errorCode: 'CODE_INVALID' },
      message: 'This code is invalid or has expired. Request a new one.',
    });

    const weak = await post('/api/auth/password/reset', {
      email: 'admin@treklink.vn',
      code,
      newPassword: 'short',
    }).expect(400);
    expect(weak.body).toMatchObject({ result: { errorCode: 'PASSWORD_POLICY' } });

    const reset = await post('/api/auth/password/reset', {
      email: 'admin@treklink.vn',
      code,
      newPassword: 'brand-new-password',
    }).expect(200);
    expect(reset.body).toEqual({
      result: null,
      isSuccess: true,
      statusCode: 200,
      message: 'Password changed',
    });

    await post('/api/auth/refresh', { refreshToken: before.refreshToken }).expect(401);
    await login('admin@treklink.vn', 'old-password').expect(401);
    await login('admin@treklink.vn', 'brand-new-password').expect(200);
    await post('/api/auth/password/reset', {
      email: 'admin@treklink.vn',
      code,
      newPassword: 'another-password',
    }).expect(400);
  });

  it('accepts an invitation code and signs the user in (api-design 07)', async () => {
    await post('/api/auth/password/forgot', { email: 'invitee@treklink.vn' }).expect(200);
    expect(mails[0].subject).toBe('Your TrekLink invitation code');

    const welcome = await post('/api/auth/password/set', {
      email: 'invitee@treklink.vn',
      code: codeIn(mails[0]),
      password: 'first-password',
    }).expect(200);

    expect(welcome.body).toMatchObject({
      isSuccess: true,
      message: 'Welcome to TrekLink',
      result: {
        accessToken: expect.any(String) as string,
        refreshToken: expect.stringMatching(/^rt_/) as string,
        user: { id: 'invitee-1', email: 'invitee@treklink.vn', roles: ['STAFF'] },
      },
    });
    await login('invitee@treklink.vn', 'first-password').expect(200);
  });

  it('changes the password after checking the current one and ends every session (api-design 08)', async () => {
    const session = resultOf<Session>(await login('staff@treklink.vn', 'old-password').expect(200));

    const wrong = await post(
      '/api/auth/password/change',
      { currentPassword: 'not-it', newPassword: 'brand-new-password' },
      session.accessToken,
    ).expect(400);
    expect(wrong.body).toMatchObject({
      result: { errorCode: 'INVALID_CREDENTIALS' },
      message: 'The current password is incorrect.',
    });

    await post(
      '/api/auth/password/change',
      { currentPassword: 'old-password', newPassword: 'brand-new-password' },
      session.accessToken,
    ).expect(200);
    await post('/api/auth/refresh', { refreshToken: session.refreshToken }).expect(401);
    await login('staff@treklink.vn', 'brand-new-password').expect(200);
    await post('/api/auth/password/change', { currentPassword: 'a', newPassword: 'b' }).expect(401);
  });

  it("lets Staff send a reset code to another account's own email without seeing it (api-design 14, AC-06)", async () => {
    const staff = resultOf<Session>(await login('staff@treklink.vn', 'old-password').expect(200));

    const response = await post('/api/accounts/admin-1/password-reset', {}, staff.accessToken);
    expect(response.status).toBe(400);

    const sent = await post(
      `/api/accounts/${'3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f'}/password-reset`,
      {},
      staff.accessToken,
    ).expect(404);
    expect(sent.body).toMatchObject({
      result: { errorCode: 'NOT_FOUND' },
      message: 'Account not found.',
    });

    users['3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f'] = {
      ...users['admin-1'],
      id: '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f',
      email: 'manager@acme-trek.vn',
    };
    const ok = await post(
      '/api/accounts/3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f/password-reset',
      {},
      staff.accessToken,
    ).expect(200);
    expect(ok.body).toEqual({
      result: null,
      isSuccess: true,
      statusCode: 200,
      message: 'Reset code sent to the account email',
    });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('manager@acme-trek.vn');

    const again = await post(
      '/api/accounts/3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f/password-reset',
      {},
      staff.accessToken,
    ).expect(429);
    expect(again.body).toMatchObject({ result: { errorCode: 'OTP_COOLDOWN' } });
    expect(mails).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(audit).toContainEqual(
      expect.objectContaining({
        actorId: 'staff-1',
        action: 'account.triggerReset',
        subjectId: '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f',
      }),
    );
  });

  it('never writes a code or a password to a response or a log line (AC-06)', async () => {
    const before = output.length;
    const bodies: string[] = [];
    await post('/api/auth/password/forgot', { email: 'admin@treklink.vn' }).expect(200);
    const code = codeIn(mails[0]);
    for (const response of [
      await post('/api/auth/password/reset', {
        email: 'admin@treklink.vn',
        code: '999999',
        newPassword: 'secret-password-1',
      }),
      await post('/api/auth/password/reset', {
        email: 'admin@treklink.vn',
        code,
        newPassword: 'secret-password-1',
      }),
      await login('admin@treklink.vn', 'secret-password-1'),
    ]) {
      bodies.push(JSON.stringify(response.body));
    }

    const written = [...bodies, ...output.slice(before)].join('\n');
    expect(written).not.toContain(code);
    expect(written).not.toContain('secret-password-1');
  });
});
