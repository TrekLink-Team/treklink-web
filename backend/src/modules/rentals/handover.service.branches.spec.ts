import { ConfigService } from '@nestjs/config';
import { ContractStatus, DeviceStatus, PlanType, Prisma } from '@prisma/client';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import {
  BalanceService,
  dayPlanFeeVnd,
  PaymentsService,
  PricingService,
  termFeeVnd,
} from '../billing';
import { DevicesService } from '../devices';
import { ChannelKeyService, OrganizationsService } from '../organizations';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractDetailRow, ContractRow, ContractsRepository } from './contracts.repository';
import { HandoverInput, HandoverService } from './handover.service';

const AT = new Date('2026-11-02T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const MEMBER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const OTHER: Caller = { id: 'u-x', roles: ['ORG_MANAGER'], organizationId: 'org-2' };
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

const detail = (overrides: Partial<ContractRow> = {}) =>
  ({
    ...contract(overrides),
    terms: [],
    devices: [{ deviceId: 'd-1' }, { deviceId: 'd-2' }],
  }) as unknown as ContractDetailRow;

const reserved = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  assetTag: `TL-${id}`,
  status: DeviceStatus.RESERVED,
  keyOrganizationId: 'org-1',
  keyVersion: 2,
  provisionedAt: AT,
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

describe('HandoverService branches', () => {
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

  const build = (withDirectory = true) =>
    new HandoverService(
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
      { deriveKey: jest.fn() } as unknown as ChannelKeyService,
      withDirectory ? directory : undefined,
    );

  const callArg = (mock: jest.Mock, call: number, arg: number): unknown =>
    (mock.mock.calls[call] as unknown[])[arg];

  const auditOf = (action: string) => {
    const calls = emitAfterCommit.mock.calls as [string, { action: string }][];
    const call = calls.find(([name, event]) => name === AUDIT_RECORD && event.action === action);
    return call?.[1] as unknown as { before: unknown; after: unknown } | undefined;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'handover-branches-'));
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      findDeviceRow: jest.fn().mockResolvedValue({ id: 'cd-1', deviceId: 'd-1' }),
      releaseRow: jest.fn().mockResolvedValue(undefined),
      insertContractDevices: jest.fn().mockResolvedValue(undefined),
      liveRows: jest.fn().mockResolvedValue([{ deviceId: 'd-1' }, { deviceId: 'd-2' }]),
      detail: jest.fn().mockResolvedValue(detail()),
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
      provisioning: jest.fn().mockResolvedValue([reserved('d-1'), reserved('d-2')]),
      nodeNums: jest.fn().mockResolvedValue(
        new Map([
          ['d-1', 275612],
          ['d-9', 275700],
        ]),
      ),
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
      recordProvisioning: jest.fn().mockResolvedValue(reserved('d-1')),
      clearProvisioning: jest.fn().mockResolvedValue(reserved('d-1', { keyVersion: null })),
      takeForReplacement: jest.fn().mockResolvedValue({ id: 'd-9', assetTag: 'TL-d-9' }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    organizations = {
      unexposedKeyVersion: jest.fn().mockResolvedValue(2),
      channelKeyState: jest
        .fn()
        .mockResolvedValue({ channelKeyVersion: 2, channelKeyExposedAt: null }),
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
    payments = { receivedOfContract: jest.fn().mockResolvedValue([]) };
    pricing = { rateTableFor: jest.fn().mockResolvedValue([]) };
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
            ['u-mgr', 'Lam Phi Long'],
            ['u-staff', 'Tran Thi Bich'],
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
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  describe('defaults and the audit trail of provision', () => {
    it('stamps the provisioning with the current time when none is given', async () => {
      await build().provision('c-1', 'd-1', 2, STAFF);
      expect(callArg(devices.recordProvisioning, 0, 1)).toBeInstanceOf(Date);
    });

    it('audits a provisioning without a docked node as manual', async () => {
      await build().provision('c-1', 'd-1', 2, STAFF, AT);
      expect(auditOf('contract.provisioningRecordedManually')?.after).toEqual({
        deviceId: 'd-1',
        keyVersion: 2,
        manual: true,
      });
    });

    it('does not audit a provisioning that came with a docked node', async () => {
      await build().provision('c-1', 'd-1', 2, STAFF, AT, 275612);
      expect(auditOf('contract.provisioningRecordedManually')).toBeUndefined();
    });
  });

  describe('issueChannelKey', () => {
    it('refuses a contract that is not approved', async () => {
      contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ACTIVE }));
      await expect(build().issueChannelKey('c-1', 'd-1', 275612, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('refuses a device that is already handed over', async () => {
      contracts.findDeviceRow.mockResolvedValue({ id: 'cd-1', deviceId: 'd-1', handedOverAt: AT });
      await expect(build().issueChannelKey('c-1', 'd-1', 275612, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('names the unit status when it is not reserved', async () => {
      devices.provisioning.mockResolvedValue([reserved('d-1', { status: DeviceStatus.AVAILABLE })]);
      const error = await build()
        .issueChannelKey('c-1', 'd-1', 275612, STAFF)
        .then(
          () => new Error('did not throw'),
          (caught: unknown) => caught as Error,
        );
      expect(error).toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
      expect(error.message).toContain('AVAILABLE');
    });

    it('says handed over when the unit is unknown', async () => {
      devices.provisioning.mockResolvedValue([]);
      const error = await build()
        .issueChannelKey('c-1', 'd-1', 275612, STAFF)
        .then(
          () => new Error('did not throw'),
          (caught: unknown) => caught as Error,
        );
      expect(error).toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
      expect(error.message).toContain('handed over');
    });

    it('refuses a docked unit that is not the device on the row', async () => {
      await expect(build().issueChannelKey('c-1', 'd-1', 999, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.NODE_MISMATCH,
      });
    });
  });

  describe('undoProvisioning', () => {
    it('says handed over when the unit is unknown', async () => {
      devices.provisioning.mockResolvedValue([]);
      const error = await build()
        .undoProvisioning('c-1', 'd-1', 3, STAFF)
        .then(
          () => new Error('did not throw'),
          (caught: unknown) => caught as Error,
        );
      expect(error).toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
      expect(error.message).toContain('handed over');
      expect(devices.clearProvisioning).not.toHaveBeenCalled();
    });

    it('refuses a unit with no provisioning of this organization', async () => {
      devices.provisioning.mockResolvedValue([reserved('d-1', { keyOrganizationId: 'org-2' })]);
      await expect(build().undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_PROVISIONED,
      });
      devices.provisioning.mockResolvedValue([reserved('d-1', { keyVersion: null })]);
      await expect(build().undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_PROVISIONED,
      });
    });

    it('refuses when the version bump loses the race', async () => {
      contracts.bumpVersion.mockResolvedValue(false);
      await expect(build().undoProvisioning('c-1', 'd-1', 3, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      expect(devices.clearProvisioning).not.toHaveBeenCalled();
    });

    it('audits a null provisioning time and returns the next version', async () => {
      devices.provisioning.mockResolvedValue([reserved('d-1', { provisionedAt: null })]);
      const result = await build().undoProvisioning('c-1', 'd-1', 3, STAFF);
      expect(result.contractVersion).toBe(4);
      expect(auditOf('contract.provisioningUndone')?.before).toEqual({
        deviceId: 'd-1',
        keyVersion: 2,
        provisionedAt: null,
      });
    });
  });

  describe('swap', () => {
    it('refuses a contract that is not approved', async () => {
      contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ACTIVE }));
      await expect(build().swap('c-1', 'd-1', 'GPS dead', STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(contracts.releaseRow).not.toHaveBeenCalled();
    });

    it('falls back to the variant id when the variant list does not know it', async () => {
      devices.variants.mockResolvedValue([]);
      await build().swap('c-1', 'd-1', 'GPS dead', STAFF, AT);
      expect(callArg(devices.reserve, 0, 0)).toEqual({ id: 'v-3', code: 'v-3' });
    });

    it('reports a null asset tag when the released unit has none', async () => {
      devices.assetTags.mockResolvedValue(new Map());
      const result = await build().swap('c-1', 'd-1', 'GPS dead', STAFF, AT);
      expect(result.released).toEqual({ deviceId: 'd-1', assetTag: null, status: 'MAINTENANCE' });
    });

    it('uses the current time when none is given', async () => {
      await build().swap('c-1', 'd-1', 'GPS dead', STAFF);
      expect(callArg(contracts.releaseRow, 0, 1)).toBeInstanceOf(Date);
    });
  });

  describe('exchange', () => {
    const request = { replacementDeviceId: 'd-9', nodeNum: 275700, expectedVersion: 3 };
    const unit = reserved('d-1', { keyVersion: null, keyOrganizationId: null });

    beforeEach(() => {
      devices.provisioning.mockResolvedValue([unit]);
    });

    it('refuses a contract that is not approved', async () => {
      contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ACTIVE }));
      await expect(build().exchange('c-1', 'd-1', request, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('refuses a stale version before looking at the device', async () => {
      await expect(
        build().exchange('c-1', 'd-1', { ...request, expectedVersion: 2 }, STAFF, AT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
      expect(contracts.findDeviceRow).not.toHaveBeenCalled();
    });

    it('refuses a unit that is not on the contract', async () => {
      contracts.findDeviceRow.mockResolvedValue(null);
      await expect(build().exchange('c-1', 'd-1', request, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT,
      });
    });

    it('refuses a unit already handed over, unknown, or not reserved', async () => {
      contracts.findDeviceRow.mockResolvedValue({ id: 'cd-1', deviceId: 'd-1', handedOverAt: AT });
      await expect(build().exchange('c-1', 'd-1', request, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      contracts.findDeviceRow.mockResolvedValue({ id: 'cd-1', deviceId: 'd-1' });
      devices.provisioning.mockResolvedValue([]);
      await expect(build().exchange('c-1', 'd-1', request, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      devices.provisioning.mockResolvedValue([{ ...unit, status: DeviceStatus.RENTED }]);
      await expect(build().exchange('c-1', 'd-1', request, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(contracts.releaseRow).not.toHaveBeenCalled();
    });

    it('refuses to swap out a provisioned unit', async () => {
      devices.provisioning.mockResolvedValue([{ ...unit, keyVersion: 2 }]);
      const error = await build()
        .exchange('c-1', 'd-1', request, STAFF, AT)
        .then(
          () => new Error('did not throw'),
          (caught: unknown) => caught as Error,
        );
      expect(error).toMatchObject({ errorCode: ErrorCode.DEVICE_PROVISIONED });
      expect(error.message).toContain('TL-d-1');
      expect(devices.takeForReplacement).not.toHaveBeenCalled();
    });

    it('refuses a replacement unit the platform does not know', async () => {
      await expect(
        build().exchange('c-1', 'd-1', { ...request, replacementDeviceId: 'd-x' }, STAFF, AT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.DEVICE_NOT_AVAILABLE });
    });

    it('refuses a docked unit that is not the replacement named', async () => {
      await expect(
        build().exchange('c-1', 'd-1', { ...request, nodeNum: 275612 }, STAFF, AT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NODE_MISMATCH });
      expect(devices.takeForReplacement).not.toHaveBeenCalled();
    });

    it('refuses when the version bump loses the race, after the units moved', async () => {
      contracts.bumpVersion.mockResolvedValue(false);
      await expect(build().exchange('c-1', 'd-1', request, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      expect(auditOf('contract.deviceExchanged')).toBeUndefined();
    });

    it('swaps the units, bumps the version and audits the exchange', async () => {
      const result = await build().exchange('c-1', 'd-1', request, STAFF, AT);
      expect(result).toEqual({
        released: { deviceId: 'd-1', assetTag: 'TL-d-1', status: 'AVAILABLE' },
        reserved: { id: 'd-9', assetTag: 'TL-d-9', nodeNum: 275700, status: 'RESERVED' },
        contractVersion: 4,
      });
      expect((devices.takeForReplacement.mock.calls[0] as unknown[]).slice(0, 3)).toEqual([
        'd-9',
        'v-3',
        AT,
      ]);
      expect(contracts.releaseRow).toHaveBeenCalledWith('cd-1', AT, TX);
      expect(contracts.insertContractDevices).toHaveBeenCalledWith(
        [{ contractId: 'c-1', deviceId: 'd-9' }],
        TX,
      );
      expect(contracts.bumpVersion).toHaveBeenCalledWith('c-1', 3, TX);
      expect(callArg(devices.release, 0, 3)).toMatchObject({ reason: 'EXCHANGED' });
      expect(auditOf('contract.deviceExchanged')).toEqual(
        expect.objectContaining({
          before: { deviceId: 'd-1' },
          after: { deviceId: 'd-9', nodeNum: 275700 },
        }),
      );
    });

    it('uses the current time when none is given', async () => {
      await build().exchange('c-1', 'd-1', request, STAFF);
      expect(callArg(devices.takeForReplacement, 0, 2)).toBeInstanceOf(Date);
    });
  });

  describe('preview', () => {
    it('answers not found for an unknown contract', async () => {
      contracts.detail.mockResolvedValue(null);
      await expect(build().preview('c-1', STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });

    it('refuses a contract that is not approved', async () => {
      contracts.detail.mockResolvedValue(detail({ status: ContractStatus.ACTIVE }));
      await expect(build().preview('c-1', STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('renders a PDF at the current time without counter readings', async () => {
      const pdf = await build().preview('c-1', STAFF);
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    });
  });

  describe('complete', () => {
    it('refuses a stale version and a contract that is not approved', async () => {
      await expect(
        build().complete('c-1', input({ expectedVersion: 2 }), STAFF, AT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
      contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ACTIVE }));
      await expect(build().complete('c-1', input(), STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('lists the units the counter checks do not cover', async () => {
      const error = await build()
        .complete(
          'c-1',
          input({ deviceChecks: [{ deviceId: 'd-1', batteryPct: 90, gpsFixOk: true }] }),
          STAFF,
          AT,
        )
        .then(
          () => new Error('did not throw'),
          (caught: unknown) => caught as Error,
        );
      expect(error).toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
      expect(error.message).toBe('deviceChecks must cover TL-d-2.');
      expect(contracts.markRowsHandedOver).not.toHaveBeenCalled();
    });

    it('answers not found when the contract detail has gone', async () => {
      contracts.detail.mockResolvedValue(null);
      await expect(build().complete('c-1', input(), STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(contracts.markRowsHandedOver).not.toHaveBeenCalled();
    });

    it('stamps the handover with the current time when none is given', async () => {
      const result = await build().complete('c-1', input(), STAFF);
      expect(result.handedOverAt).toBeInstanceOf(Date);
      expect(result.unitKeys.map((key) => key.deviceId)).toEqual(['d-1', 'd-2']);
    });
  });

  describe('note', () => {
    it('answers not found for another organization and for an unknown contract', async () => {
      contracts.noteOf.mockResolvedValue({
        organizationId: 'org-1',
        handoverNotePath: 'c-1.pdf',
        handoverNoteSha256: 'abc',
      });
      await expect(build().note('c-1', OTHER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      contracts.noteOf.mockResolvedValue(null);
      await expect(build().note('c-1', MEMBER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });

    it('refuses a handover with no stored path or no recorded hash', async () => {
      contracts.noteOf.mockResolvedValue({
        organizationId: 'org-1',
        handoverNotePath: null,
        handoverNoteSha256: 'abc',
      });
      await expect(build().note('c-1', STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.NOTE_NOT_SIGNED,
      });
      contracts.noteOf.mockResolvedValue({
        organizationId: 'org-1',
        handoverNotePath: 'c-1.pdf',
        handoverNoteSha256: null,
      });
      await expect(build().note('c-1', STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.NOTE_NOT_SIGNED,
      });
    });
  });

  describe('party and signer names', () => {
    it('labels an Admin and leaves the name empty when the directory has none', async () => {
      directory.namesOf.mockReturnValue(new Map());
      await expect(build().partyA(ADMIN)).resolves.toEqual({
        name: null,
        role: 'TrekLink Admin',
      });
    });

    it('labels Staff and leaves the name empty without a directory', async () => {
      await expect(build(false).partyA(STAFF)).resolves.toEqual({
        name: null,
        role: 'TrekLink Staff',
      });
    });

    it('prints the directory name of a Staff account', async () => {
      await expect(build().partyA(STAFF)).resolves.toEqual({
        name: 'Tran Thi Bich',
        role: 'TrekLink Staff',
      });
    });

    it('names the signer Org Manager when the directory is missing or has no entry', async () => {
      const signerName = (service: HandoverService, id: string) =>
        (service as unknown as { signerName(userId: string): Promise<string> }).signerName(id);
      await expect(signerName(build(false), 'u-mgr')).resolves.toBe('Org Manager');
      await expect(signerName(build(), 'u-unknown')).resolves.toBe('Org Manager');
      await expect(signerName(build(), 'u-mgr')).resolves.toBe('Lam Phi Long');
    });
  });

  describe('noteInput', () => {
    const options = { partyA: { name: 'Tran Thi Bich', role: 'TrekLink Staff' } };

    it('prints the condition of each unit from its counter check', async () => {
      const note = await build().noteInput(
        detail(),
        {
          ...options,
          checks: new Map([
            ['d-1', { deviceId: 'd-1', batteryPct: 90, gpsFixOk: false }],
            ['d-2', { deviceId: 'd-2', batteryPct: 10, gpsFixOk: true }],
          ]),
        },
        AT,
      );
      expect(note.devices.map((device) => device.condition)).toEqual([
        'Failed the GPS check',
        'Working order; battery below 20 %, accepted',
      ]);
    });

    it('prints the fallback condition for a unit with no check, or the one given', async () => {
      const plain = await build().noteInput(detail(), options, AT);
      expect(plain.devices[0].condition).toBe('To be checked at the counter');
      expect(plain.devices[0].batteryPct).toBeNull();
      expect(plain.devices[0].gpsFixOk).toBeNull();
      const given = await build().noteInput(
        detail(),
        { ...options, uncheckedCondition: 'Replacement, checked at the dock' },
        AT,
      );
      expect(given.devices[0].condition).toBe('Replacement, checked at the dock');
    });

    it('lets a counter check win over the unchecked condition', async () => {
      const note = await build().noteInput(
        detail(),
        {
          ...options,
          uncheckedCondition: 'Replacement, checked at the dock',
          checks: new Map([['d-1', { deviceId: 'd-1', batteryPct: 90, gpsFixOk: true }]]),
        },
        AT,
      );
      expect(note.devices[0].condition).toBe('Good working order');
      expect(note.devices[1].condition).toBe('Replacement, checked at the dock');
    });

    it('falls back to the ids when the units, variant and party are unknown', async () => {
      devices.handoverUnits.mockResolvedValue(new Map());
      devices.variants.mockResolvedValue([]);
      organizations.handoverParty.mockResolvedValue(null);
      const note = await build().noteInput(detail(), options, AT);
      expect(note.devices[0]).toMatchObject({
        assetTag: 'd-1',
        variantCode: 'v-3',
        nodeId: null,
        keyVersion: null,
        remainingValueVnd: null,
      });
      expect(note.partyB).toEqual({
        legalName: 'org-1',
        code: 'org-1',
        taxCode: null,
        address: null,
        manager: null,
      });
      expect(note.contract).toMatchObject({
        variantCode: 'v-3',
        masterContractRef: null,
        ndaSigned: false,
        softwareLicenceSigned: false,
      });
    });

    it('prints a monthly term fee and the holding fee as the first payment', async () => {
      const note = await build().noteInput(detail(), options, AT);
      expect(note.contract.fee).toEqual({
        label: 'Term fee, per month',
        amountVnd: termFeeVnd(450_000n, 2),
      });
      expect(note.contract.firstPayment.label).toBe('Holding fee');
      expect(note.contract.returnDue).toBeNull();
    });

    it('prices a day plan from the premium, the days and the quantity', async () => {
      const day = detail({
        planType: PlanType.DAY,
        dayPlanDays: 3,
        dayPremium: new Prisma.Decimal('1.5'),
      });
      const note = await build().noteInput(day, options, AT);
      const fee = dayPlanFeeVnd(450_000n, new Prisma.Decimal('1.5'), 3, 2);
      expect(note.contract.fee).toEqual({ label: 'Day-plan fee', amountVnd: fee });
      expect(note.contract.firstPayment).toEqual({ label: 'Day-plan fee', amountVnd: fee });
      expect(note.contract.planLabel).toBe('Day plan, 3 days');
      expect(note.contract.returnDue).toEqual(note.contract.termEnd);
    });

    it('treats a day plan with no premium or days as free of charge', async () => {
      const note = await build().noteInput(detail({ planType: PlanType.DAY }), options, AT);
      expect(note.contract.fee.amountVnd).toBe(0n);
    });

    it('keeps an explicit return due date over the term end', async () => {
      const due = new Date('2026-12-05T00:00:00.000Z');
      const note = await build().noteInput(
        detail({ planType: PlanType.DAY, dayPlanDays: 3, returnDueAt: due }),
        options,
        AT,
      );
      expect(note.contract.returnDue).toEqual(due);
    });

    it('numbers a replacement note with the tag of the unit that replaces', async () => {
      const note = await build().noteInput(
        detail(),
        {
          ...options,
          kind: 'REPLACEMENT',
          deviceIds: ['d-9'],
          replaces: { assetTag: 'TL-d-1', how: 'Failed the GPS check' },
        },
        AT,
      );
      expect(note.kind).toBe('REPLACEMENT');
      expect(note.noteNumber).toBe('RN-2026-0001-TL-d-9');
      expect(note.devices).toHaveLength(1);
      expect(note.replaces).toEqual({ assetTag: 'TL-d-1', how: 'Failed the GPS check' });
    });

    it('numbers a handover note by the contract code alone', async () => {
      const note = await build().noteInput(detail(), options, AT);
      expect(note.kind).toBe('HANDOVER');
      expect(note.noteNumber).toBe('HN-2026-0001');
      expect(note.devices).toHaveLength(2);
    });
  });

  describe('note storage', () => {
    it('writes under the directory and reads the same bytes back', async () => {
      const service = build();
      const name = await service.storeNote('c-1.pdf', Buffer.from('%PDF-test'));
      expect(name).toBe('c-1.pdf');
      expect((await readFile(join(dir, 'c-1.pdf'))).toString()).toBe('%PDF-test');
    });

    it('keeps the bytes in the database inside the caller transaction when configured', async () => {
      config.HANDOVER_NOTE_STORE = 'database';
      const pdf = Buffer.from('%PDF-db');
      await expect(build().storeNote('c-1.pdf', pdf, TX)).resolves.toBe('c-1.pdf');
      expect(contracts.saveNote).toHaveBeenCalledWith('c-1.pdf', pdf, TX);
    });

    it('resolves a relative storage directory against the working directory', async () => {
      const base = await mkdtemp(join(tmpdir(), 'handover-cwd-'));
      const cwd = jest.spyOn(process, 'cwd').mockReturnValue(base);
      const previous = dir;
      dir = 'notes';
      try {
        await build().storeNote('c-2.pdf', Buffer.from('%PDF-rel'));
        expect((await readFile(join(base, 'notes', 'c-2.pdf'))).toString()).toBe('%PDF-rel');
      } finally {
        dir = previous;
        cwd.mockRestore();
        await rm(base, { recursive: true, force: true });
      }
    });
  });
});
