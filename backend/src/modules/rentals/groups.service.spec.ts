import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';

describe('GroupsService', () => {
  const caller = { id: 'manager', organizationId: 'org', roles: ['ORG_MANAGER'] };
  const tx = {} as Prisma.TransactionClient;
  const topology = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'sibling', parentId: null },
  ];

  function setup() {
    const groups = {
      lockTree: jest.fn(),
      lockGroups: jest.fn(),
      topology: jest.fn().mockResolvedValue(topology),
      create: jest.fn(),
      remove: jest.fn().mockResolvedValue(['radio']),
    };
    const emitter = new EventEmitter2();
    const emit = jest.spyOn(emitter, 'emit');
    const transaction = jest.fn(
      async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => {
        const result = await work(tx);
        expect(emit).not.toHaveBeenCalled();
        return result;
      },
    );
    const events = new TransactionalEvents(
      { $transaction: transaction } as unknown as PrismaService,
      emitter,
    );
    const service = new GroupsService(
      groups as unknown as GroupsRepository,
      { getUncached: jest.fn().mockResolvedValue(1) } as unknown as ParameterService,
      { assertCanUseRentalGroups: jest.fn() } as unknown as OrganizationsService,
      events,
      {} as never,
    );
    return { service, groups, emit };
  }

  it('refuses to create past the cap without an insert or audit event', async () => {
    const { service, groups, emit } = setup();
    await expect(
      service.create({ name: 'Too deep', parentId: 'child' }, caller),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.GROUP_DEPTH_EXCEEDED,
    });
    expect(groups.create).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('removes only the requested subtree and emits audit and device events after commit', async () => {
    const { service, groups, emit } = setup();
    await expect(service.remove('root', caller)).resolves.toEqual({
      id: 'root',
      removedGroups: 2,
      ungroupedDevices: 1,
    });
    expect(groups.lockGroups).toHaveBeenCalledWith('org', ['root', 'child'], tx);
    expect(groups.remove).toHaveBeenCalledWith('org', ['root', 'child'], expect.any(Date), tx);
    expect(emit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({
        action: 'group.removed',
        subjectId: 'root',
        after: { removedGroupIds: ['root', 'child'], ungroupedDeviceIds: ['radio'] },
      }),
    );
    expect(emit).toHaveBeenCalledWith('device.groupChanged', {
      organizationId: 'org',
      deviceId: 'radio',
      group: null,
    });
  });

  it('emits nothing if subtree removal fails', async () => {
    const { service, groups, emit } = setup();
    groups.remove.mockRejectedValue(new Error('write failed'));
    await expect(service.remove('root', caller)).rejects.toThrow('write failed');
    expect(emit).not.toHaveBeenCalled();
  });
});
