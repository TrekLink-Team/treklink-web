import { ConfigService } from '@nestjs/config';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService, PaymentsService, PricingService } from '../billing';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { DEVICE_HANDED_OVER, HandoverInput, HandoverService, noteNumber } from './handover.service';

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
  let payments: { receivedOfContract: jest.Mock };
  let pricing: { rateTableFor: jest.Mock };
  let parameters: { get: jest.Mock };
  let directory: { namesOf: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let config: Record<string, string>;
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
      detail: jest.fn().mockResolvedValue({
        ...contract(),
        terms: [],
        devices: [{ deviceId: 'd-1' }, { deviceId: 'd-2' }],
      }),
      markRowsHandedOver: jest.fn().mockResolvedValue(undefined),
      recordHandover: jest.fn().mockResolvedValue(undefined),
      noteOf: jest.fn(),
      saveNote: jest.fn().mockResolvedValue(undefined),
      readNote: jest.fn().mockResolvedValue(null),
      bumpVersion: jest.fn().mockResolvedValue(true),
    };
    devices = {
      variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3' }]),
      failHandoverCheck: jest.fn().mockResolvedValue(undefined),
      reserve: jest.fn().mockResolvedValue([{ id: 'd-9', assetTag: 'TL-d-9' }]),
      assetTags: jest.fn((ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, `TL-${id}`]))),
      ),
      provisioning: jest.fn().mockResolvedValue([unit('d-1'), unit('d-2')]),
      handoverUnits: jest.fn((ids: string[]) =>
        Promise.resolve(
          new Map(
            ids.map((id) => [
              id,
              {
                id,
                assetTag: `TL-${id}`,
                nodeId: '!de000001',
                keyVersion: 2,
                firmwareVersion: '2.5.0',
                variantCode: 'treklink-v3',
                remainingValueVnd: 2_500_000,
              },
            ]),
          ),
        ),
      ),
      markRented: jest.fn().mockResolvedValue(undefined),
      recordProvisioning: jest.fn().mockResolvedValue(unit('d-1')),
      clearProvisioning: jest
        .fn()
        .mockResolvedValue(unit('d-1', { keyVersion: null, keyOrganizationId: null })),
    };
    organizations = {
      channelKeyVersion: jest.fn().mockResolvedValue(2),
      isActiveManager: jest.fn().mockResolvedValue(true),
      handoverParty: jest.fn().mockResolvedValue({
        id: 'org-1',
        code: 'ORG-0001',
        legalName: 'Acme Trek',
        taxCode: '0109876543',
        address: '12 Le Loi, Da Lat',
        masterContractRef: 'MC-2026-017',
        ndaSigned: true,
        softwareLicenceSigned: true,
      }),
    };
    balances = { firstPaymentConfirmed: jest.fn().mockResolvedValue(true) };
    payments = {
      receivedOfContract: jest.fn().mockResolvedValue([
        {
          invoiceNumber: 'INV-2026-000001',
          amountVnd: 225_000n,
          method: 'CASH',
          reference: 'RCPT-1',
          confirmedAt: AT,
        },
      ]),
    };
    pricing = {
      rateTableFor: jest
        .fn()
        .mockResolvedValue([
          { code: 'CASING_CRACKED', label: 'Casing cracked', amountVnd: 300_000n },
        ]),
    };
    const values: Record<string, number> = {
      'devices.handoverMinBatteryPct': 20,
      'billing.lateFeePerDevicePerDayVnd': 50_000,
      'rentals.returnGraceHours': 24,
      'rentals.defaultAfterDays': 14,
      'devices.lossSearchDays': 7,
    };
    parameters = { get: jest.fn((key: string) => Promise.resolve(values[key])) };
    directory = {
      namesOf: jest.fn(
        () =>
          new Map([
            ['u-mgr', 'Lâm Phi Long'],
            ['u-staff', 'Trần Thị Bích'],
          ]),
      ),
    };
    config = {
      COMPANY_LEGAL_NAME: 'TrekLink Co., Ltd.',
      COMPANY_ADDRESS: 'Ho Chi Minh City',
      COMPANY_TAX_CODE: '0312345678',
      COMPANY_HOTLINE: '1900 1234',
      HANDOVER_PLACE: 'Counter 1',
    };
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
      payments as unknown as PaymentsService,
      pricing as unknown as PricingService,
      parameters as unknown as ParameterService,
      {
        transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
        emitAfterCommit,
      } as unknown as TransactionalEvents,
      {
        get: (key: string) => (key === 'HANDOVER_NOTE_STORAGE_DIR' ? dir : config[key]),
      } as unknown as ConfigService<ValidatedEnvironment, true>,
      directory,
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

  describe('undoProvisioning (api-design 19, REQ-EVT-16, REQ-ERR-10)', () => {
    const PROVISIONED_AT = new Date('2026-11-02T02:50:00.000Z');

    beforeEach(() => {
      devices.provisioning.mockResolvedValue([
        unit('d-1', { status: 'RESERVED', provisionedAt: PROVISIONED_AT }),
      ]);
    });

    it('clears the record, bumps the contract version and audits after commit', async () => {
      await expect(service.undoProvisioning('c-1', 'd-1', 3, STAFF)).resolves.toMatchObject({
        device: { id: 'd-1', keyVersion: null, keyOrganizationId: null },
        contractVersion: 4,
      });
      expect(contracts.bumpVersion).toHaveBeenCalledWith('c-1', 3, TX);
      expect(devices.clearProvisioning).toHaveBeenCalledWith('d-1', TX);
      expect(devices.provisioning).toHaveBeenCalledWith(['d-1'], TX);
      expect(emitAfterCommit).toHaveBeenCalledWith('audit.record', {
        actorId: 'u-staff',
        actorRoles: ['STAFF'],
        organizationId: 'org-1',
        action: 'contract.provisioningUndone',
        subjectType: 'RentalContract',
        subjectId: 'c-1',
        before: { deviceId: 'd-1', keyVersion: 2, provisionedAt: PROVISIONED_AT.toISOString() },
        after: { deviceId: 'd-1', keyVersion: null },
      });
    });

    it('refuses a stale version first, then a contract not APPROVED', async () => {
      await expect(service.undoProvisioning('c-1', 'd-1', 2, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.ACTIVE }));
      await expect(service.undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(contracts.findDeviceRow).not.toHaveBeenCalled();
      expect(contracts.bumpVersion).not.toHaveBeenCalled();
      expect(devices.clearProvisioning).not.toHaveBeenCalled();
      expect(emitAfterCommit).not.toHaveBeenCalled();
    });

    it('refuses a unit not on the contract, handed over or not RESERVED', async () => {
      contracts.findDeviceRow.mockResolvedValueOnce(null);
      await expect(service.undoProvisioning('c-1', 'd-7', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT,
      });
      contracts.findDeviceRow.mockResolvedValueOnce({
        id: 'cd-1',
        deviceId: 'd-1',
        handedOverAt: AT,
      });
      await expect(service.undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      devices.provisioning.mockResolvedValueOnce([unit('d-1', { status: 'MAINTENANCE' })]);
      await expect(service.undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
        message: 'This cannot be done while it is MAINTENANCE.',
      });
      expect(devices.clearProvisioning).not.toHaveBeenCalled();
      expect(emitAfterCommit).not.toHaveBeenCalled();
    });

    it("refuses a unit that carries no key version of the contract's organization", async () => {
      devices.provisioning.mockResolvedValueOnce([
        unit('d-1', { status: 'RESERVED', keyVersion: null, keyOrganizationId: null }),
      ]);
      await expect(service.undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_PROVISIONED,
        message: 'TL-d-1 has no provisioning to undo.',
      });
      devices.provisioning.mockResolvedValueOnce([
        unit('d-1', { status: 'RESERVED', keyOrganizationId: 'org-2' }),
      ]);
      await expect(service.undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_PROVISIONED,
      });
      expect(devices.clearProvisioning).not.toHaveBeenCalled();
      expect(emitAfterCommit).not.toHaveBeenCalled();
    });

    it('changes nothing when the version moved under the lock', async () => {
      contracts.bumpVersion.mockResolvedValueOnce(false);
      await expect(service.undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      expect(devices.clearProvisioning).not.toHaveBeenCalled();
      expect(emitAfterCommit).not.toHaveBeenCalled();
    });
  });

  it('swaps a failing unit to MAINTENANCE and reserves another of the variant (api-design 07)', async () => {
    await expect(service.swap('c-1', 'd-1', 'No GPS fix', STAFF, AT)).resolves.toEqual({
      released: { deviceId: 'd-1', assetTag: 'TL-d-1', status: 'MAINTENANCE' },
      reserved: { id: 'd-9', assetTag: 'TL-d-9', status: 'RESERVED' },
    });
    expect(contracts.releaseRow).toHaveBeenCalledWith('cd-1', AT, TX);
    const move = { contractId: 'c-1', contractCode: 'RC-2026-0001', actorId: STAFF.id };
    expect(devices.failHandoverCheck).toHaveBeenCalledWith(
      'd-1',
      'No GPS fix',
      STAFF.id,
      AT,
      TX,
      move,
    );
    expect(devices.reserve).toHaveBeenCalledWith(
      { id: 'v-3', code: 'treklink-v3' },
      1,
      AT,
      TX,
      move,
    );
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
      expect(devices.markRented).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX, {
        contractId: 'c-1',
        contractCode: 'RC-2026-0001',
        actorId: STAFF.id,
      });
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
      expect(devices.handoverUnits).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX);
      expect(organizations.handoverParty).toHaveBeenCalledWith('org-1', TX);
      expect(balances.firstPaymentConfirmed).toHaveBeenCalledWith('c-1', TX);
      expect(payments.receivedOfContract).toHaveBeenCalledWith('c-1', TX);
      expect(pricing.rateTableFor).toHaveBeenCalledWith('v-3', TX);
      expect(parameters.get).toHaveBeenCalledWith('billing.lateFeePerDevicePerDayVnd', TX);
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

  describe('noteInput (design §4.1)', () => {
    const detail = (overrides: Partial<ContractRow> = {}) => ({
      ...contract(overrides),
      reservationExpiresAt: null,
      handoverAppointmentAt: null,
      holdExpiresAt: null,
      terms: [
        {
          id: 't-1',
          seq: 1,
          startsAt: new Date('2026-11-02T02:00:00.000Z'),
          endsAt: new Date('2026-12-02T02:00:00.000Z'),
          status: 'OPEN' as const,
        },
      ],
      devices: [{ deviceId: 'd-1' }, { deviceId: 'd-2' }] as never,
    });

    it('fills every section from configuration, parameters and the exported reads', async () => {
      const note = await service.noteInput(
        detail(),
        {
          partyA: await service.partyA(STAFF),
          manager: { fullName: 'Lâm Phi Long', identityDocument: 'CCCD ending 1234' },
          checks: new Map([
            ['d-1', { deviceId: 'd-1', batteryPct: 90, gpsFixOk: true }],
            ['d-2', { deviceId: 'd-2', batteryPct: 10, gpsFixOk: true }],
          ]),
        },
        AT,
        TX,
      );
      expect(note).toMatchObject({
        kind: 'HANDOVER',
        noteNumber: 'HN-2026-0001',
        place: 'Counter 1',
        issuer: {
          legalName: 'TrekLink Co., Ltd.',
          address: 'Ho Chi Minh City',
          taxCode: '0312345678',
          hotline: '1900 1234',
        },
        partyA: { name: 'Trần Thị Bích', role: 'TrekLink Staff' },
        partyB: {
          legalName: 'Acme Trek',
          code: 'ORG-0001',
          taxCode: '0109876543',
          address: '12 Le Loi, Da Lat',
          manager: { fullName: 'Lâm Phi Long', identityDocument: 'CCCD ending 1234' },
        },
        contract: {
          code: 'RC-2026-0001',
          planLabel: 'Monthly',
          variantCode: 'treklink-v3',
          quantity: 2,
          returnDue: null,
          monthlyUnitPriceVnd: 450_000n,
          fee: { label: 'Term fee, per month', amountVnd: 900_000n },
          firstPayment: { label: 'Holding fee', amountVnd: 450_000n },
          masterContractRef: 'MC-2026-017',
          ndaSigned: true,
          softwareLicenceSigned: true,
        },
        payments: [{ invoiceNumber: 'INV-2026-000001', reference: 'RCPT-1', receivedAt: AT }],
        firstPaymentConfirmed: true,
        terms: {
          lateFeePerDevicePerDayVnd: 50_000,
          returnGraceHours: 24,
          defaultAfterDays: 14,
          lossSearchDays: 7,
          damageRates: [{ code: 'CASING_CRACKED', label: 'Casing cracked', amountVnd: 300_000n }],
        },
      });
      expect(note.devices).toEqual([
        expect.objectContaining({
          assetTag: 'TL-d-1',
          nodeId: '!de000001',
          keyVersion: 2,
          batteryPct: 90,
          condition: 'Good working order',
        }),
        expect.objectContaining({
          assetTag: 'TL-d-2',
          batteryPct: 10,
          condition: 'Working order; battery below 20 %, accepted',
        }),
      ]);
    });

    it('prices a day plan, dates its return at the term end, and leaves unchecked units open', async () => {
      const note = await service.noteInput(
        detail({
          planType: PlanType.DAY,
          dayPlanDays: 3,
          dayPremium: new Prisma.Decimal('1.5'),
        }),
        { partyA: { name: null, role: 'TrekLink Staff' } },
        AT,
      );
      expect(note.contract.planLabel).toBe('Day plan, 3 days');
      expect(note.contract.fee).toEqual({ label: 'Day-plan fee', amountVnd: 135_000n });
      expect(note.contract.firstPayment).toEqual({ label: 'Day-plan fee', amountVnd: 135_000n });
      expect(note.contract.returnDue).toEqual(new Date('2026-12-02T02:00:00.000Z'));
      expect(note.devices[0]).toMatchObject({
        batteryPct: null,
        gpsFixOk: null,
        condition: 'To be checked at the counter',
      });
      expect(note.partyB.manager).toBeNull();
    });

    it('numbers the handover and the replacement notes from the contract code', () => {
      expect(noteNumber('RC-2026-0001')).toBe('HN-2026-0001');
      expect(noteNumber('RC-2026-0001', 'TL-0012')).toBe('RN-2026-0001-TL-0012');
    });

    it('renders the preview with the caller as Party A and the counter readings it is given', async () => {
      contracts.detail.mockResolvedValueOnce(detail());
      const pdf = await service.preview('c-1', STAFF, AT, [
        { deviceId: 'd-1', batteryPct: 77, gpsFixOk: true },
      ]);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(directory.namesOf).toHaveBeenCalledWith(['u-staff']);
    });

    it('is 409 INVALID_STATE_TRANSITION once the contract is past APPROVED', async () => {
      contracts.detail.mockResolvedValueOnce({
        ...detail({ status: ContractStatus.ACTIVE }),
        devices: [],
      });
      await expect(service.preview('c-1', STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });
  });

  describe('storeNote (design §4.1, D-090 amendment)', () => {
    it('writes the file under HANDOVER_NOTE_STORAGE_DIR by default', async () => {
      const pdf = Buffer.from('%PDF-1.3 file store');
      await expect(service.storeNote('c-9.pdf', pdf, TX)).resolves.toBe('c-9.pdf');
      await expect(readFile(join(dir, 'c-9.pdf'))).resolves.toEqual(pdf);
      expect(contracts.saveNote).not.toHaveBeenCalled();
    });

    it('keeps the exact bytes in the database, in the caller transaction, with HANDOVER_NOTE_STORE=database', async () => {
      config.HANDOVER_NOTE_STORE = 'database';
      const pdf = Buffer.from('%PDF-1.3 database store');
      await expect(service.storeNote('c-9.pdf', pdf, TX)).resolves.toBe('c-9.pdf');
      expect(contracts.saveNote).toHaveBeenCalledWith('c-9.pdf', pdf, TX);
      await expect(readFile(join(dir, 'c-9.pdf'))).rejects.toThrow();
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

    it('reads the note from the database store with HANDOVER_NOTE_STORE=database (D-090)', async () => {
      config.HANDOVER_NOTE_STORE = 'database';
      const pdf = Buffer.from('%PDF-1.3 stored in the database');
      const { createHash } = await import('node:crypto');
      const digest = createHash('sha256').update(pdf).digest('hex');
      contracts.noteOf.mockResolvedValue({
        organizationId: 'org-1',
        handoverNotePath: 'c-1.pdf',
        handoverNoteSha256: digest,
      });
      contracts.readNote.mockResolvedValueOnce(pdf);
      await expect(service.note('c-1', MEMBER)).resolves.toEqual({
        pdfBase64: pdf.toString('base64'),
        sha256: digest,
        integrity: 'OK',
      });
      expect(contracts.readNote).toHaveBeenCalledWith('c-1.pdf');
      contracts.readNote.mockResolvedValueOnce(null);
      await expect(service.note('c-1', MEMBER)).resolves.toMatchObject({ integrity: 'MISSING' });
    });

    it('reports a note missing from the file store as MISSING', async () => {
      contracts.noteOf.mockResolvedValue({
        organizationId: 'org-1',
        handoverNotePath: 'gone.pdf',
        handoverNoteSha256: 'abc',
      });
      await expect(service.note('c-1', STAFF)).resolves.toEqual({
        pdfBase64: null,
        sha256: 'abc',
        integrity: 'MISSING',
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
