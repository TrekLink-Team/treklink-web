import { createMongoAbility } from '@casl/ability';
import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DisposeDeviceDto } from './dto/dispose-device.dto';
import { RetireDeviceDto } from './dto/retire-device.dto';
import { IntakeService } from './intake.service';

const CONFIG = {
  get: jest.fn((key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100)),
} as never;

const CALLER = { id: 'staff-1', roles: ['STAFF'], organizationId: null };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };

const metadataOf = (key: string, method: string): unknown =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(DevicesController.prototype, method)?.value as object,
  );

const allows = (method: string, ability: PolicyAbility): boolean =>
  (metadataOf(CHECK_POLICIES_KEY, method) as PolicyHandler[]).every((handler) => handler(ability));

describe('DevicesController (devices api-design 05 to 09, task 4.1)', () => {
  let devices: {
    fleetPage: jest.Mock;
    reset: jest.Mock;
    retire: jest.Mock;
    dispose: jest.Mock;
    availability: jest.Mock;
    detail: jest.Mock;
  };
  let intake: { record: jest.Mock; register: jest.Mock };
  let events: { transaction: jest.Mock };
  let controller: DevicesController;

  beforeEach(() => {
    devices = {
      fleetPage: jest.fn().mockResolvedValue([[], 0]),
      reset: jest.fn(),
      retire: jest.fn().mockResolvedValue({ id: 'd-1', status: 'RETIRED' }),
      dispose: jest.fn().mockResolvedValue({ id: 'd-1', status: 'DISPOSED' }),
      availability: jest.fn().mockResolvedValue([]),
      detail: jest.fn().mockResolvedValue({ id: 'd-1' }),
    };
    intake = { record: jest.fn(), register: jest.fn().mockResolvedValue({ id: 'd-new' }) };
    events = { transaction: jest.fn((cb: (tx: object) => unknown) => cb({})) };
    controller = new DevicesController(
      devices as unknown as DevicesService,
      intake as unknown as IntakeService,
      events as never,
      CONFIG,
    );
  });

  it('registers a device inside a transaction (api-design 05)', async () => {
    const dto = {
      assetTag: 'TL-0042',
      nodeNum: 1,
      hardwareVariantId: 'v-3',
      firmwareVersion: '1.0',
      acquiredAt: '2026-01-01',
    };
    await expect(controller.register(dto, CALLER)).resolves.toEqual({ id: 'd-new' });
    expect(intake.register).toHaveBeenCalledWith(dto, 'staff-1', expect.any(Date), {});
  });

  it('lists the fleet page with the query filters', async () => {
    await controller.list({ status: ['AVAILABLE'], hardwareVariantId: 'v-3', q: ' TL ' });
    expect(devices.fleetPage).toHaveBeenCalledWith(
      { statuses: ['AVAILABLE'], hardwareVariantId: 'v-3', q: 'TL' },
      0,
      20,
    );
  });

  it('reads availability and the device detail', async () => {
    await controller.availability({ hardwareVariantId: 'v-3' });
    expect(devices.availability).toHaveBeenCalledWith('v-3');
    await expect(controller.detail('d-1')).resolves.toEqual({ id: 'd-1' });
  });

  it('records a reset and an intake check inside a transaction', async () => {
    const resetDto = { keyRemoved: true, nodeDbCleared: true, ownerCleared: true };
    await controller.reset('d-1', resetDto, CALLER);
    expect(devices.reset).toHaveBeenCalledWith('d-1', resetDto, 'staff-1', expect.any(Date), {});

    const intakeDto = { gpsFixOk: true, radioOk: true, batteryOk: true, expectedVersion: 0 };
    await controller.recordIntake('d-1', intakeDto, CALLER);
    expect(intake.record).toHaveBeenCalledWith('d-1', intakeDto, 'staff-1', expect.any(Date), {});
  });

  it('retires and disposes inside a transaction (api-design 16 and 23)', async () => {
    const retireDto = { reason: 'Unrepairable water damage', expectedVersion: 4 };
    await expect(controller.retire('d-1', retireDto, ADMIN)).resolves.toEqual({
      id: 'd-1',
      status: 'RETIRED',
    });
    expect(devices.retire).toHaveBeenCalledWith('d-1', retireDto, 'admin-1', expect.any(Date), {});

    const disposeDto = {
      keyRemoved: true,
      nodeDbCleared: true,
      ownerCleared: true,
      method: 'Recycled through a licensed handler',
      expectedVersion: 5,
    };
    await expect(controller.dispose('d-1', disposeDto, ADMIN)).resolves.toEqual({
      id: 'd-1',
      status: 'DISPOSED',
    });
    expect(devices.dispose).toHaveBeenCalledWith(
      'd-1',
      disposeDto,
      'admin-1',
      expect.any(Date),
      {},
    );
    expect(events.transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['retire', 'retire', HttpStatus.OK, 'Device retired'],
    ['dispose', 'dispose', HttpStatus.CREATED, 'Device disposed'],
  ])('checks %s against %s on Device, answering %d "%s"', (method, action, status, message) => {
    const can = jest.fn().mockReturnValue(true);
    expect(allows(method, { can })).toBe(true);
    expect(can).toHaveBeenCalledWith(action, 'Device');
    expect(metadataOf(HTTP_CODE_METADATA, method)).toBe(status);
    expect(metadataOf(RESPONSE_MESSAGE_KEY, method)).toBe(message);
  });

  it('allows retire and dispose only with device.retire and device.dispose', () => {
    // The Admin rows of the permission matrix, and a Staff caller holding device.operate only.
    const admin = createMongoAbility([
      { action: 'retire', subject: 'Device' },
      { action: 'dispose', subject: 'Device' },
    ]);
    const staff = createMongoAbility([{ action: 'operate', subject: 'Device' }]);
    const retireOnly = createMongoAbility([{ action: 'retire', subject: 'Device' }]);

    expect(allows('retire', admin)).toBe(true);
    expect(allows('dispose', admin)).toBe(true);
    expect(allows('retire', staff)).toBe(false);
    expect(allows('dispose', staff)).toBe(false);
    expect(allows('dispose', retireOnly)).toBe(false);
  });

  it('validates the retire and dispose bodies', async () => {
    const errorsOf = async (cls: new () => object, body: object) =>
      (await validate(plainToInstance(cls, body))).map((error) => error.property);
    expect(await errorsOf(RetireDeviceDto, { reason: 'x', expectedVersion: 0 })).toEqual([]);
    expect(await errorsOf(RetireDeviceDto, { reason: '', expectedVersion: -1 })).toEqual([
      'reason',
      'expectedVersion',
    ]);
    const wipe = { keyRemoved: true, nodeDbCleared: true, ownerCleared: true };
    expect(
      await errorsOf(DisposeDeviceDto, { ...wipe, method: 'Recycled', expectedVersion: 3 }),
    ).toEqual([]);
    expect(await errorsOf(DisposeDeviceDto, { ...wipe, keyRemoved: 'yes' })).toEqual([
      'keyRemoved',
      'method',
      'expectedVersion',
    ]);
  });
});
