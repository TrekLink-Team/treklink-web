import { HttpStatus } from '@nestjs/common';
import { DeviceStatus, HubActionKind, HubActionOutcome } from '@prisma/client';
import { Caller } from '../../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { AUDIT_RECORD } from '../../platform/audit/audit-record.event';
import { HubActionService } from './hub-action.service';

// devices api-design 33 and 34 (design section 12.14, leader UAT 2026-11-06): no status refuses a hub action,
// RESERVED and RENTED need the typed asset tag, and a SUCCEEDED action changes the device record.

const AT = new Date('2026-11-06T16:45:00.000Z');
const CALLER = { id: 'staff-1', roles: ['STAFF'], organizationId: null } as unknown as Caller;
const NODE = 0x0aa3a274;

const unitAt = (status: DeviceStatus, extra: Record<string, unknown> = {}) => ({
  id: 'd-1',
  assetTag: 'treklink a274',
  nodeNum: BigInt(NODE),
  status,
  statusChangedAt: new Date('2026-11-05T00:00:00.000Z'),
  firmwareVersion: '2.7.19-treklink.3',
  keyVersion: 3,
  keyOrganizationId: 'org-1',
  ...extra,
});

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'ha-1',
  deviceId: 'd-1',
  action: HubActionKind.FACTORY_RESET,
  outcome: HubActionOutcome.STARTED,
  nodeNum: BigInt(NODE),
  deviceStatus: DeviceStatus.AVAILABLE,
  contractId: null,
  contractCode: null,
  firmwareFrom: null,
  firmwareTo: null,
  fullImage: false,
  failure: null,
  actorId: 'staff-1',
  startedAt: AT,
  finishedAt: null,
  ...extra,
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    return [(error as DomainException).getStatus(), (error as DomainException).errorCode];
  }
  throw new Error('expected a DomainException');
};

describe('HubActionService', () => {
  let actions: {
    lockDevice: jest.Mock;
    insert: jest.Mock;
    find: jest.Mock;
    finish: jest.Mock;
    clearKey: jest.Mock;
    setFirmware: jest.Mock;
    ofDevice: jest.Mock;
  };
  let devices: { insertReset: jest.Mock; lastResetAt: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let contracts: { liveContractsOf: jest.Mock };
  let custody: { custodyAt: jest.Mock };
  let service: HubActionService;

  beforeEach(() => {
    actions = {
      lockDevice: jest.fn().mockResolvedValue(unitAt(DeviceStatus.AVAILABLE)),
      insert: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve(row({ ...data, id: 'ha-1' })),
      ),
      find: jest.fn().mockResolvedValue(row()),
      finish: jest.fn((id: string, outcome: HubActionOutcome, failure: string | null) =>
        Promise.resolve(row({ outcome, failure, finishedAt: AT })),
      ),
      clearKey: jest.fn().mockResolvedValue({}),
      setFirmware: jest.fn().mockResolvedValue({}),
      ofDevice: jest.fn().mockResolvedValue([]),
    };
    devices = {
      insertReset: jest.fn().mockResolvedValue({}),
      lastResetAt: jest.fn().mockResolvedValue(null),
    };
    events = {
      transaction: jest.fn((work: (tx: object) => unknown) => work({})),
      emitAfterCommit: jest.fn(),
    };
    contracts = { liveContractsOf: jest.fn().mockResolvedValue([]) };
    custody = { custodyAt: jest.fn().mockResolvedValue(null) };
    service = new HubActionService(
      actions as never,
      devices as never,
      events as never,
      contracts,
      custody,
    );
  });

  describe('start (api-design 33)', () => {
    it.each(
      Object.values(DeviceStatus).filter((status) => status !== 'RESERVED' && status !== 'RENTED'),
    )('starts a factory reset of a %s unit without a confirmation', async (status) => {
      actions.lockDevice.mockResolvedValue(unitAt(status));

      const view = await service.start(
        'd-1',
        { action: HubActionKind.FACTORY_RESET, nodeNum: NODE },
        CALLER,
        AT,
      );

      expect(view).toMatchObject({
        id: 'ha-1',
        outcome: 'STARTED',
        deviceStatus: status,
        nodeNum: NODE,
      });
    });

    it.each([DeviceStatus.RESERVED, DeviceStatus.RENTED])(
      'needs the asset tag typed for a %s unit and names the contract',
      async (status) => {
        actions.lockDevice.mockResolvedValue(unitAt(status));
        contracts.liveContractsOf.mockResolvedValue([
          {
            deviceId: 'd-1',
            contractId: 'c-1',
            code: 'RC-2026-0040',
            status: 'ACTIVE',
            organizationId: 'org-1',
            organizationCode: 'ORG-0007',
          },
        ]);
        const request = { action: HubActionKind.REBOOT, nodeNum: NODE };

        await expect(codeOf(service.start('d-1', request, CALLER, AT))).resolves.toEqual([
          HttpStatus.BAD_REQUEST,
          ErrorCode.CONFIRMATION_REQUIRED,
        ]);
        await expect(
          codeOf(
            service.start('d-1', { ...request, confirmAssetTag: 'treklink a264' }, CALLER, AT),
          ),
        ).resolves.toEqual([HttpStatus.BAD_REQUEST, ErrorCode.CONFIRMATION_REQUIRED]);
        expect(actions.insert).not.toHaveBeenCalled();

        const view = await service.start(
          'd-1',
          { ...request, confirmAssetTag: '  TREKLINK A274 ' },
          CALLER,
          AT,
        );

        expect(view).toMatchObject({ contractCode: 'RC-2026-0040', deviceStatus: status });
        expect(actions.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            contractId: 'c-1',
            contractCode: 'RC-2026-0040',
            actorId: 'staff-1',
          }),
          {},
        );
      },
    );

    it('refuses a docked unit that is another device with 409 NODE_MISMATCH', async () => {
      await expect(
        codeOf(
          service.start('d-1', { action: HubActionKind.REBOOT, nodeNum: 0x0aa3a264 }, CALLER, AT),
        ),
      ).resolves.toEqual([HttpStatus.CONFLICT, ErrorCode.NODE_MISMATCH]);
      expect(actions.insert).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown device', async () => {
      actions.lockDevice.mockResolvedValue(null);

      await expect(
        codeOf(service.start('d-x', { action: HubActionKind.REBOOT, nodeNum: NODE }, CALLER, AT)),
      ).resolves.toEqual([HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND]);
    });

    it('keeps the firmware on record and the release for a firmware update, and needs the release', async () => {
      await expect(
        codeOf(
          service.start(
            'd-1',
            { action: HubActionKind.FIRMWARE_UPDATE, nodeNum: NODE },
            CALLER,
            AT,
          ),
        ),
      ).resolves.toEqual([HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED]);

      await service.start(
        'd-1',
        {
          action: HubActionKind.FIRMWARE_UPDATE,
          nodeNum: NODE,
          firmwareTo: '2.7.26-treklink.1',
          fullImage: true,
        },
        CALLER,
        AT,
      );

      expect(actions.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          firmwareFrom: '2.7.19-treklink.3',
          firmwareTo: '2.7.26-treklink.1',
          fullImage: true,
        }),
        {},
      );
    });

    it('writes the audit entry device.hub_action.started after commit', async () => {
      await service.start(
        'd-1',
        { action: HubActionKind.RESTORE_DEFAULTS, nodeNum: NODE },
        CALLER,
        AT,
      );

      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'device.hub_action.started',
          subjectId: 'd-1',
          actorId: 'staff-1',
          after: expect.objectContaining({
            hubActionId: 'ha-1',
            action: 'RESTORE_DEFAULTS',
            nodeNum: NODE,
          }) as unknown,
        }),
      );
    });
  });

  describe('finish (api-design 34)', () => {
    it('clears the key after a restore of the TrekLink defaults', async () => {
      actions.find.mockResolvedValue(row({ action: HubActionKind.RESTORE_DEFAULTS }));

      const view = await service.finish('d-1', 'ha-1', { outcome: 'SUCCEEDED' }, CALLER, AT);

      expect(view).toMatchObject({ outcome: 'SUCCEEDED', returnReset: false });
      expect(actions.clearKey).toHaveBeenCalledWith('d-1', {});
      expect(devices.insertReset).not.toHaveBeenCalled();
    });

    it('records the return reset when a returned unit out of custody is factory reset', async () => {
      actions.lockDevice.mockResolvedValue(unitAt(DeviceStatus.RETURNED));

      const view = await service.finish('d-1', 'ha-1', { outcome: 'SUCCEEDED' }, CALLER, AT);

      expect(view.returnReset).toBe(true);
      expect(devices.insertReset).toHaveBeenCalledWith(
        'd-1',
        { keyRemoved: true, nodeDbCleared: true, ownerCleared: true },
        'staff-1',
        AT,
        {},
      );
      expect(actions.clearKey).not.toHaveBeenCalled();
    });

    it('only clears the key of a returned unit still in custody or already reset for this return', async () => {
      actions.lockDevice.mockResolvedValue(unitAt(DeviceStatus.RETURNED));
      custody.custodyAt.mockResolvedValueOnce({
        contractId: 'c-1',
        organizationId: 'org-1',
        contractDeviceId: 'cd-1',
      });

      await service.finish('d-1', 'ha-1', { outcome: 'SUCCEEDED' }, CALLER, AT);
      devices.lastResetAt.mockResolvedValueOnce(new Date('2026-11-06T00:00:00.000Z'));
      await service.finish('d-1', 'ha-1', { outcome: 'SUCCEEDED' }, CALLER, AT);

      expect(devices.insertReset).not.toHaveBeenCalled();
      expect(actions.clearKey).toHaveBeenCalledTimes(2);
    });

    it('sets the firmware on record after a verified flash', async () => {
      actions.find.mockResolvedValue(
        row({ action: HubActionKind.FIRMWARE_UPDATE, firmwareTo: '2.7.26-treklink.1' }),
      );

      await service.finish('d-1', 'ha-1', { outcome: 'SUCCEEDED' }, CALLER, AT);

      expect(actions.setFirmware).toHaveBeenCalledWith('d-1', '2.7.26-treklink.1', {});
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'device.hub_action.finished',
          before: expect.objectContaining({ firmwareVersion: '2.7.19-treklink.3' }) as unknown,
          after: expect.objectContaining({
            outcome: 'SUCCEEDED',
            firmwareVersion: '2.7.26-treklink.1',
          }) as unknown,
        }),
      );
    });

    it('changes nothing on the device after a failure and keeps the failed step', async () => {
      actions.find.mockResolvedValue(
        row({ action: HubActionKind.FIRMWARE_UPDATE, firmwareTo: '2.7.26-treklink.1' }),
      );

      const view = await service.finish(
        'd-1',
        'ha-1',
        { outcome: 'FAILED', failure: 'Writing and verifying the image failed.' },
        CALLER,
        AT,
      );

      expect(view).toMatchObject({
        outcome: 'FAILED',
        failure: 'Writing and verifying the image failed.',
      });
      expect(actions.setFirmware).not.toHaveBeenCalled();
      expect(actions.clearKey).not.toHaveBeenCalled();
    });

    it('refuses a finished action with 409 HUB_ACTION_FINISHED and an unknown one with 404', async () => {
      actions.find.mockResolvedValueOnce(row({ outcome: HubActionOutcome.SUCCEEDED }));
      await expect(
        codeOf(service.finish('d-1', 'ha-1', { outcome: 'SUCCEEDED' }, CALLER, AT)),
      ).resolves.toEqual([HttpStatus.CONFLICT, ErrorCode.HUB_ACTION_FINISHED]);
      actions.find.mockResolvedValueOnce(null);
      await expect(
        codeOf(service.finish('d-1', 'ha-x', { outcome: 'FAILED' }, CALLER, AT)),
      ).resolves.toEqual([HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND]);
    });
  });
});
