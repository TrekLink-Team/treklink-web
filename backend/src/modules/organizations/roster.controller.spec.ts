import { createMongoAbility } from '@casl/ability';
import { Reflector } from '@nestjs/core';
import {
  CHECK_POLICIES_KEY,
  Caller,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { AppAbility } from '../auth/casl/ability.factory';
import { RosterController } from './roster.controller';
import { ShiftsService } from './shifts.service';

const CALLER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const RESULT = { shift: { id: 's-1' }, warnings: [] };

const policyOf = (method: keyof RosterController): PolicyHandler => {
  const descriptor = Object.getOwnPropertyDescriptors(RosterController.prototype)[method];
  const [policy] = new Reflector().get<PolicyHandler[]>(
    CHECK_POLICIES_KEY,
    descriptor.value as (...args: never[]) => unknown,
  );
  return policy;
};

describe('RosterController (api-design 16 to 19)', () => {
  let service: { list: jest.Mock; create: jest.Mock; update: jest.Mock; remove: jest.Mock };
  let controller: RosterController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ shifts: [], warnings: [] }),
      create: jest.fn().mockResolvedValue(RESULT),
      update: jest.fn().mockResolvedValue(RESULT),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    controller = new RosterController(service as unknown as ShiftsService);
  });

  it('lets a reader read the roster, and only a manager change it', () => {
    const reader = createMongoAbility([{ action: 'read', subject: 'RosterShift' }]);
    const manager = createMongoAbility([{ action: 'manage', subject: 'RosterShift' }]);
    const nobody = createMongoAbility([]);

    expect(policyOf('list')(reader as unknown as AppAbility)).toBe(true);
    expect(policyOf('list')(nobody as unknown as AppAbility)).toBe(false);
    for (const method of ['create', 'update', 'remove'] as const) {
      expect(policyOf(method)(manager as unknown as AppAbility)).toBe(true);
      expect(policyOf(method)(reader as unknown as AppAbility)).toBe(false);
    }
  });

  it('lists with the window as dates', async () => {
    await controller.list(
      'org-1',
      { from: '2026-10-20T00:00:00Z', to: '2026-10-27T00:00:00Z' },
      CALLER,
    );
    expect(service.list).toHaveBeenCalledWith(
      'org-1',
      new Date('2026-10-20T00:00:00Z'),
      new Date('2026-10-27T00:00:00Z'),
      CALLER,
    );
  });

  it('creates with dates and the members given', async () => {
    await expect(
      controller.create(
        'org-1',
        {
          startsAt: '2026-10-20T00:00:00Z',
          endsAt: '2026-10-20T12:00:00+07:00',
          primaryMemberId: 'm-1',
        },
        CALLER,
      ),
    ).resolves.toBe(RESULT);
    expect(service.create).toHaveBeenCalledWith(
      'org-1',
      {
        startsAt: new Date('2026-10-20T00:00:00Z'),
        endsAt: new Date('2026-10-20T05:00:00Z'),
        primaryMemberId: 'm-1',
        backupMemberId: undefined,
      },
      CALLER,
    );
  });

  it('updates only the fields sent, keeping null for an emptied slot', async () => {
    await controller.update('org-1', 's-1', { backupMemberId: null }, CALLER);
    expect(service.update).toHaveBeenLastCalledWith(
      'org-1',
      's-1',
      { startsAt: undefined, endsAt: undefined, primaryMemberId: undefined, backupMemberId: null },
      CALLER,
    );

    await controller.update(
      'org-1',
      's-1',
      { startsAt: '2026-10-20T01:00:00Z', endsAt: '2026-10-20T02:00:00Z' },
      CALLER,
    );
    expect(service.update).toHaveBeenLastCalledWith(
      'org-1',
      's-1',
      {
        startsAt: new Date('2026-10-20T01:00:00Z'),
        endsAt: new Date('2026-10-20T02:00:00Z'),
        primaryMemberId: undefined,
        backupMemberId: undefined,
      },
      CALLER,
    );
  });

  it('deletes and answers a null result', async () => {
    await expect(controller.remove('org-1', 's-1', CALLER)).resolves.toBeNull();
    expect(service.remove).toHaveBeenCalledWith('org-1', 's-1', CALLER);
  });
});
