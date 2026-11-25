import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { HandoverService } from './handover.service';
import { ReplacementService } from './replacement.service';

// The renderer is covered by its own spec; here only what the service passes to it matters.
jest.mock('./handover-note.renderer', () => ({
  renderHandoverNote: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
}));

const AT = new Date('2026-11-10T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const SIGNATURE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const INPUT = {
  replacementDeviceId: 'd-9',
  keyVersion: 2,
  signatureImage: SIGNATURE,
  faultyPresent: true,
};

const contract = (): ContractRow => ({
  id: 'c-1',
  code: 'RC-2026-0001',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v-3',
  quantity: 2,
  requestedStartDate: new Date('2026-10-25T00:00:00.000Z'),
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: null,
  holdingFeeRatio: new Prisma.Decimal('0.5'),
  status: ContractStatus.ACTIVE,
  statusChangedAt: AT,
  handedOverAt: new Date('2026-10-25T03:00:00.000Z'),
  endsAt: null,
  noticeGivenAt: null,
  returnDueAt: null,
  version: 3,
});

const callArg = (mock: jest.Mock, call: number, arg: number): unknown =>
  (mock.mock.calls[call] as unknown[])[arg];

describe('ReplacementService branches', () => {
  let contracts: Record<string, jest.Mock>;
  let devices: Record<string, jest.Mock>;
  let organizations: Record<string, jest.Mock>;
  let handover: Record<string, jest.Mock>;
  let service: ReplacementService;

  beforeEach(() => {
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      rowsOut: jest.fn().mockResolvedValue([
        { id: 'cd-1', deviceId: 'd-1' },
        { id: 'cd-2', deviceId: 'd-2' },
      ]),
      insertReplacementRow: jest.fn().mockResolvedValue({ id: 'cd-3' }),
      detail: jest.fn().mockResolvedValue({ ...contract(), terms: [], devices: [] }),
    };
    devices = {
      assetTags: jest.fn().mockResolvedValue(new Map([['d-1', 'TL-0001']])),
      takeForReplacement: jest.fn().mockResolvedValue({ id: 'd-9', assetTag: 'TL-0009' }),
      markReturned: jest.fn().mockResolvedValue(undefined),
      hasOpenLossCase: jest.fn().mockResolvedValue(true),
      recordProvisioning: jest.fn().mockResolvedValue({}),
      markRented: jest.fn().mockResolvedValue(undefined),
    };
    organizations = {
      assertActive: jest.fn().mockResolvedValue(undefined),
      unexposedKeyVersion: jest.fn().mockResolvedValue(2),
    };
    handover = {
      storeNote: jest.fn((name: string) => Promise.resolve(name)),
      noteInput: jest.fn().mockResolvedValue({}),
      partyA: jest.fn().mockResolvedValue({ name: 'Staff One', role: 'TrekLink Staff' }),
    };
    service = new ReplacementService(
      contracts as unknown as ContractsRepository,
      devices as unknown as DevicesService,
      organizations as unknown as OrganizationsService,
      handover as unknown as HandoverService,
      {
        transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
        emitAfterCommit: jest.fn(),
      } as unknown as TransactionalEvents,
      { closeCustody: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  it('takes the replacement at the current time when none is given', async () => {
    jest.useFakeTimers({
      now: AT,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    try {
      await service.replace('c-1', 'd-1', INPUT, STAFF);
      expect(callArg(devices.takeForReplacement, 0, 2)).toEqual(AT);
      expect(
        (callArg(contracts.insertReplacementRow, 0, 0) as { handedOverAt: Date }).handedOverAt,
      ).toEqual(AT);
    } finally {
      jest.useRealTimers();
    }
  });

  it('names the unit as "This device" when it has no asset tag', async () => {
    contracts.rowsOut.mockResolvedValue([]);
    devices.assetTags.mockResolvedValue(new Map());
    const error = await service.replace('c-1', 'd-1', INPUT, STAFF, AT).then(
      () => new Error('did not throw'),
      (caught: unknown) => caught as Error,
    );
    expect(error).toMatchObject({ errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT });
    expect(error.message).toBe('This device does not belong to contract RC-2026-0001.');
  });

  it('passes any other organization failure through unchanged', async () => {
    const other = new DomainException(409, ErrorCode.INVALID_STATE_TRANSITION, 'other');
    organizations.assertActive.mockRejectedValue(other);
    await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).rejects.toBe(other);
    organizations.assertActive.mockRejectedValue(new Error('connection lost'));
    await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).rejects.toThrow(
      'connection lost',
    );
    expect(devices.recordProvisioning).not.toHaveBeenCalled();
  });

  it('answers not found when the contract detail has gone, before storing a note', async () => {
    contracts.detail.mockResolvedValue(null);
    await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    expect(handover.storeNote).not.toHaveBeenCalled();
    expect(contracts.insertReplacementRow).not.toHaveBeenCalled();
  });

  it('prints the device id when the replaced unit has no asset tag, and how it came back', async () => {
    devices.assetTags.mockResolvedValue(new Map());
    await service.replace('c-1', 'd-1', INPUT, STAFF, AT);
    const options = callArg(handover.noteInput, 0, 1) as {
      replaces: { assetTag: string; how: string };
    };
    expect(options.replaces).toEqual({ assetTag: 'd-1', how: 'checked in at the counter' });
  });

  it('says a unit away from the counter is missing with its loss case open', async () => {
    await service.replace('c-1', 'd-1', { ...INPUT, faultyPresent: false }, STAFF, AT);
    const options = callArg(handover.noteInput, 0, 1) as {
      replaces: { assetTag: string; how: string };
    };
    expect(options.replaces).toEqual({
      assetTag: 'TL-0001',
      how: 'missing, with its loss case open',
    });
    expect(devices.markReturned).not.toHaveBeenCalled();
  });
});
