import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractStatus, DeviceStatus, PlanType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import {
  BalanceService,
  dayPlanFeeVnd,
  holdingFeeVnd,
  PaymentsService,
  PricingService,
  termFeeVnd,
} from '../billing';
import { DevicesService, DeviceTag, ProvisionedDevice } from '../devices';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../platform/ports/account-directory.port';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { firstTerm } from './contract-terms';
import {
  ContractDetailRow,
  ContractRow,
  ContractsRepository,
  CODE_ZONE_OFFSET_MS,
} from './contracts.repository';
import {
  HandoverNoteInput,
  NoteDevice,
  NotePartyA,
  renderHandoverNote,
} from './handover-note.renderer';

export const DEVICE_HANDED_OVER = 'device.handedOver';

export interface DeviceHandedOverEvent {
  deviceId: string;
  contractId: string;
  organizationId: string;
  at: Date;
}

export interface DeviceCheck {
  deviceId: string;
  batteryPct: number;
  gpsFixOk: boolean;
}

export interface HandoverInput {
  signedByUserId: string;
  identityChecked: string;
  signaturePng: string;
  deviceChecks: DeviceCheck[];
  acknowledgeLowBattery: boolean;
  expectedVersion: number;
}

export interface Swapped {
  released: { deviceId: string; assetTag: string | null; status: 'MAINTENANCE' };
  reserved: DeviceTag & { status: 'RESERVED' };
}

// api-design 19: the unit with its record cleared, and the contract version the page holds next.
export interface ProvisioningUndone {
  device: ProvisionedDevice;
  contractVersion: number;
}

export interface StoredNote {
  pdfBase64: string | null;
  sha256: string | null;
  integrity: 'OK' | 'MISMATCH' | 'MISSING';
}

const conflict = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.CONFLICT, code, message);

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Contract not found.');

const notApproved = (status: ContractStatus) =>
  conflict(ErrorCode.INVALID_STATE_TRANSITION, `This cannot be done while it is ${status}.`);

// The calendar day of `at` in UTC+7, as yyyy-mm-dd, the calendar of the requested start date.
const localDay = (at: Date): string =>
  new Date(at.getTime() + CODE_ZONE_OFFSET_MS).toISOString().slice(0, 10);

// The eight bytes every PNG starts with; the signature pad sends a PNG data URL.
export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

const planLabel = (contract: ContractRow) =>
  contract.planType === PlanType.DAY ? `Day plan, ${contract.dayPlanDays} days` : 'Monthly';

// The note number is the contract code with the note's prefix: HN for the handover, RN plus the
// replacement's asset tag for a replacement (design §4.1). One handover per contract keeps it unique.
export const noteNumber = (contractCode: string, replacementTag?: string): string => {
  const serial = contractCode.replace(/^RC-/, '');
  return replacementTag ? `RN-${serial}-${replacementTag}` : `HN-${serial}`;
};

// The condition column of the note from the counter check (design §4.1); a unit not checked yet
// says so.
const conditionOf = (check: DeviceCheck | undefined, minBattery: number): string => {
  if (!check) return 'To be checked at the counter';
  if (!check.gpsFixOk) return 'Failed the GPS check';
  return check.batteryPct < minBattery
    ? `Working order; battery below ${minBattery} %, accepted`
    : 'Good working order';
};

// What the note needs beyond the contract and its units: who signs and how each unit was found.
export interface NoteOptions {
  kind?: 'HANDOVER' | 'REPLACEMENT';
  partyA: NotePartyA;
  // The units to list; the contract's live rows when absent.
  deviceIds?: string[];
  manager?: { fullName: string; identityDocument: string };
  signaturePng?: Buffer;
  checks?: ReadonlyMap<string, DeviceCheck>;
  // A unit's condition when it has no counter check (a replacement, for example).
  uncheckedCondition?: string;
  replaces?: { assetTag: string; how: string };
}

// The counter handover (rentals tasks 2.3 and 2.4, UC-14, UC-20, UC-21, design §4): provisioning
// records, swaps of failing units, the preview note, and the signed handover that moves the devices
// to RENTED and the contract to ACTIVE in one transaction (MSG06).
@Injectable()
export class HandoverService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly lifecycle: ContractLifecycleService,
    private readonly devices: DevicesService,
    private readonly organizations: OrganizationsService,
    private readonly balances: BalanceService,
    private readonly payments: PaymentsService,
    private readonly pricing: PricingService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  // Staff record that the organization's channel key was written to a reserved unit (api-design
  // 09, D-021): only the key version is kept. A version other than the organization's current one
  // is 409 KEY_VERSION_MISMATCH; a unit not on the contract 409 DEVICE_NOT_ON_CONTRACT (MSG12).
  async provision(
    id: string,
    deviceId: string,
    keyVersion: number,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<ProvisionedDevice> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (contract.status !== ContractStatus.APPROVED) throw notApproved(contract.status);
      await this.rowOf(contract, deviceId, tx);
      const current = await this.organizations.channelKeyVersion(contract.organizationId, tx);
      if (keyVersion !== current) {
        throw conflict(
          ErrorCode.KEY_VERSION_MISMATCH,
          `The organization's channel key is at version ${current}; write that version to the device.`,
        );
      }
      return this.devices.recordProvisioning(
        { deviceId, organizationId: contract.organizationId, keyVersion, actorId: actor.id },
        at,
        tx,
      );
    });
  }

  // Staff undo a provisioning recorded on the wrong unit, before the handover (api-design 19,
  // REQ-EVT-16, REQ-ERR-10). The checks run in the order of REQ-ERR-10; the contract version increases
  // with the device's record cleared, and the append-only DeviceProvisioning row stays.
  async undoProvisioning(
    id: string,
    deviceId: string,
    expectedVersion: number,
    actor: Caller,
  ): Promise<ProvisioningUndone> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (contract.version !== expectedVersion) {
        throw conflict(
          ErrorCode.STALE_VERSION,
          'Someone else changed this. Reload to see the latest.',
        );
      }
      if (contract.status !== ContractStatus.APPROVED) throw notApproved(contract.status);
      const row = await this.rowOf(contract, deviceId, tx);
      const [unit] = await this.devices.provisioning([deviceId], tx);
      if (row.handedOverAt || !unit || unit.status !== DeviceStatus.RESERVED) {
        throw conflict(
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${unit?.status ?? 'handed over'}.`,
        );
      }
      if (unit.keyOrganizationId !== contract.organizationId || unit.keyVersion === null) {
        throw conflict(
          ErrorCode.DEVICE_NOT_PROVISIONED,
          `${unit.assetTag} has no provisioning to undo.`,
        );
      }
      if (!(await this.contracts.bumpVersion(id, expectedVersion, tx))) {
        throw conflict(
          ErrorCode.STALE_VERSION,
          'Someone else changed this. Reload to see the latest.',
        );
      }
      const cleared = await this.devices.clearProvisioning(deviceId, tx);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: contract.organizationId,
        action: 'contract.provisioningUndone',
        subjectType: 'RentalContract',
        subjectId: id,
        before: {
          deviceId,
          keyVersion: unit.keyVersion,
          provisionedAt: unit.provisionedAt?.toISOString() ?? null,
        },
        after: { deviceId, keyVersion: null },
      } satisfies AuditRecordEvent);
      return { device: cleared, contractVersion: expectedVersion + 1 };
    });
  }

  // A reserved unit that fails its counter check goes to MAINTENANCE and another AVAILABLE unit of
  // the variant takes its place, in one transaction (api-design 07, E01-5); with no spare unit the
  // swap is 409 INSUFFICIENT_DEVICES and nothing changes.
  async swap(
    id: string,
    deviceId: string,
    reason: string,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<Swapped> {
    const variants = await this.devices.variants(false);
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (contract.status !== ContractStatus.APPROVED) throw notApproved(contract.status);
      const row = await this.rowOf(contract, deviceId, tx);
      const code =
        variants.find((variant) => variant.id === contract.hardwareVariantId)?.code ??
        contract.hardwareVariantId;
      await this.contracts.releaseRow(row.id, at, tx);
      const move = { contractId: id, contractCode: contract.code, actorId: actor.id };
      await this.devices.failHandoverCheck(deviceId, reason, actor.id, at, tx, move);
      const [replacement] = await this.devices.reserve(
        { id: contract.hardwareVariantId, code },
        1,
        at,
        tx,
        move,
      );
      await this.contracts.insertContractDevices(
        [{ contractId: id, deviceId: replacement.id }],
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: contract.organizationId,
        action: 'contract.deviceSwapped',
        subjectType: 'RentalContract',
        subjectId: id,
        before: { deviceId },
        after: { deviceId: replacement.id, reason },
      } satisfies AuditRecordEvent);
      const tags = await this.devices.assetTags([deviceId], tx);
      return {
        released: { deviceId, assetTag: tags.get(deviceId) ?? null, status: 'MAINTENANCE' },
        reserved: { ...replacement, status: 'RESERVED' },
      };
    });
  }

  // The unsigned note Staff show the Manager before signing (api-design 08), with the caller as
  // Party A. Counter readings, when a caller has them, fill the battery, GPS and condition columns.
  async preview(
    id: string,
    caller: Caller,
    at: Date = new Date(),
    checks: readonly DeviceCheck[] = [],
  ): Promise<Buffer> {
    const contract = await this.contracts.detail(id);
    if (!contract) throw notFound();
    if (contract.status !== ContractStatus.APPROVED) throw notApproved(contract.status);
    return renderHandoverNote(
      await this.noteInput(
        contract,
        {
          partyA: await this.partyA(caller),
          checks: new Map(checks.map((check) => [check.deviceId, check])),
        },
        at,
      ),
    );
  }

  // The signed handover (api-design 10, FR-CON-05, FR-CON-06, BR-09). Refused before the start date
  // (BEFORE_START_DATE), without the first payment (FIRST_PAYMENT_MISSING), with a signer who is not
  // a live Manager of the organization (400 SIGNER_NOT_MANAGER), without a signature
  // (NOTE_NOT_SIGNED), with a unit not provisioned at the current key version
  // (DEVICE_NOT_PROVISIONED), with a failed GPS check (DEVICE_CHECK_FAILED) or a battery below
  // `devices.handoverMinBatteryPct` that was not acknowledged (LOW_BATTERY).
  async complete(
    id: string,
    input: HandoverInput,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<ContractRow> {
    const minBattery = await this.parameters.get('devices.handoverMinBatteryPct');
    const signer = await this.signerName(input.signedByUserId);
    const partyA = await this.partyA(actor);
    const signature = Buffer.from(
      input.signaturePng.replace(/^data:image\/png;base64,/, ''),
      'base64',
    );

    const handed = await this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (contract.version !== input.expectedVersion) {
        throw conflict(
          ErrorCode.STALE_VERSION,
          'Someone else changed this. Reload to see the latest.',
        );
      }
      if (contract.status !== ContractStatus.APPROVED) throw notApproved(contract.status);
      if (localDay(at) < contract.requestedStartDate.toISOString().slice(0, 10)) {
        throw conflict(ErrorCode.BEFORE_START_DATE, 'The requested start date has not come yet.');
      }
      if (!(await this.balances.firstPaymentConfirmed(id, tx))) {
        throw conflict(ErrorCode.FIRST_PAYMENT_MISSING, 'The first payment is not recorded yet.');
      }
      if (
        !(await this.organizations.isActiveManager(
          contract.organizationId,
          input.signedByUserId,
          tx,
        ))
      ) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.SIGNER_NOT_MANAGER,
          'The signer must be an active Manager of the organization.',
        );
      }
      if (!signature.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'signaturePng must be a PNG image.',
        );
      }

      const rows = await this.contracts.liveRows(id, tx);
      const units = await this.devices.provisioning(
        rows.map((row) => row.deviceId),
        tx,
      );
      const keyVersion = await this.organizations.channelKeyVersion(contract.organizationId, tx);
      const unprovisioned = units.filter(
        (unit) =>
          unit.keyOrganizationId !== contract.organizationId || unit.keyVersion !== keyVersion,
      );
      if (unprovisioned.length > 0) {
        throw conflict(
          ErrorCode.DEVICE_NOT_PROVISIONED,
          `Provision this device with the organization's key before handover: ${unprovisioned.map((unit) => unit.assetTag).join(', ')}.`,
        );
      }
      const checkOf = new Map(input.deviceChecks.map((check) => [check.deviceId, check]));
      const unchecked = units.filter((unit) => !checkOf.has(unit.id));
      if (unchecked.length > 0) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          `deviceChecks must cover ${unchecked.map((unit) => unit.assetTag).join(', ')}.`,
        );
      }
      const failed = units.filter((unit) => !checkOf.get(unit.id)?.gpsFixOk);
      if (failed.length > 0) {
        throw conflict(
          ErrorCode.DEVICE_CHECK_FAILED,
          `${failed.map((unit) => unit.assetTag).join(', ')} failed the GPS check; swap it first.`,
        );
      }
      const low = units.filter((unit) => (checkOf.get(unit.id)?.batteryPct ?? 0) < minBattery);
      if (low.length > 0 && !input.acknowledgeLowBattery) {
        throw conflict(
          ErrorCode.LOW_BATTERY,
          `Battery below ${minBattery} % on ${low.map((unit) => unit.assetTag).join(', ')}. Charge before use, or acknowledge.`,
        );
      }

      const detail = await this.contracts.detail(id, tx);
      if (!detail) throw notFound();
      const pdf = await renderHandoverNote(
        await this.noteInput(
          detail,
          {
            partyA,
            manager: { fullName: signer, identityDocument: input.identityChecked },
            signaturePng: signature,
            checks: checkOf,
          },
          at,
          tx,
        ),
      );
      const path = await this.store(id, pdf, tx);

      await this.contracts.markRowsHandedOver(id, at, tx);
      await this.devices.markRented(
        rows.map((row) => row.deviceId),
        at,
        tx,
        { contractId: id, contractCode: contract.code, actorId: actor.id },
      );
      const active = await this.lifecycle.apply(
        id,
        ContractStatus.APPROVED,
        ContractStatus.ACTIVE,
        'HANDED_OVER',
        actor,
        tx,
      );
      await this.contracts.recordHandover(
        id,
        {
          handedOverAt: at,
          handedOverById: actor.id,
          identityChecked: input.identityChecked,
          handoverNotePath: path,
          handoverNoteSha256: sha256(pdf),
        },
        tx,
      );
      for (const row of rows) {
        this.events.emitAfterCommit(DEVICE_HANDED_OVER, {
          deviceId: row.deviceId,
          contractId: id,
          organizationId: contract.organizationId,
          at,
        } satisfies DeviceHandedOverEvent);
      }
      return { ...active, handedOverAt: at };
    });
    return handed;
  }

  // The stored note with its integrity against the SHA-256 recorded at signing (api-design 11):
  // a member reads its own organization's note, Staff any; another organization's is 404.
  async note(id: string, caller: Caller): Promise<StoredNote> {
    const row = await this.contracts.noteOf(id);
    if (!row || (caller.organizationId !== null && caller.organizationId !== row.organizationId)) {
      throw notFound();
    }
    if (!row.handoverNotePath || !row.handoverNoteSha256) {
      throw conflict(ErrorCode.NOTE_NOT_SIGNED, 'The handover is not complete yet.');
    }
    const pdf = await this.readNote(row.handoverNotePath);
    if (!pdf) return { pdfBase64: null, sha256: row.handoverNoteSha256, integrity: 'MISSING' };
    return {
      pdfBase64: pdf.toString('base64'),
      sha256: row.handoverNoteSha256,
      integrity: sha256(pdf) === row.handoverNoteSha256 ? 'OK' : 'MISMATCH',
    };
  }

  private async rowOf(contract: ContractRow, deviceId: string, tx: Prisma.TransactionClient) {
    const row = await this.contracts.findDeviceRow(contract.id, deviceId, tx);
    if (!row) {
      throw conflict(
        ErrorCode.DEVICE_NOT_ON_CONTRACT,
        `This device does not belong to contract ${contract.code}.`,
      );
    }
    return row;
  }

  private async signerName(userId: string): Promise<string> {
    const names = this.directory
      ? await this.directory.namesOf([userId])
      : new Map<string, string>();
    return names.get(userId) ?? 'Org Manager';
  }

  // Party A of a note: the Staff or Admin account at the counter, by name from the account directory.
  // Read outside any transaction, as the directory has no transaction client.
  async partyA(caller: Caller): Promise<NotePartyA> {
    const names = this.directory
      ? await this.directory.namesOf([caller.id])
      : new Map<string, string>();
    return {
      name: names.get(caller.id) ?? null,
      role: caller.roles.includes('ADMIN') ? 'TrekLink Admin' : 'TrekLink Staff',
    };
  }

  // Everything a handover or replacement note prints (design §4.1), from configuration, the business
  // parameters and the exported reads of organizations, devices and billing. Every read joins the
  // caller's transaction when there is one: a read on another connection would not see the rows that
  // transaction has written, and waits on it on a single-session Postgres such as PGlite.
  async noteInput(
    contract: ContractDetailRow,
    options: NoteOptions,
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<HandoverNoteInput> {
    const ids = options.deviceIds ?? contract.devices.map((device) => device.deviceId);
    // One read at a time: a transaction client runs its queries on one connection anyway.
    const variants = await this.devices.variants(false, tx);
    const party = await this.organizations.handoverParty(contract.organizationId, tx);
    const units = await this.devices.handoverUnits(ids, at, tx);
    const payments = await this.payments.receivedOfContract(contract.id, tx);
    const firstPaymentConfirmed = await this.balances.firstPaymentConfirmed(contract.id, tx);
    const damageRates = await this.pricing.rateTableFor(contract.hardwareVariantId, tx);
    const minBattery = await this.parameters.get('devices.handoverMinBatteryPct', tx);
    const lateFee = await this.parameters.get('billing.lateFeePerDevicePerDayVnd', tx);
    const returnGraceHours = await this.parameters.get('rentals.returnGraceHours', tx);
    const defaultAfterDays = await this.parameters.get('rentals.defaultAfterDays', tx);
    const lossSearchDays = await this.parameters.get('devices.lossSearchDays', tx);
    const variantCode =
      variants.find((variant) => variant.id === contract.hardwareVariantId)?.code ??
      contract.hardwareVariantId;
    const term = contract.terms[0] ?? firstTerm(contract);
    const isDay = contract.planType === PlanType.DAY;
    const price = contract.monthlyUnitPriceVnd;
    const dayPlanFee = isDay
      ? dayPlanFeeVnd(price, contract.dayPremium ?? 0, contract.dayPlanDays ?? 0, contract.quantity)
      : 0n;
    const replacementTag = options.kind === 'REPLACEMENT' ? units.get(ids[0])?.assetTag : undefined;

    const devices: NoteDevice[] = ids.map((deviceId) => {
      const unit = units.get(deviceId);
      const check = options.checks?.get(deviceId);
      return {
        assetTag: unit?.assetTag ?? deviceId,
        variantCode: unit?.variantCode ?? variantCode,
        nodeId: unit?.nodeId ?? null,
        keyVersion: unit?.keyVersion ?? null,
        batteryPct: check?.batteryPct ?? null,
        gpsFixOk: check?.gpsFixOk ?? null,
        condition:
          !check && options.uncheckedCondition
            ? options.uncheckedCondition
            : conditionOf(check, minBattery),
        remainingValueVnd: unit?.remainingValueVnd ?? null,
      };
    });

    return {
      kind: options.kind ?? 'HANDOVER',
      noteNumber: noteNumber(contract.code, replacementTag),
      at,
      place: this.config.get('HANDOVER_PLACE', { infer: true }),
      issuer: {
        legalName: this.config.get('COMPANY_LEGAL_NAME', { infer: true }),
        address: this.config.get('COMPANY_ADDRESS', { infer: true }),
        taxCode: this.config.get('COMPANY_TAX_CODE', { infer: true }),
        hotline: this.config.get('COMPANY_HOTLINE', { infer: true }),
      },
      partyA: options.partyA,
      partyB: {
        legalName: party?.legalName ?? contract.organizationId,
        code: party?.code ?? contract.organizationId,
        taxCode: party?.taxCode ?? null,
        address: party?.address ?? null,
        manager: options.manager ?? null,
      },
      contract: {
        code: contract.code,
        planLabel: planLabel(contract),
        variantCode,
        quantity: contract.quantity,
        termStart: term.startsAt,
        termEnd: term.endsAt,
        returnDue: contract.returnDueAt ?? (isDay ? term.endsAt : null),
        monthlyUnitPriceVnd: price,
        fee: isDay
          ? { label: 'Day-plan fee', amountVnd: dayPlanFee }
          : { label: 'Term fee, per month', amountVnd: termFeeVnd(price, contract.quantity) },
        firstPayment: isDay
          ? { label: 'Day-plan fee', amountVnd: dayPlanFee }
          : {
              label: 'Holding fee',
              amountVnd: holdingFeeVnd(price, contract.quantity, contract.holdingFeeRatio),
            },
        masterContractRef: party?.masterContractRef ?? null,
        ndaSigned: party?.ndaSigned ?? false,
        softwareLicenceSigned: party?.softwareLicenceSigned ?? false,
      },
      devices,
      payments: payments.map((payment) => ({
        invoiceNumber: payment.invoiceNumber,
        amountVnd: payment.amountVnd,
        method: payment.method,
        reference: payment.reference,
        receivedAt: payment.confirmedAt,
      })),
      firstPaymentConfirmed,
      terms: {
        lateFeePerDevicePerDayVnd: lateFee,
        returnGraceHours,
        defaultAfterDays,
        lossSearchDays,
        damageRates,
      },
      signaturePng: options.signaturePng,
      replaces: options.replaces,
    };
  }

  // Stores the signed note and returns the name recorded on the contract.
  private store(contractId: string, pdf: Buffer, tx: Prisma.TransactionClient): Promise<string> {
    return this.storeNote(`${contractId}.pdf`, pdf, tx);
  }

  // Stores a signed note by name; the replacement note of rentals 4.3 uses it too. HANDOVER_NOTE_STORE
  // picks where (design §4.1, D-090 amendment): `file` (the default, every local host) writes under
  // HANDOVER_NOTE_STORAGE_DIR; `database` keeps the exact bytes in `handover_notes`, inside the caller's
  // transaction, for a host whose disk does not outlive one request (the Vercel production).
  async storeNote(name: string, pdf: Buffer, tx?: Prisma.TransactionClient): Promise<string> {
    if (this.noteStore() === 'database') {
      await this.contracts.saveNote(name, pdf, tx);
      return name;
    }
    const dir = this.absolute('');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), pdf);
    return name;
  }

  // The stored bytes of a note by name, or null when the store has none.
  private async readNote(name: string): Promise<Buffer | null> {
    if (this.noteStore() === 'database') return this.contracts.readNote(name);
    try {
      return await readFile(this.absolute(name));
    } catch {
      return null;
    }
  }

  private noteStore(): 'file' | 'database' {
    return this.config.get('HANDOVER_NOTE_STORE', { infer: true }) === 'database'
      ? 'database'
      : 'file';
  }

  private absolute(name: string): string {
    const dir = this.config.get('HANDOVER_NOTE_STORAGE_DIR', { infer: true });
    return join(isAbsolute(dir) ? dir : resolve(process.cwd(), dir), name);
  }
}
