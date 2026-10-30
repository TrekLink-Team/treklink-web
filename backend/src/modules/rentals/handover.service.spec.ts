import { ConfigService } from '@nestjs/config';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService } from '../billing';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { renderHandoverNote } from './handover-note.renderer';
import { DEVICE_HANDED_OVER, HandoverInput, HandoverService } from './handover.service';

const AT = new Date('2026-11-02T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const MEMBER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const OTHER: Caller = { id: 'u-x', roles: ['ORG_MANAGER'], organizationId: 'org-2' };
// A 1 x 1 PNG, as the signature pad sends it.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const contract = (overrides: Partial<ContractRow> = {}): ContractRow => ({
  id: 'c-1',
  code: 'RC-2026-0001',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v-3',
  quantity: 2,
  requestedStartDate: new Date('2026-11-02T00:00:00.000Z'),
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
  ...overrides,
});

const unit = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  assetTag: `TL-${id}`,
  keyOrganizationId: 'org-1',
  keyVersion: 2,
  ...overrides,
});

const input = (overrides: Partial<HandoverInput> = {}): HandoverInput => ({
  signedByUserId: 'u-mgr',
  identityChecked: 'CCCD ending 1234',
  signaturePng: PNG,
  deviceChecks: [
    { deviceId: 'd-1', batteryPct: 90, gpsFixOk: true },
    { deviceId: 'd-2', batteryPct: 85, gpsFixOk: true },
  ],
  acknowledgeLowBattery: false,
  expectedVersion: 3,
  ...overrides,
});

describe('HandoverService (rentals tasks 2.3 and 2.4)', () => {
  let dir: string;
  let contracts: Record<string, jest.Mock>;
  let devices: Record<string, jest.Mock>;
  let organizations: Record<string, jest.Mock>;
  let balances: { firstPaymentConfirmed: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let emitAfterCommit: jest.Mock;
  let service: HandoverService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'handover-'));
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      findDeviceRow: jest.fn().mockResolvedValue({ id: 'cd-1', deviceId: 'd-1' }),
      releaseRow: jest.fn().mockResolvedValue(undefined),
      insertContractDevices: jest.fn().mockResolvedValue(undefined),
      liveRows: jest.fn().mockResolvedValue([{ deviceId: 'd-1' }, { deviceId: 'd-2' }]),
      detail: jest
        .fn()
        .mockResolvedValue({ ...contract(), devices: [{ deviceId: 'd-1' }, { deviceId: 'd-2' }] }),
      markRowsHandedOver: jest.fn().mockResolvedValue(undefined),
      recordHandover: jest.fn().mockResolvedValue(undefined),
      noteOf: jest.fn(),
    };
    devices = {
      variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3' }]),
      failHandoverCheck: jest.fn().mockResolvedValue(undefined),
      reserve: jest.fn().mockResolvedValue([{ id: 'd-9', assetTag: 'TL-d-9' }]),
      assetTags: jest.fn((ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, `TL-${id}`]))),
      ),
      provisioning: jest.fn().mockResolvedValue([unit('d-1'), unit('d-2')]),
      markRented: jest.fn().mockResolvedValue(undefined),
      recordProvisioning: jest.fn().mockResolvedValue(unit('d-1')),
    };
    organizations = {
      channelKeyVersion: jest.fn().mockResolvedValue(2),
      isActiveManager: jest.fn().mockResolvedValue(true),
      labelsOf: jest
        .fn()
        .mockResolvedValue(new Map([['org-1', { code: 'ORG-0001', legalName: 'Acme Trek' }]])),
    };
    balances = { firstPaymentConfirmed: jest.fn().mockResolvedValue(true) };
    lifecycle = {
      apply: jest.fn().mockResolvedValue(contract({ status: ContractStatus.ACTIVE, version: 4 })),
    };
    emitAfterCommit = jest.fn();
    service = new HandoverService(
      contracts as unknown as ContractsRepository,
      lifecycle as unknown as ContractLifecycleService,
      devices as unknown as DevicesService,
      organizations as unknown as OrganizationsService,
      balances as unknown as BalanceService,
      { get: jest.fn().mockResolvedValue(20) } as unknown as ParameterService,
      {
        transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
        emitAfterCommit,
      } as unknown as TransactionalEvents,
      { get: () => dir } as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  describe('provision (api-design 09)', () => {
    it("records the organization's current key version on a reserved unit", async () => {
      await service.provision('c-1', 'd-1', 2, STAFF, AT);
      expect(devices.recordProvisioning).toHaveBeenCalledWith(
        { deviceId: 'd-1', organizationId: 'org-1', keyVersion: 2, actorId: 'u-staff' },
        AT,
        TX,
      );
    });

    it('refuses another key version, a unit not on the contract, and a contract not APPROVED', async () => {
      await expect(service.provision('c-1', 'd-1', 1, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.KEY_VERSION_MISMATCH,
      });
      contracts.findDeviceRow.mockResolvedValueOnce(null);
      await expect(service.provision('c-1', 'd-7', 2, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT,
      });
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.ACTIVE }));
      await expect(service.provision('c-1', 'd-1', 2, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(devices.recordProvisioning).not.toHaveBeenCalled();
    });
  });

  it('swaps a failing unit to MAINTENANCE and reserves another of the variant (api-design 07)', async () => {
    await expect(service.swap('c-1', 'd-1', 'No GPS fix', STAFF, AT)).resolves.toEqual({
      released: { deviceId: 'd-1', assetTag: 'TL-d-1', status: 'MAINTENANCE' },
      reserved: { id: 'd-9', assetTag: 'TL-d-9', status: 'RESERVED' },
    });
    expect(contracts.releaseRow).toHaveBeenCalledWith('cd-1', AT, TX);
    expect(devices.failHandoverCheck).toHaveBeenCalledWith('d-1', 'No GPS fix', STAFF.id, AT, TX);
    expect(devices.reserve).toHaveBeenCalledWith({ id: 'v-3', code: 'treklink-v3' }, 1, AT, TX);
    expect(devices.assetTags).toHaveBeenCalledWith(['d-1'], TX);
    expect(contracts.insertContractDevices).toHaveBeenCalledWith(
      [{ contractId: 'c-1', deviceId: 'd-9' }],
      TX,
    );
  });

  describe('complete (api-design 10)', () => {
    it('stores the signed note, rents the devices, activates the contract and emits per device', async () => {
      await expect(service.complete('c-1', input(), STAFF, AT)).resolves.toMatchObject({
        status: ContractStatus.ACTIVE,
        handedOverAt: AT,
      });
      expect(devices.markRented).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX);
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'c-1',
        ContractStatus.APPROVED,
        ContractStatus.ACTIVE,
        'HANDED_OVER',
        STAFF,
        TX,
      );
      expect(contracts.recordHandover).toHaveBeenCalledWith(
        'c-1',
        expect.objectContaining({
          handedOverById: 'u-staff',
          identityChecked: 'CCCD ending 1234',
          handoverNotePath: 'c-1.pdf',
          handoverNoteSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
        }),
        TX,
      );
      // The note's reads join the handover transaction (no read on another connection mid-tx).
      expect(devices.assetTags).toHaveBeenCalledWith(['d-1', 'd-2'], TX);
      expect(organizations.labelsOf).toHaveBeenCalledWith(['org-1'], TX);
      expect(balances.firstPaymentConfirmed).toHaveBeenCalledWith('c-1', TX);
      expect(emitAfterCommit).toHaveBeenCalledTimes(2);
      expect(emitAfterCommit).toHaveBeenCalledWith(
        DEVICE_HANDED_OVER,
        expect.objectContaining({ deviceId: 'd-1', contractId: 'c-1' }),
      );
    });

    it.each([
      ['a stale version', input({ expectedVersion: 2 }), false, ErrorCode.STALE_VERSION],
      ['a signer who is not a Manager', input(), true, ErrorCode.SIGNER_NOT_MANAGER],
      [
        'a signature that is not a PNG',
        input({ signaturePng: 'aGVsbG8=' }),
        false,
        ErrorCode.VALIDATION_FAILED,
      ],
    ])('refuses %s', async (_name, request, notManager, errorCode) => {
      if (notManager) organizations.isActiveManager.mockResolvedValue(false);
      await expect(service.complete('c-1', request, STAFF, AT)).rejects.toMatchObject({
        errorCode,
      });
      expect(devices.markRented).not.toHaveBeenCalled();
    });

    it('refuses before the start date (UTC+7) and without the first payment', async () => {
      contracts.lockById.mockResolvedValueOnce(
        contract({ requestedStartDate: new Date('2026-11-03T00:00:00.000Z') }),
      );
      await expect(service.complete('c-1', input(), STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.BEFORE_START_DATE,
      });
      balances.firstPaymentConfirmed.mockResolvedValueOnce(false);
      await expect(service.complete('c-1', input(), STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.FIRST_PAYMENT_MISSING,
      });
    });

    it('names the unit not provisioned with the current key, and the unit that failed GPS', async () => {
      devices.provisioning.mockResolvedValueOnce([unit('d-1'), unit('d-2', { keyVersion: 1 })]);
      await expect(service.complete('c-1', input(), STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_PROVISIONED,
        message: expect.stringContaining('TL-d-2') as unknown,
      });
      const failing = input({
        deviceChecks: [
          { deviceId: 'd-1', batteryPct: 90, gpsFixOk: false },
          { deviceId: 'd-2', batteryPct: 90, gpsFixOk: true },
        ],
      });
      await expect(service.complete('c-1', failing, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_CHECK_FAILED,
        message: expect.stringContaining('TL-d-1') as unknown,
      });
    });

    it('holds a low battery until acknowledged (MSG19)', async () => {
      const low = input({
        deviceChecks: [
          { deviceId: 'd-1', batteryPct: 10, gpsFixOk: true },
          { deviceId: 'd-2', batteryPct: 90, gpsFixOk: true },
        ],
      });
      await expect(service.complete('c-1', low, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.LOW_BATTERY,
      });
      await expect(
        service.complete('c-1', { ...low, acknowledgeLowBattery: true }, STAFF, AT),
      ).resolves.toMatchObject({ status: ContractStatus.ACTIVE });
    });
  });

  describe('note (api-design 11)', () => {
    it('returns the stored note with its integrity, and 404 for another organization', async () => {
      const pdf = Buffer.from('%PDF-1.3 note');
      await writeFile(join(dir, 'c-1.pdf'), pdf);
      const { createHash } = await import('node:crypto');
      const digest = createHash('sha256').update(pdf).digest('hex');
      contracts.noteOf.mockResolvedValue({
        organizationId: 'org-1',
        handoverNotePath: 'c-1.pdf',
        handoverNoteSha256: digest,
      });
      await expect(service.note('c-1', MEMBER)).resolves.toEqual({
        pdfBase64: pdf.toString('base64'),
        sha256: digest,
        integrity: 'OK',
      });
      await writeFile(join(dir, 'c-1.pdf'), 'changed');
      await expect(service.note('c-1', STAFF)).resolves.toMatchObject({ integrity: 'MISMATCH' });
      await expect(service.note('c-1', OTHER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });

    it('answers NOTE_NOT_SIGNED before the handover', async () => {
      contracts.noteOf.mockResolvedValue({
        organizationId: 'org-1',
        handoverNotePath: null,
        handoverNoteSha256: null,
      });
      await expect(service.note('c-1', STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.NOTE_NOT_SIGNED,
      });
    });
  });
});

describe('renderHandoverNote', () => {
  it('renders a PDF for the preview and for the signed note', async () => {
    const base = {
      contractCode: 'RC-2026-0001',
      organization: { code: 'ORG-0001', legalName: 'Acme Trek' },
      planLabel: 'Monthly',
      variantCode: 'treklink-v3',
      requestedStartDate: '2026-11-02',
      devices: [{ assetTag: 'TL-0001', batteryPct: null, gpsFixOk: null }],
      firstPaymentConfirmed: true,
      at: AT,
    };
    const preview = await renderHandoverNote(base);
    const signed = await renderHandoverNote({
      ...base,
      signer: { fullName: 'Nguyen Van A', identityChecked: 'CCCD ending 1234' },
      signaturePng: Buffer.from(PNG.split(',')[1], 'base64'),
    });
    expect(preview.subarray(0, 5).toString()).toBe('%PDF-');
    expect(signed.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
