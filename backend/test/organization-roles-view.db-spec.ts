import { AccountType, MemberRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

interface RoleView {
  key: string;
  version: number;
  baselineKeys: string[];
  effectiveKeys: string[];
}
interface RolesBody {
  result: { roles: RoleView[]; catalog: { key: string }[] };
}

// GET /api/organizations/:id/roles over HTTP against Postgres (organizations api-design 33, REQ-EVT-14,
// D-095, treklink-web#418): the read of the stored per-organization role policy by TrekLink Staff and
// Admin, the refusal of a Manager and an Operator, the 404 of an unknown organization, and the isolation
// of one organization's customised role from another's. The whole application with real guards,
// policies and services (test/db-rental-flow.ts). Run only through test:db against a migrated
// disposable database; every fixture carries a fresh ID and nothing is deleted.
describe('organization roles view over HTTP against Postgres (api-design 33)', () => {
  let flow: RentalFlow;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  });

  afterAll(async () => {
    await flow?.close();
  });

  const rolesOf = (caller: Parameters<RentalFlow['send']>[0], organizationId: string) =>
    flow.send(caller, 'get', `/api/organizations/${organizationId}/roles`);
  const roleOf = (body: unknown, key: string) =>
    (body as RolesBody).result.roles.find((role) => role.key === key) as RoleView;

  // An organization whose Manager has saved ORG_OPERATOR without its first baseline permission.
  const customised = async () => {
    const org = await flow.organization();
    const own = await flow.send(org.manager, 'get', '/api/organization/roles');
    const operator = roleOf(own.body, 'ORG_OPERATOR');
    const [removed, ...kept] = operator.baselineKeys;
    const saved = await flow.send(
      org.manager,
      'put',
      '/api/organization/roles/ORG_OPERATOR/permissions',
      {
        permissionKeys: kept,
        expectedVersion: operator.version,
      },
    );
    expect(saved.status).toBe(200);
    return { org, removed, kept, saved: (saved.body as { result: RoleView }).result };
  };

  it('gives TrekLink Staff the saved policy of the organization, and the baseline of another', async () => {
    const { org, removed, saved } = await customised();
    const untouched = await flow.organization();

    const response = await rolesOf(flow.staff, org.id);

    expect({
      status: response.status,
      ok: (response.body as { isSuccess: boolean }).isSuccess,
    }).toEqual({
      status: 200,
      ok: true,
    });
    const operator = roleOf(response.body, 'ORG_OPERATOR');
    expect(operator.version).toBe(saved.version);
    expect(operator.effectiveKeys).toEqual(saved.effectiveKeys);
    expect(operator.baselineKeys).toContain(removed);
    expect(operator.effectiveKeys).not.toContain(removed);
    expect((response.body as RolesBody).result.catalog.length).toBeGreaterThan(0);

    const other = roleOf((await rolesOf(flow.staff, untouched.id)).body, 'ORG_OPERATOR');
    expect(other.effectiveKeys).toEqual(other.baselineKeys);
    expect(other.effectiveKeys).toContain(removed);
  });

  it('gives a TrekLink Admin the same view', async () => {
    const { org, saved } = await customised();

    const response = await rolesOf(await flow.admin(), org.id);

    expect(response.status).toBe(200);
    expect(roleOf(response.body, 'ORG_OPERATOR').effectiveKeys).toEqual(saved.effectiveKeys);
  });

  it('refuses the Manager of the organization, an Operator of it and the Manager of another with 403', async () => {
    const { org } = await customised();
    const operatorId = await flow.user(AccountType.ORGANIZATION, 'ORG_OPERATOR');
    await flow.prisma.organizationMember.create({
      data: { userId: operatorId, organizationId: org.id, role: MemberRole.OPERATOR },
    });
    const operator = { id: operatorId, roles: ['ORG_OPERATOR'], organizationId: org.id };
    const foreign = await flow.organization();

    for (const caller of [org.manager, operator, foreign.manager]) {
      const response = await rolesOf(caller, org.id);
      expect({ status: response.status, body: response.body as unknown }).toMatchObject({
        status: 403,
        body: { isSuccess: false, statusCode: 403, result: { errorCode: 'FORBIDDEN' } },
      });
    }
  });

  it('answers 404 NOT_FOUND to Staff for an unknown organization', async () => {
    const response = await rolesOf(flow.staff, randomUUID());

    expect({ status: response.status, body: response.body as unknown }).toMatchObject({
      status: 404,
      body: { isSuccess: false, statusCode: 404, result: { errorCode: 'NOT_FOUND' } },
    });
  });
});
