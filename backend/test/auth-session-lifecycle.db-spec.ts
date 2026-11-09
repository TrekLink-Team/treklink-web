import { AccountType, MemberRole, OrganizationStatus } from '@prisma/client';
import { PasswordService } from '../src/modules/auth/password.service';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

interface Envelope {
  isSuccess: boolean;
  statusCode: number;
  message: string;
  result: { errorCode?: string; accessToken?: string; refreshToken?: string };
}

type Org = Awaited<ReturnType<RentalFlow['organization']>>;

const PASSWORD = 'correct-horse-battery-1';

// The session of an organization member over HTTP against Postgres, through the real sign-in,
// refresh and member endpoints (auth AC-04, REQ-EVT-07, REQ-STA-03, REQ-ERR-04, REQ-ERR-05; the unit
// specs of the same rules mock the account and the membership). The whole application with real
// guards and services (test/db-rental-flow.ts). Run only through test:db against a migrated
// disposable database; every fixture carries a fresh ID and nothing is deleted.
describe('member sessions over HTTP against Postgres (auth AC-04, REQ-STA-03)', () => {
  let flow: RentalFlow;
  let passwords: PasswordService;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
    passwords = flow.get(PasswordService);
  });

  afterAll(async () => {
    await flow?.close();
  });

  // An Operator of the organization with a real password, so it can sign in through the endpoint.
  const operatorOf = async (org: Org) => {
    const userId = await flow.user(AccountType.ORGANIZATION, 'ORG_OPERATOR');
    const member = await flow.prisma.organizationMember.create({
      data: { userId, organizationId: org.id, role: MemberRole.OPERATOR },
    });
    const user = await flow.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await passwords.hash(PASSWORD) },
    });
    return { userId, memberId: member.id, email: user.email };
  };

  const login = (email: string, password = PASSWORD) =>
    flow.sendAs(null, 'post', '/api/auth/login', { email, password });
  const bodyOf = (response: { body: unknown }) => response.body as Envelope;

  const signIn = async (email: string) => {
    const response = await login(email);
    expect(response.status).toBe(200);
    const { accessToken, refreshToken } = bodyOf(response).result;
    return { accessToken: accessToken as string, refreshToken: refreshToken as string };
  };

  // A member the organization has just deactivated or closed out is refused like a wrong password
  // (MSG09, REQ-ERR-01): the same status, code and text as for an unknown email.
  const expectRefusedLikeWrongPassword = async (email: string) => {
    const refused = await login(email);
    const wrong = await login(`unknown-${flow.next()}@example.invalid`, 'whatever-it-is');
    expect({ status: refused.status, code: bodyOf(refused).result.errorCode }).toEqual({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(bodyOf(refused).message).toBe(bodyOf(wrong).message);
  };

  it('ends every session of a member at once when the Manager deactivates it (AC-04, REQ-EVT-07)', async () => {
    const org = await flow.organization();
    const operator = await operatorOf(org);
    const tokens = await signIn(operator.email);
    expect((await flow.sendAs(tokens.accessToken, 'get', '/api/auth/me')).status).toBe(200);

    const deactivated = await flow.send(
      org.manager,
      'post',
      `/api/organizations/${org.id}/members/${operator.memberId}/deactivate`,
      {},
    );
    expect(deactivated.status).toBe(200);

    expect(
      (await flow.sendAs(null, 'post', '/api/auth/refresh', { refreshToken: tokens.refreshToken }))
        .status,
    ).toBe(401);
    expect((await flow.sendAs(tokens.accessToken, 'get', '/api/auth/me')).status).toBe(401);
    expect(
      (
        await flow.sendAs(tokens.accessToken, 'post', '/api/auth/password/change', {
          currentPassword: PASSWORD,
          newPassword: 'another-long-password-2',
        })
      ).status,
    ).toBe(401);
    await expectRefusedLikeWrongPassword(operator.email);
  });

  it.each([OrganizationStatus.PENDING, OrganizationStatus.SUSPENDED])(
    'lets a member of a %s organization sign in and refresh (REQ-STA-03)',
    async (status) => {
      const org = await flow.organization();
      await flow.prisma.organization.update({ where: { id: org.id }, data: { status } });
      const operator = await operatorOf(org);

      const tokens = await signIn(operator.email);

      expect((await flow.sendAs(tokens.accessToken, 'get', '/api/auth/me')).status).toBe(200);
      expect(
        (
          await flow.sendAs(null, 'post', '/api/auth/refresh', {
            refreshToken: tokens.refreshToken,
          })
        ).status,
      ).toBe(200);
    },
  );

  it.each([OrganizationStatus.CLOSED, OrganizationStatus.REJECTED])(
    'refuses the sign-in of a member of a %s organization like a wrong password (REQ-STA-03)',
    async (status) => {
      const org = await flow.organization();
      await flow.prisma.organization.update({ where: { id: org.id }, data: { status } });
      const operator = await operatorOf(org);

      await expectRefusedLikeWrongPassword(operator.email);
    },
  );

  it('ends the sessions of a member when an Admin closes the organization (REQ-EVT-06, REQ-STA-03)', async () => {
    const org = await flow.organization();
    const operator = await operatorOf(org);
    const tokens = await signIn(operator.email);
    const row = await flow.prisma.organization.findUniqueOrThrow({ where: { id: org.id } });

    const closed = await flow.send(
      await flow.admin(),
      'post',
      `/api/organizations/${org.id}/close`,
      {
        reason: 'Closed by the session lifecycle spec.',
        expectedVersion: row.version,
      },
    );
    expect(closed.status).toBe(200);

    expect(
      (await flow.sendAs(null, 'post', '/api/auth/refresh', { refreshToken: tokens.refreshToken }))
        .status,
    ).toBe(401);
    expect((await flow.sendAs(tokens.accessToken, 'get', '/api/auth/me')).status).toBe(401);
    await expectRefusedLikeWrongPassword(operator.email);
  });

  it('refuses a password shorter than auth.passwordMinLength with 400 PASSWORD_POLICY (REQ-ERR-04)', async () => {
    const org = await flow.organization();
    const operator = await operatorOf(org);
    const tokens = await signIn(operator.email);

    const response = await flow.sendAs(tokens.accessToken, 'post', '/api/auth/password/change', {
      currentPassword: PASSWORD,
      newPassword: 'short',
    });

    expect({ status: response.status, code: bodyOf(response).result.errorCode }).toEqual({
      status: 400,
      code: 'PASSWORD_POLICY',
    });
    expect((await login(operator.email)).status).toBe(200);
  });

  it('refuses an invitation to the email of a soft-deleted account, in any letter case (REQ-ERR-05)', async () => {
    const org = await flow.organization();
    const email = `deleted-${flow.next()}@example.invalid`;
    await flow.prisma.user.create({
      data: {
        email,
        fullName: 'Deleted account',
        accountType: AccountType.ORGANIZATION,
        isActive: false,
        deletedAt: new Date(),
      },
    });

    const response = await flow.send(org.manager, 'post', `/api/organizations/${org.id}/members`, {
      email: email.toUpperCase(),
      fullName: 'Invited again',
      role: MemberRole.OPERATOR,
    });

    expect({ status: response.status, code: bodyOf(response).result.errorCode }).toEqual({
      status: 409,
      code: 'CONFLICT_UNIQUE',
    });
  });
});
