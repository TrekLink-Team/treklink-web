import { createMongoAbility } from '@casl/ability';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DevicesService } from '../devices';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractReadsService } from './contract-reads.service';
import { ContractsController } from './contracts.controller';
import { ContractRow } from './contracts.repository';
import { ContractsService } from './contracts.service';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';

type Rule = { action: string; subject: string };
type Controller = { prototype: object };

const AT = new Date('2026-11-10T03:00:00.000Z');
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const ORG = { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' };
const ID = 'c0ffee00-1234-4abc-9def-001122334455';
const DEVICE_ID = '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10';

const CONTRACT: ContractRow = {
  id: 'c-1',
  code: 'RC-2026-0002',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v-3',
  quantity: 2,
  requestedStartDate: new Date('2026-11-12T00:00:00.000Z'),
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: null,
  holdingFeeRatio: new Prisma.Decimal('0.5'),
  status: ContractStatus.APPROVED,
  statusChangedAt: AT,
  handedOverAt: null,
  endsAt: null,
  noticeGivenAt: null,
  returnDueAt: null,
  version: 3,
};

const handlerOf = (controller: Controller, name: string) =>
  Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as object;

const allows = (controller: Controller, name: string, rules: Rule[]) =>
  (Reflect.getMetadata(CHECK_POLICIES_KEY, handlerOf(controller, name)) as PolicyHandler[]).every(
    (handler) => handler(createMongoAbility(rules) as PolicyAbility),
  );

const messageOf = (controller: Controller, name: string) =>
  Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handlerOf(controller, name)) as string;

const callArg = (mock: jest.Mock, call: number, arg: number): unknown =>
  (mock.mock.calls[call] as unknown[])[arg];

const labeller = () =>
  jest.fn().mockResolvedValue(() => ({ organization: ORG, variantCode: 'treklink-v3' }));

const term = (seq: number) => ({
  seq,
  startsAt: new Date(`2026-1${seq}-01T02:00:00.000Z`),
  endsAt: new Date(`2026-1${seq}-28T02:00:00.000Z`),
});

describe('ContractsController handlers', () => {
  const build = (parts: { reads?: object; decisions?: object; devices?: object }) =>
    new ContractsController(
      {} as ContractsService,
      (parts.devices ?? {}) as DevicesService,
      (parts.reads ?? {}) as ContractReadsService,
      (parts.decisions ?? {}) as ContractDecisionsService,
    );

  it('lists contracts with their labels, the latest term and the three dates', async () => {
    const dates = {
      reservationExpiresAt: new Date('2026-11-11T03:00:00.000Z'),
      handoverAppointmentAt: new Date('2026-11-12T03:00:00.000Z'),
      holdExpiresAt: null,
    };
    const reads = {
      page: jest.fn().mockResolvedValue({
        total: 2,
        page: 1,
        items: [
          {
            row: { ...CONTRACT, ...dates, terms: [term(1), term(2)] },
            organization: ORG,
            variantCode: 'treklink-v3',
          },
          {
            row: { ...CONTRACT, id: 'c-2', ...dates, terms: [] },
            organization: null,
            variantCode: null,
          },
        ],
      }),
    };
    const result = await build({ reads }).list({}, STAFF);
    expect(reads.page).toHaveBeenCalledWith({}, STAFF);
    expect(result).toMatchObject({ total: 2, page: 1 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      id: 'c-1',
      organization: ORG,
      hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
      currentTerm: term(2),
      ...dates,
    });
    expect(result.items[1]).toMatchObject({
      id: 'c-2',
      organization: null,
      hardwareVariant: { id: 'v-3', code: null },
      currentTerm: null,
    });
  });

  it('answers every term of the detail with its status and the latest as the current term', async () => {
    const reads = {
      detail: jest.fn().mockResolvedValue({
        row: {
          ...CONTRACT,
          reservationExpiresAt: null,
          handoverAppointmentAt: null,
          holdExpiresAt: null,
          terms: [
            { ...term(1), status: 'CLOSED' },
            { ...term(2), status: 'OPEN' },
          ],
          devices: [
            {
              id: 'cd-1',
              deviceId: 'd-1',
              handedOverAt: AT,
              checkedInAt: null,
              lostAt: null,
              holderName: null,
              holderPhone: null,
              holderEmergencyContact: null,
            },
          ],
        },
        organization: ORG,
        variantCode: 'treklink-v3',
        variant: null,
        assetTags: new Map(),
        nodeNums: new Map(),
        returnChecks: new Map(),
        provisionedKeyVersions: new Map(),
        returnStates: new Map(),
        balance: { dueNowVnd: 225_000n, dueLaterVnd: 450_000n },
      }),
    };
    const detail = await build({ reads }).detail('c-1', MANAGER);
    expect(detail.terms).toEqual([
      { ...term(1), status: 'CLOSED' },
      { ...term(2), status: 'OPEN' },
    ]);
    expect(detail.currentTerm).toEqual(term(2));
    expect(detail.balance).toEqual({ dueNowVnd: 225_000, dueLaterVnd: 450_000 });
    expect(detail.devices[0]).toMatchObject({ deviceId: 'd-1', assetTag: null, nodeNum: null });
  });

  it('reads the transitions for the caller', async () => {
    const reads = { transitions: jest.fn().mockResolvedValue([{ to: 'APPROVED' }]) };
    await expect(build({ reads }).transitions('c-1', MANAGER)).resolves.toEqual([
      { to: 'APPROVED' },
    ]);
    expect(reads.transitions).toHaveBeenCalledWith('c-1', MANAGER);
  });

  it('approves with the handover time as a date and answers the held devices', async () => {
    const decisions = {
      approve: jest.fn().mockResolvedValue({
        contract: CONTRACT,
        term: term(1),
        reservationExpiresAt: new Date('2026-11-11T03:00:00.000Z'),
        handoverAppointmentAt: new Date('2026-11-12T03:00:00.000Z'),
        devices: [
          { id: 'd-1', assetTag: 'TL-0001' },
          { id: 'd-2', assetTag: 'TL-0002' },
        ],
      }),
    };
    const reads = { labellerAfterCommit: labeller() };
    const answer = await build({ decisions, reads }).approve(
      'c-1',
      { handoverAt: '2026-11-12T03:00:00.000Z', expectedVersion: 1, deviceIds: ['d-1', 'd-2'] },
      STAFF,
    );
    expect(decisions.approve).toHaveBeenCalledWith(
      'c-1',
      {
        handoverAt: new Date('2026-11-12T03:00:00.000Z'),
        expectedVersion: 1,
        deviceIds: ['d-1', 'd-2'],
      },
      STAFF,
    );
    expect(answer).toMatchObject({
      code: 'RC-2026-0002',
      organization: ORG,
      currentTerm: term(1),
      reservationExpiresAt: new Date('2026-11-11T03:00:00.000Z'),
      handoverAppointmentAt: new Date('2026-11-12T03:00:00.000Z'),
    });
    expect(answer.devices).toEqual([
      {
        deviceId: 'd-1',
        assetTag: 'TL-0001',
        handedOverAt: null,
        checkedInAt: null,
        lostAt: null,
        holder: null,
      },
      {
        deviceId: 'd-2',
        assetTag: 'TL-0002',
        handedOverAt: null,
        checkedInAt: null,
        lostAt: null,
        holder: null,
      },
    ]);
  });

  it('answers a cancellation with the amount retained as a number', async () => {
    const cancelled = { ...CONTRACT, status: ContractStatus.CANCELLED };
    const decisions = {
      cancel: jest.fn().mockResolvedValue({ contract: cancelled, retainedVnd: 112_500n }),
    };
    const reads = { labellerAfterCommit: labeller() };
    const dto = { reason: 'Trip cancelled', expectedVersion: 3 };
    const answer = await build({ decisions, reads }).cancel('c-1', dto, MANAGER);
    expect(decisions.cancel).toHaveBeenCalledWith('c-1', dto, MANAGER);
    expect(answer).toMatchObject({
      status: ContractStatus.CANCELLED,
      organization: ORG,
      retainedVnd: 112_500,
    });
  });

  it('records the notice and answers the term and the amount due at the end as a number', async () => {
    const decisions = {
      giveNotice: jest.fn().mockResolvedValue({
        contract: { ...CONTRACT, status: ContractStatus.ENDING },
        term: term(2),
        dueAtEndVnd: 900_000n,
      }),
    };
    const reads = { labellerAfterCommit: labeller() };
    const answer = await build({ decisions, reads }).notice('c-1', { expectedVersion: 3 }, MANAGER);
    expect(decisions.giveNotice).toHaveBeenCalledWith('c-1', 3, MANAGER);
    expect(answer).toMatchObject({
      status: ContractStatus.ENDING,
      currentTerm: term(2),
      dueAtEndVnd: 900_000,
    });
  });

  describe('holder label', () => {
    const row = {
      id: 'cd-1',
      deviceId: DEVICE_ID,
      handedOverAt: AT,
      checkedInAt: null,
      lostAt: null,
      holderName: 'Nam',
      holderPhone: '0901',
      holderEmergencyContact: null,
    };

    const holder = async (dto: Record<string, unknown>, tags: Map<string, string>) => {
      const decisions = { setHolder: jest.fn().mockResolvedValue(row) };
      const devices = { assetTags: jest.fn().mockResolvedValue(tags) };
      const answer = await build({ decisions, devices }).holder(ID, DEVICE_ID, dto, MANAGER);
      return { answer, setHolder: decisions.setHolder, assetTags: devices.assetTags };
    };

    it('trims each field and turns a blank phone or emergency contact into null', async () => {
      const { answer, setHolder, assetTags } = await holder(
        { name: '  Nam  ', phone: ' 0901 ', emergencyContact: '   ' },
        new Map([[DEVICE_ID, 'TL-0017']]),
      );
      expect(setHolder).toHaveBeenCalledWith(
        ID,
        DEVICE_ID,
        { name: 'Nam', phone: '0901', emergencyContact: null },
        MANAGER,
      );
      expect(assetTags).toHaveBeenCalledWith([DEVICE_ID]);
      expect(answer).toMatchObject({
        deviceId: DEVICE_ID,
        assetTag: 'TL-0017',
        holder: { name: 'Nam', phone: '0901', emergencyContact: null },
      });
    });

    it('keeps a phone and an emergency contact that are present', async () => {
      const { setHolder } = await holder(
        { name: 'Nam', phone: '0901', emergencyContact: ' 0902 ' },
        new Map(),
      );
      expect(callArg(setHolder, 0, 2)).toEqual({
        name: 'Nam',
        phone: '0901',
        emergencyContact: '0902',
      });
    });

    it('clears the whole label for a blank or missing name', async () => {
      const blank = await holder({ name: '   ', phone: '0901' }, new Map());
      expect(callArg(blank.setHolder, 0, 2)).toBeNull();
      const missing = await holder({}, new Map());
      expect(callArg(missing.setHolder, 0, 2)).toBeNull();
    });

    it('answers a null asset tag when the device has none', async () => {
      const { answer } = await holder({ name: 'Nam' }, new Map());
      expect(answer.assetTag).toBeNull();
    });
  });

  it('needs the permission of each action and nothing weaker', () => {
    const table: [string, string][] = [
      ['list', 'read'],
      ['detail', 'read'],
      ['transitions', 'read'],
      ['approve', 'operate'],
      ['reject', 'operate'],
      ['request', 'request'],
      ['notice', 'notice'],
      ['end', 'end'],
      ['endPreview', 'end'],
      ['holder', 'label'],
    ];
    for (const [name, action] of table) {
      expect(allows(ContractsController, name, [{ action, subject: 'RentalContract' }])).toBe(true);
      expect(allows(ContractsController, name, [])).toBe(false);
    }
    expect(
      allows(ContractsController, 'approve', [{ action: 'read', subject: 'RentalContract' }]),
    ).toBe(false);
    expect(messageOf(ContractsController, 'approve')).toBe('Contract approved');
    expect(messageOf(ContractsController, 'reject')).toBe('Contract rejected');
    expect(messageOf(ContractsController, 'cancel')).toBe('Contract cancelled');
    expect(messageOf(ContractsController, 'notice')).toBe('Notice recorded.');
    expect(messageOf(ContractsController, 'holder')).toBe('Saved.');
  });
});

describe('HandoverController handlers', () => {
  const handover = {
    swap: jest.fn().mockResolvedValue('swapped'),
    exchange: jest.fn().mockResolvedValue('exchanged'),
    preview: jest.fn(),
    note: jest.fn().mockResolvedValue({ integrity: 'OK' }),
  };
  const controller = new HandoverController(
    handover as unknown as HandoverService,
    {} as ContractReadsService,
  );

  it('swaps a unit with the reason trimmed', async () => {
    await expect(controller.swap(ID, DEVICE_ID, { reason: '  GPS dead  ' }, STAFF)).resolves.toBe(
      'swapped',
    );
    expect(handover.swap).toHaveBeenCalledWith(ID, DEVICE_ID, 'GPS dead', STAFF);
  });

  it('exchanges a unit with the body as the service takes it', async () => {
    const dto = { replacementDeviceId: 'd-9', nodeNum: 275700, expectedVersion: 3 };
    await expect(controller.exchange(ID, DEVICE_ID, dto, STAFF)).resolves.toBe('exchanged');
    expect(handover.exchange).toHaveBeenCalledWith(ID, DEVICE_ID, dto, STAFF);
  });

  it('previews the note as base64 with no hash, with the counter checks when given', async () => {
    handover.preview.mockResolvedValue(Buffer.from('%PDF-test'));
    const checks = [{ deviceId: 'd-1', batteryPct: 90, gpsFixOk: true }];
    const answer = await controller.preview(ID, { checks }, STAFF);
    expect(answer).toEqual({
      pdfBase64: Buffer.from('%PDF-test').toString('base64'),
      sha256: null,
    });
    const call = handover.preview.mock.calls[0] as unknown[];
    expect(call[0]).toBe(ID);
    expect(call[1]).toBe(STAFF);
    expect(call[2]).toBeInstanceOf(Date);
    expect(call[3]).toBe(checks);
  });

  it('previews with no counter checks when the query has none', async () => {
    handover.preview.mockResolvedValue(Buffer.from('%PDF-test'));
    await controller.preview(ID, {}, STAFF);
    const call = handover.preview.mock.calls.at(-1) as unknown[];
    expect(call[3]).toEqual([]);
  });

  it('reads the stored note through the service', async () => {
    await expect(controller.note(ID, STAFF)).resolves.toEqual({ integrity: 'OK' });
    expect(handover.note).toHaveBeenCalledWith(ID, STAFF);
  });

  it('needs operate for the counter actions and read on HandoverNote for the note', () => {
    const operate = [{ action: 'operate', subject: 'RentalContract' }];
    const read = [{ action: 'read', subject: 'HandoverNote' }];
    for (const name of ['swap', 'exchange', 'preview', 'complete']) {
      expect(allows(HandoverController, name, operate)).toBe(true);
      expect(allows(HandoverController, name, read)).toBe(false);
    }
    expect(allows(HandoverController, 'note', read)).toBe(true);
    expect(allows(HandoverController, 'note', operate)).toBe(false);
    expect(messageOf(HandoverController, 'swap')).toBe('Device swapped');
    expect(messageOf(HandoverController, 'exchange')).toBe('Device exchanged');
    expect(messageOf(HandoverController, 'preview')).toBe('OK');
    expect(messageOf(HandoverController, 'note')).toBe('OK');
  });
});
