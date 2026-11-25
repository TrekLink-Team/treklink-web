import { createMongoAbility } from '@casl/ability';
import { InspectionResult } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { ContractReadsService } from './contract-reads.service';
import { AssignGroupDevicesDto } from './dto/groups.dto';
import { FaultReportsController } from './fault-reports.controller';
import { FaultReportsService } from './fault-reports.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';
import { ReplacementService } from './replacement.service';
import {
  CheckInDto,
  CloseDto,
  InspectionDto,
  ReplacementDto,
  ReturnController,
} from './return.controller';
import { ReturnService } from './return.service';

type Rule = { action: string; subject: string };
type Controller = { prototype: object };

const CALLER: Caller = { id: 'u-1', roles: ['STAFF'], organizationId: null };
const ID = 'c0ffee00-1234-4abc-9def-001122334455';
const DEVICE_ID = '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10';

const handlerOf = (controller: Controller, name: string) =>
  Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as object;

const allows = (controller: Controller, name: string, rules: Rule[]) =>
  (Reflect.getMetadata(CHECK_POLICIES_KEY, handlerOf(controller, name)) as PolicyHandler[]).every(
    (handler) => handler(createMongoAbility(rules) as PolicyAbility),
  );

const messageOf = (controller: Controller, name: string) =>
  Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handlerOf(controller, name)) as string;

const statusOf = (controller: Controller, name: string) =>
  Reflect.getMetadata('__httpCode__', handlerOf(controller, name)) as number | undefined;

const errorsOf = async <T extends object>(type: new () => T, plain: Record<string, unknown>) =>
  validate(plainToInstance(type, plain));

describe('GroupsController', () => {
  const service = {
    tree: jest.fn().mockResolvedValue('tree'),
    create: jest.fn().mockResolvedValue('created'),
    update: jest.fn().mockResolvedValue('updated'),
    remove: jest.fn().mockResolvedValue('removed'),
    assign: jest.fn().mockResolvedValue('assigned'),
    unassign: jest.fn().mockResolvedValue('unassigned'),
  };
  const controller = new GroupsController(service as unknown as GroupsService);

  it('reads the tree for the organization the query names', async () => {
    await expect(controller.list({ organizationId: 'org-1' }, CALLER)).resolves.toBe('tree');
    expect(service.tree).toHaveBeenCalledWith(CALLER, 'org-1');
    await controller.list({}, CALLER);
    expect(service.tree).toHaveBeenLastCalledWith(CALLER, undefined);
  });

  it('creates, updates and removes through the service with the caller', async () => {
    const body = { name: 'North' };
    await expect(controller.create(body, CALLER)).resolves.toBe('created');
    expect(service.create).toHaveBeenCalledWith(body, CALLER);
    const patch = { expectedVersion: 2, name: 'South' };
    await expect(controller.update(ID, patch, CALLER)).resolves.toBe('updated');
    expect(service.update).toHaveBeenCalledWith(ID, patch, CALLER);
    await expect(controller.remove(ID, CALLER)).resolves.toBe('removed');
    expect(service.remove).toHaveBeenCalledWith(ID, CALLER);
  });

  it('assigns the device ids of the body and unassigns one device', async () => {
    await expect(controller.assign(ID, { deviceIds: [DEVICE_ID] }, CALLER)).resolves.toBe(
      'assigned',
    );
    expect(service.assign).toHaveBeenCalledWith(ID, [DEVICE_ID], CALLER);
    await expect(controller.unassign(ID, DEVICE_ID, CALLER)).resolves.toBe('unassigned');
    expect(service.unassign).toHaveBeenCalledWith(ID, DEVICE_ID, CALLER);
  });

  it('lets a reader list the tree but only a manager change it', () => {
    const read = [{ action: 'read', subject: 'Group' }];
    const manage = [{ action: 'manage', subject: 'Group' }];
    expect(allows(GroupsController, 'list', read)).toBe(true);
    for (const name of ['create', 'update', 'remove', 'assign', 'unassign']) {
      expect(allows(GroupsController, name, read)).toBe(false);
      expect(allows(GroupsController, name, manage)).toBe(true);
      expect(allows(GroupsController, name, [])).toBe(false);
    }
    expect(allows(GroupsController, 'list', [])).toBe(false);
  });

  it('answers a static message per action and 200 for the assignment only', () => {
    expect(messageOf(GroupsController, 'list')).toBe('OK');
    expect(messageOf(GroupsController, 'create')).toBe('Group created');
    expect(messageOf(GroupsController, 'update')).toBe('Group updated');
    expect(messageOf(GroupsController, 'remove')).toBe('Group removed');
    expect(messageOf(GroupsController, 'assign')).toBe('Devices assigned');
    expect(messageOf(GroupsController, 'unassign')).toBe('Device removed from the group');
    expect(statusOf(GroupsController, 'assign')).toBe(200);
    expect(statusOf(GroupsController, 'create')).toBeUndefined();
  });

  it('takes 1 to 100 distinct device ids', async () => {
    expect(await errorsOf(AssignGroupDevicesDto, { deviceIds: [DEVICE_ID] })).toHaveLength(0);
    expect(await errorsOf(AssignGroupDevicesDto, { deviceIds: [] })).not.toHaveLength(0);
    expect(await errorsOf(AssignGroupDevicesDto, { deviceIds: ['not-a-uuid'] })).not.toHaveLength(
      0,
    );
    expect(
      await errorsOf(AssignGroupDevicesDto, { deviceIds: [DEVICE_ID, DEVICE_ID] }),
    ).not.toHaveLength(0);
    const many = Array.from(
      { length: 101 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(await errorsOf(AssignGroupDevicesDto, { deviceIds: many })).not.toHaveLength(0);
  });
});

describe('FaultReportsController', () => {
  const service = {
    report: jest.fn().mockResolvedValue('reported'),
    ofContract: jest.fn().mockResolvedValue('faults'),
  };
  const controller = new FaultReportsController(service as unknown as FaultReportsService);

  it('reports the description for one device of the contract', async () => {
    await expect(
      controller.report(ID, DEVICE_ID, { description: 'No GPS fix' }, CALLER),
    ).resolves.toBe('reported');
    expect(service.report).toHaveBeenCalledWith(ID, DEVICE_ID, 'No GPS fix', CALLER);
  });

  it('lists the fault reports of a contract', async () => {
    await expect(controller.ofContract(ID, CALLER)).resolves.toBe('faults');
    expect(service.ofContract).toHaveBeenCalledWith(ID, CALLER);
  });

  it('needs create to report and read to list, and answers a static message', () => {
    const create = [{ action: 'create', subject: 'DeviceFaultReport' }];
    const read = [{ action: 'read', subject: 'DeviceFaultReport' }];
    expect(allows(FaultReportsController, 'report', create)).toBe(true);
    expect(allows(FaultReportsController, 'report', read)).toBe(false);
    expect(allows(FaultReportsController, 'ofContract', read)).toBe(true);
    expect(allows(FaultReportsController, 'ofContract', create)).toBe(false);
    expect(messageOf(FaultReportsController, 'report')).toBe(
      'Fault reported. TrekLink will contact you about a replacement.',
    );
    expect(messageOf(FaultReportsController, 'ofContract')).toBe('OK');
  });

  it('trims the description and takes 1 to 1000 characters', async () => {
    const types = Reflect.getMetadata(
      'design:paramtypes',
      FaultReportsController.prototype,
      'report',
    ) as (new () => { description: string })[];
    const Dto = types[2];
    const padded = plainToInstance(Dto, { description: '  No GPS fix  ' });
    expect(padded.description).toBe('No GPS fix');
    expect(await errorsOf(Dto, { description: 'ok' })).toHaveLength(0);
    expect(await errorsOf(Dto, { description: '   ' })).not.toHaveLength(0);
    expect(await errorsOf(Dto, { description: 'x'.repeat(1001) })).not.toHaveLength(0);
    expect(await errorsOf(Dto, { description: 'x'.repeat(1000) })).toHaveLength(0);
    expect(await errorsOf(Dto, {})).not.toHaveLength(0);
    const notText = plainToInstance(Dto, { description: 42 });
    expect(notText.description).toBe(42);
    expect(await errorsOf(Dto, { description: 42 })).not.toHaveLength(0);
  });
});

describe('ReleaseController', () => {
  const credit = { id: 'sc-1', reason: 'RELEASE', computedVnd: 450_000n };
  const released = {
    release: { id: 'ur-1' },
    contract: { id: ID, version: 4 },
    credit,
    firstInvoiceLoweredByVnd: 225_000n,
  };
  const service = { release: jest.fn(), preview: jest.fn() };
  const controller = new ReleaseController(service as unknown as ReleaseService);

  it('releases a unit with the reason and the version only, and answers VND as numbers', async () => {
    service.release.mockResolvedValue(released);
    const dto = { reason: 'Battery swollen', expectedVersion: 3 };
    const answer = await controller.release(ID, DEVICE_ID, dto, CALLER);
    expect(service.release).toHaveBeenCalledWith(ID, DEVICE_ID, dto, CALLER);
    expect(answer).toEqual({
      release: { id: 'ur-1' },
      contract: { id: ID, version: 4 },
      credit: { id: 'sc-1', reason: 'RELEASE', computedVnd: 450_000 },
      firstInvoiceLoweredByVnd: 225_000,
    });
  });

  it('answers null for a release with no credit and no lowered first invoice', async () => {
    service.release.mockResolvedValue({
      ...released,
      credit: null,
      firstInvoiceLoweredByVnd: null,
    });
    const answer = await controller.release(
      ID,
      DEVICE_ID,
      { reason: 'Battery swollen', expectedVersion: 3 },
      CALLER,
    );
    expect(answer.credit).toBeNull();
    expect(answer.firstInvoiceLoweredByVnd).toBeNull();
  });

  it('previews the release with every VND amount as a number', async () => {
    service.preview.mockResolvedValue({
      canRelease: true,
      credit,
      firstInvoice: {
        totalVnd: 900_000n,
        paidVnd: 450_000n,
        newTotalVnd: 450_000n,
        owedToOrganizationVnd: 100_000n,
      },
    });
    await expect(controller.preview(ID, DEVICE_ID)).resolves.toEqual({
      canRelease: true,
      credit: { id: 'sc-1', reason: 'RELEASE', computedVnd: 450_000 },
      firstInvoice: {
        totalVnd: 900_000,
        paidVnd: 450_000,
        newTotalVnd: 450_000,
        owedToOrganizationVnd: 100_000,
      },
    });
    expect(service.preview).toHaveBeenCalledWith(ID, DEVICE_ID);
  });

  it('previews a release with no credit and no first invoice as null', async () => {
    service.preview.mockResolvedValue({ canRelease: false, credit: null, firstInvoice: null });
    const answer = await controller.preview(ID, DEVICE_ID);
    expect(answer.credit).toBeNull();
    expect(answer.firstInvoice).toBeNull();
  });

  it('needs releaseUnit on RentalContract, which operate does not give', () => {
    const release = [{ action: 'releaseUnit', subject: 'RentalContract' }];
    const operate = [{ action: 'operate', subject: 'RentalContract' }];
    for (const name of ['release', 'preview']) {
      expect(allows(ReleaseController, name, release)).toBe(true);
      expect(allows(ReleaseController, name, operate)).toBe(false);
    }
    expect(messageOf(ReleaseController, 'release')).toBe('Unit released');
    expect(messageOf(ReleaseController, 'preview')).toBe('OK');
    expect(statusOf(ReleaseController, 'release')).toBe(200);
    expect(statusOf(ReleaseController, 'preview')).toBeUndefined();
  });
});

describe('ReturnController', () => {
  const returns = {
    checkIn: jest.fn().mockResolvedValue('checked-in'),
    inspect: jest.fn().mockResolvedValue('inspected'),
    close: jest.fn(),
  };
  const replacements = { replace: jest.fn().mockResolvedValue('replaced') };
  const reads = { labellerAfterCommit: jest.fn() };
  const controller = new ReturnController(
    returns as unknown as ReturnService,
    reads as unknown as ContractReadsService,
    replacements as unknown as ReplacementService,
  );

  it('checks in the asset tags of the body', async () => {
    await expect(controller.checkIn(ID, { assetTags: ['TL-0001'] }, CALLER)).resolves.toBe(
      'checked-in',
    );
    expect(returns.checkIn).toHaveBeenCalledWith(ID, ['TL-0001'], CALLER);
  });

  it('replaces a unit with the body as the service takes it', async () => {
    const dto = {
      replacementDeviceId: DEVICE_ID,
      keyVersion: 2,
      signatureImage: 'data:image/png;base64,AAAA',
      faultyPresent: true,
    };
    await expect(controller.replace(ID, DEVICE_ID, dto, CALLER)).resolves.toBe('replaced');
    expect(replacements.replace).toHaveBeenCalledWith(ID, DEVICE_ID, dto, CALLER);
  });

  it('records an inspection with no damage codes and a null note when none are sent', async () => {
    await controller.inspect(ID, DEVICE_ID, { result: InspectionResult.PASSED }, CALLER);
    expect(returns.inspect).toHaveBeenLastCalledWith(
      ID,
      DEVICE_ID,
      { result: InspectionResult.PASSED, damageCodes: [], note: null },
      CALLER,
    );
  });

  it('trims the inspection note and turns a blank note into null', async () => {
    const result = Object.values(InspectionResult)[0];
    await controller.inspect(
      ID,
      DEVICE_ID,
      { result, damageCodes: ['CASING_CRACKED'], note: '  cracked corner  ' },
      CALLER,
    );
    expect(returns.inspect).toHaveBeenLastCalledWith(
      ID,
      DEVICE_ID,
      { result, damageCodes: ['CASING_CRACKED'], note: 'cracked corner' },
      CALLER,
    );
    await controller.inspect(ID, DEVICE_ID, { result, note: '   ' }, CALLER);
    expect(returns.inspect).toHaveBeenLastCalledWith(
      ID,
      DEVICE_ID,
      { result, damageCodes: [], note: null },
      CALLER,
    );
  });

  it('closes the contract and answers it with its labels and the close time', async () => {
    const closedAt = new Date('2026-11-22T09:00:00Z');
    const closed = {
      id: ID,
      code: 'RC-2026-0002',
      organizationId: 'org-1',
      planType: 'MONTHLY',
      dayPlanDays: null,
      hardwareVariantId: 'v-3',
      quantity: 2,
      requestedStartDate: new Date('2026-10-01T00:00:00Z'),
      monthlyUnitPriceVnd: 450_000n,
      dayPremium: null,
      holdingFeeRatio: { toNumber: () => 0.5 },
      status: 'CLOSED',
      statusChangedAt: closedAt,
      handedOverAt: null,
      endsAt: closedAt,
      noticeGivenAt: null,
      returnDueAt: closedAt,
      version: 9,
    };
    returns.close.mockResolvedValue(closed);
    const organization = { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' };
    reads.labellerAfterCommit.mockResolvedValue(() => ({
      organization,
      variantCode: 'treklink-v3',
    }));
    const answer = await controller.close(ID, { expectedVersion: 8 }, CALLER);
    expect(returns.close).toHaveBeenCalledWith(ID, 8, CALLER);
    expect(reads.labellerAfterCommit).toHaveBeenCalledWith([closed]);
    expect(answer).toMatchObject({
      code: 'RC-2026-0002',
      status: 'CLOSED',
      organization,
      hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
      closedAt,
    });
  });

  it('needs operate on RentalContract for every counter action', () => {
    const operate = [{ action: 'operate', subject: 'RentalContract' }];
    const read = [{ action: 'read', subject: 'RentalContract' }];
    for (const name of ['checkIn', 'replace', 'inspect', 'closeCheck', 'close']) {
      expect(allows(ReturnController, name, operate)).toBe(true);
      expect(allows(ReturnController, name, read)).toBe(false);
    }
  });

  it('answers a static message per action and 200 for the check-in and the close', () => {
    expect(messageOf(ReturnController, 'checkIn')).toBe('Check-in complete.');
    expect(messageOf(ReturnController, 'replace')).toBe('Device replaced');
    expect(messageOf(ReturnController, 'inspect')).toBe('Inspection recorded');
    expect(messageOf(ReturnController, 'close')).toBe('Contract closed');
    expect(statusOf(ReturnController, 'checkIn')).toBe(200);
    expect(statusOf(ReturnController, 'close')).toBe(200);
    expect(statusOf(ReturnController, 'replace')).toBeUndefined();
    expect(statusOf(ReturnController, 'inspect')).toBeUndefined();
  });

  it('validates the check-in, replacement, inspection and close bodies', async () => {
    expect(await errorsOf(CheckInDto, { assetTags: ['TL-1'] })).toHaveLength(0);
    expect(await errorsOf(CheckInDto, { assetTags: [] })).not.toHaveLength(0);
    expect(await errorsOf(CheckInDto, { assetTags: [''] })).not.toHaveLength(0);
    const replacement = {
      replacementDeviceId: DEVICE_ID,
      keyVersion: 1,
      signatureImage: 'x',
      faultyPresent: false,
    };
    expect(await errorsOf(ReplacementDto, replacement)).toHaveLength(0);
    expect(await errorsOf(ReplacementDto, { ...replacement, keyVersion: 0 })).not.toHaveLength(0);
    expect(
      await errorsOf(ReplacementDto, { ...replacement, replacementDeviceId: 'nope' }),
    ).not.toHaveLength(0);
    expect(await errorsOf(ReplacementDto, { ...replacement, signatureImage: '' })).not.toHaveLength(
      0,
    );
    expect(
      await errorsOf(ReplacementDto, { ...replacement, faultyPresent: 'yes' }),
    ).not.toHaveLength(0);
    const result = Object.values(InspectionResult)[0];
    expect(await errorsOf(InspectionDto, { result })).toHaveLength(0);
    expect(await errorsOf(InspectionDto, { result: 'BROKEN' })).not.toHaveLength(0);
    expect(await errorsOf(InspectionDto, { result, note: 'x'.repeat(501) })).not.toHaveLength(0);
    expect(await errorsOf(InspectionDto, { result, damageCodes: [''] })).not.toHaveLength(0);
    expect(await errorsOf(CloseDto, { expectedVersion: 0 })).toHaveLength(0);
    expect(await errorsOf(CloseDto, { expectedVersion: -1 })).not.toHaveLength(0);
  });
});
