import { subject } from '@casl/ability';
import { FaultResolution, GroupExit } from '@prisma/client';
import { AbilityFactory } from '../src/modules/auth/casl/ability.factory';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import { at, compileRentalFlow, RentalFlow } from './db-rental-flow';

// Phase 9 foundation, on a disposable migrated Postgres database.
describe('rental group constraints and defaults', () => {
  let flow: RentalFlow;
  let organization: Awaited<ReturnType<RentalFlow['organization']>>;
  let otherOrganization: typeof organization;

  beforeAll(async () => {
    flow = await compileRentalFlow();
    organization = await flow.organization();
    otherOrganization = await flow.organization();
  });

  afterAll(async () => {
    await flow?.close();
  });

  const group = (name: string, parentId?: string, org = organization) =>
    flow.prisma.group.create({
      data: { organizationId: org.id, createdById: org.manager.id, name, parentId },
    });

  it('reserves names case-insensitively for live siblings only', async () => {
    const root = await group('Rangers');
    await expect(group('rangers')).rejects.toMatchObject({ code: 'P2002' });
    await group('rangers', undefined, otherOrganization);
    await group('Rangers', root.id);
    await expect(group('rangers', root.id)).rejects.toMatchObject({ code: 'P2002' });

    await flow.prisma.group.update({ where: { id: root.id }, data: { removedAt: new Date() } });
    await expect(group('rangers')).resolves.toMatchObject({ name: 'rangers' });
  });

  it('rejects a parent from another organization', async () => {
    const foreign = await group('Foreign parent', undefined, otherOrganization);
    await expect(group('Wrong tenant', foreign.id)).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects an end date earlier than the start date', async () => {
    await expect(
      flow.prisma.group.create({
        data: {
          organizationId: organization.id,
          createdById: organization.manager.id,
          name: 'Invalid dates',
          startsOn: at('2026-11-06'),
          endsOn: at('2026-11-05'),
        },
      }),
    ).rejects.toThrow('groups_dates_in_order');
  });

  it('allows only one open assignment per device and one open fault per custody row', async () => {
    const variantId = await flow.variant();
    const [deviceId] = await flow.availableDevices(variantId, 1);
    const contract = await flow.requested(organization.id, organization.manager.id, variantId, 1);
    const custody = await flow.prisma.contractDevice.create({
      data: { contractId: contract.id, deviceId },
    });
    const firstGroup = await group('First patrol');
    const secondGroup = await group('Second patrol');
    const assign = (groupId: string) =>
      flow.prisma.groupAssignment.create({
        data: {
          groupId,
          deviceId,
          contractDeviceId: custody.id,
          assignedById: organization.manager.id,
        },
      });
    const report = () =>
      flow.prisma.deviceFaultReport.create({
        data: {
          organizationId: organization.id,
          contractId: contract.id,
          contractDeviceId: custody.id,
          deviceId,
          description: 'Screen flickers',
          reportedById: organization.manager.id,
        },
      });

    const assignment = await assign(firstGroup.id);
    await expect(assign(secondGroup.id)).rejects.toMatchObject({ code: 'P2002' });
    await flow.prisma.groupAssignment.update({
      where: { id: assignment.id },
      data: { endedAt: new Date(), endedReason: GroupExit.MOVED },
    });
    await expect(assign(secondGroup.id)).resolves.toMatchObject({ endedAt: null });

    const fault = await report();
    await expect(report()).rejects.toMatchObject({ code: 'P2002' });
    await flow.prisma.deviceFaultReport.update({
      where: { id: fault.id },
      data: { resolvedAt: new Date(), resolution: FaultResolution.CHECKED_IN },
    });
    await expect(report()).resolves.toMatchObject({ resolvedAt: null });
  });

  it('seeds the depth parameter and limits the default group and fault permissions', async () => {
    await expect(flow.get(ParameterService).get('rentals.groupMaxDepth')).resolves.toBe(1);
    await expect(
      flow.prisma.businessParameter.findUniqueOrThrow({ where: { key: 'rentals.groupMaxDepth' } }),
    ).resolves.toMatchObject({ bounds: { min: 1, max: 3 } });

    const factory = flow.get(AbilityFactory);
    const manager = await factory.forContext({
      userId: organization.manager.id,
      organizationId: organization.id,
      roles: ['ORG_MANAGER'],
    });
    const operator = await factory.forContext({
      userId: null,
      organizationId: organization.id,
      roles: ['ORG_OPERATOR'],
    });
    const staff = await factory.forContext({
      userId: flow.staff.id,
      organizationId: null,
      roles: ['STAFF'],
    });
    const forOrg = (type: string, organizationId: string) => {
      const attributes: Record<string, unknown> = { organizationId };
      return subject(type, attributes);
    };
    const ownGroup = forOrg('Group', organization.id);
    const foreignGroup = forOrg('Group', otherOrganization.id);
    const ownFault = forOrg('DeviceFaultReport', organization.id);
    const foreignFault = forOrg('DeviceFaultReport', otherOrganization.id);

    expect(manager.can('manage', ownGroup)).toBe(true);
    expect(manager.can('manage', foreignGroup)).toBe(false);
    expect(manager.can('create', ownFault)).toBe(true);
    expect(manager.can('read', ownFault)).toBe(true);
    expect(manager.can('read', foreignFault)).toBe(false);
    expect(operator.can('read', ownGroup)).toBe(true);
    expect(operator.can('read', foreignGroup)).toBe(false);
    expect(operator.can('manage', ownGroup)).toBe(false);
    expect(operator.can('read', ownFault)).toBe(false);
    expect(staff.can('read', foreignGroup)).toBe(true);
    expect(staff.can('read', foreignFault)).toBe(true);
    expect(staff.can('manage', foreignGroup)).toBe(false);
  });
});
