import { HttpStatus } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService } from '../billing';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { DEVICE_HANDED_OVER, HandoverService } from './handover.service';
import { ReplacementService } from './replacement.service';
import { DEVICE_CHECKED_IN } from './return.service';

const AT = new Date('2026-11-10T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
// A 1 x 1 PNG, the smallest image the note renderer accepts.
const SIGNATURE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const contract = (overrides: Partial<ContractRow> = {}): ContractRow => ({
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
  ...overrides,
});

const INPUT = {
  replacementDeviceId: 'd-9',
  keyVersion: 2,
  signatureImage: SIGNATURE,
  faultyPresent: true,
};

describe('ReplacementService (rentals task 4.3, api-design 15)', () => {
  let contracts: Record<string, jest.Mock>;
  let devices: Record<string, jest.Mock>;
  let organizations: Record<string, jest.Mock>;
  let storeNote: jest.Mock;
  let emitted: [string, Record<string, unknown>][];
  let service: ReplacementService;

  beforeEach(() => {
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      rowsOut: jest.fn().mockResolvedValue([
        { id: 'cd-1', deviceId: 'd-1' },
        { id: 'cd-2', deviceId: 'd-2' },
      ]),
      markCheckedIn: jest.fn().mockResolvedValue(undefined),
      insertReplacementRow: jest.fn().mockResolvedValue({ id: 'cd-3' }),
    };
    devices = {
      variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3' }]),
      assetTags: jest.fn().mockResolvedValue(new Map([['d-1', 'TL-0001']])),
      takeForReplacement: jest.fn().mockResolvedValue({ id: 'd-9', assetTag: 'TL-0009' }),
      markReturned: jest.fn().mockResolvedValue(undefined),
      hasOpenLossCase: jest.fn().mockResolvedValue(false),
      recordProvisioning: jest.fn().mockResolvedValue({}),
      markRented: jest.fn().mockResolvedValue(undefined),
    };
    organizations = {
      assertActive: jest.fn().mockResolvedValue(undefined),
      channelKeyVersion: jest.fn().mockResolvedValue(2),
      labelsOf: jest
        .fn()
        .mockResolvedValue(
          new Map([['org-1', { code: 'ORG-0001', legalName: 'TrekLink Demo Tours' }]]),
        ),
    };
    storeNote = jest.fn().mockImplementation((name: string) => Promise.resolve(name));
    emitted = [];
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    service = new ReplacementService(
      contracts as unknown as ContractsRepository,
      devices as unknown as DevicesService,
      organizations as unknown as OrganizationsService,
      { firstPaymentConfirmed: jest.fn().mockResolvedValue(true) } as unknown as BalanceService,
      { storeNote } as unknown as HandoverService,
      events as unknown as TransactionalEvents,
    );
  });

  it('checks in the faulty unit, provisions and hands over the replacement on its own row', async () => {
    const replaced = await service.replace('c-1', 'd-1', INPUT, STAFF, AT);

    expect(contracts.markCheckedIn).toHaveBeenCalledWith(['cd-1'], AT, 'u-staff', TX);
    expect(devices.markReturned).toHaveBeenCalledWith(['d-1'], AT, TX);
    expect(devices.takeForReplacement).toHaveBeenCalledWith('d-9', 'v-3', AT, TX);
    expect(devices.recordProvisioning).toHaveBeenCalledWith(
      { deviceId: 'd-9', organizationId: 'org-1', keyVersion: 2, actorId: 'u-staff' },
      AT,
      TX,
    );
    expect(devices.markRented).toHaveBeenCalledWith(['d-9'], AT, TX);
    expect(storeNote).toHaveBeenCalledWith('c-1-replacement-d-9.pdf', expect.any(Buffer));
    expect(contracts.insertReplacementRow).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'c-1',
        deviceId: 'd-9',
        replacesId: 'cd-1',
        handedOverAt: AT,
        replacementNotePath: 'c-1-replacement-d-9.pdf',
      }),
      TX,
    );
    expect(replaced).toMatchObject({
      replacedDeviceId: 'd-1',
      replacementDeviceId: 'd-9',
      contractDeviceId: 'cd-3',
      replacesId: 'cd-1',
    });
    expect(replaced.noteSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(emitted.map(([name]) => name)).toEqual([
      DEVICE_CHECKED_IN,
      DEVICE_HANDED_OVER,
      'audit.record',
    ]);
  });

  it('keeps the live rows equal to the quantity: one checked in, one added', async () => {
    await service.replace('c-1', 'd-1', INPUT, STAFF, AT);
    const out = 2;
    const [[checkedIn]] = contracts.markCheckedIn.mock.calls as [string[]][];
    const added = contracts.insertReplacementRow.mock.calls.length;
    expect(out - checkedIn.length + added).toBe(contract().quantity);
  });

  it('works on an ENDING contract', async () => {
    contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ENDING }));
    await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).resolves.toMatchObject({
      replacementDeviceId: 'd-9',
    });
  });

  it.each([ContractStatus.RETURN_DUE, ContractStatus.APPROVED, ContractStatus.RETURNED])(
    'refuses a %s contract with 409 INVALID_STATE_TRANSITION and changes nothing',
    async (status) => {
      contracts.lockById.mockResolvedValue(contract({ status }));
      await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
        message: `This cannot be done while it is ${status}.`,
      });
      expect(devices.takeForReplacement).not.toHaveBeenCalled();
      expect(contracts.markCheckedIn).not.toHaveBeenCalled();
    },
  );

  it('refuses a unit that is not out on the contract with 409 DEVICE_NOT_ON_CONTRACT naming it', async () => {
    devices.assetTags.mockResolvedValue(new Map([['d-7', 'TL-0007']]));
    await expect(service.replace('c-1', 'd-7', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT,
      message: 'TL-0007 does not belong to contract RC-2026-0001.',
    });
  });

  it('passes the variant and availability refusals of devices through', async () => {
    devices.takeForReplacement.mockRejectedValue(
      new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.VARIANT_MISMATCH,
        'Choose a unit of the same variant.',
      ),
    );
    await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.VARIANT_MISMATCH,
    });
    expect(contracts.insertReplacementRow).not.toHaveBeenCalled();
  });

  it('refuses a suspended organization with the replacement message', async () => {
    organizations.assertActive.mockRejectedValue(
      new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.ORGANIZATION_NOT_ACTIVE,
        'Your organization cannot request devices while it is SUSPENDED.',
      ),
    );
    await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      message: 'Replacement is not allowed while suspended.',
    });
  });

  it('refuses a key version other than the organization current one', async () => {
    organizations.channelKeyVersion.mockResolvedValue(3);
    await expect(service.replace('c-1', 'd-1', INPUT, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.KEY_VERSION_MISMATCH,
    });
    expect(devices.recordProvisioning).not.toHaveBeenCalled();
  });

  it('needs an open loss case for a unit that is not at the counter', async () => {
    const away = { ...INPUT, faultyPresent: false };
    await expect(service.replace('c-1', 'd-1', away, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.LOSS_CASE_REQUIRED,
    });

    devices.hasOpenLossCase.mockResolvedValue(true);
    await service.replace('c-1', 'd-1', away, STAFF, AT);
    expect(contracts.markCheckedIn).not.toHaveBeenCalled();
    expect(devices.markReturned).not.toHaveBeenCalled();
    expect(emitted.map(([name]) => name)).not.toContain(DEVICE_CHECKED_IN);
  });

  it('refuses a signature that is not a PNG before opening the transaction', async () => {
    await expect(
      service.replace('c-1', 'd-1', { ...INPUT, signatureImage: 'bm90IGEgcG5n' }, STAFF, AT),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    expect(contracts.lockById).not.toHaveBeenCalled();
  });
});
