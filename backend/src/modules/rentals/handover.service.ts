import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService } from '../billing';
import { DevicesService, DeviceTag, ProvisionedDevice } from '../devices';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../platform/ports/account-directory.port';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository, CODE_ZONE_OFFSET_MS } from './contracts.repository';
import { HandoverNoteInput, renderHandoverNote } from './handover-note.renderer';

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
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

const planLabel = (contract: ContractRow) =>
  contract.planType === PlanType.DAY ? `Day plan, ${contract.dayPlanDays} days` : 'Monthly';

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
      await this.devices.failHandoverCheck(deviceId, at, tx);
      const [replacement] = await this.devices.reserve(
        { id: contract.hardwareVariantId, code },
        1,
        at,
        tx,
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

  // The unsigned note Staff show the Manager before signing (api-design 08).
  async preview(id: string, at: Date = new Date()): Promise<Buffer> {
    const contract = await this.contracts.detail(id);
    if (!contract) throw notFound();
    if (contract.status !== ContractStatus.APPROVED) throw notApproved(contract.status);
    return renderHandoverNote(
      await this.noteInput(contract, null, await this.devices.variants(false), at),
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
    const variants = await this.devices.variants(false);
    const signer = await this.signerName(input.signedByUserId);
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
            signer: { fullName: signer, identityChecked: input.identityChecked },
            signaturePng: signature,
            checks: checkOf,
          },
          variants,
          at,
          tx,
        ),
      );
      const path = await this.store(id, pdf);

      await this.contracts.markRowsHandedOver(id, at, tx);
      await this.devices.markRented(
        rows.map((row) => row.deviceId),
        at,
        tx,
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
    try {
      const pdf = await readFile(this.absolute(row.handoverNotePath));
      return {
        pdfBase64: pdf.toString('base64'),
        sha256: row.handoverNoteSha256,
        integrity: sha256(pdf) === row.handoverNoteSha256 ? 'OK' : 'MISMATCH',
      };
    } catch {
      return { pdfBase64: null, sha256: row.handoverNoteSha256, integrity: 'MISSING' };
    }
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

  private async noteInput(
    contract: NonNullable<Awaited<ReturnType<ContractsRepository['detail']>>>,
    signed: {
      signer: { fullName: string; identityChecked: string };
      signaturePng: Buffer;
      checks: Map<string, DeviceCheck>;
    } | null,
    variants: { id: string; code: string }[],
    at: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<HandoverNoteInput> {
    // Every read joins the handover transaction when there is one: a read on another connection
    // would not see the rows this transaction has written, and waits on it on a single-session
    // Postgres such as PGlite.
    const ids = contract.devices.map((device) => device.deviceId);
    const tags = await this.devices.assetTags(ids, tx);
    const labels = await this.organizations.labelsOf([contract.organizationId], tx);
    const firstPaymentConfirmed = await this.balances.firstPaymentConfirmed(contract.id, tx);
    const organization = labels.get(contract.organizationId);
    return {
      contractCode: contract.code,
      organization: {
        code: organization?.code ?? contract.organizationId,
        legalName: organization?.legalName ?? '',
      },
      planLabel: planLabel(contract),
      variantCode:
        variants.find((variant) => variant.id === contract.hardwareVariantId)?.code ??
        contract.hardwareVariantId,
      requestedStartDate: contract.requestedStartDate.toISOString().slice(0, 10),
      devices: ids.map((deviceId) => {
        const check = signed?.checks.get(deviceId);
        return {
          assetTag: tags.get(deviceId) ?? deviceId,
          batteryPct: check?.batteryPct ?? null,
          gpsFixOk: check?.gpsFixOk ?? null,
        };
      }),
      firstPaymentConfirmed,
      signer: signed?.signer,
      signaturePng: signed?.signaturePng,
      at,
    };
  }

  // Writes the signed note under HANDOVER_NOTE_STORAGE_DIR and returns the path stored on the
  // contract, relative to that directory.
  private async store(contractId: string, pdf: Buffer): Promise<string> {
    const name = `${contractId}.pdf`;
    const dir = this.absolute('');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), pdf);
    return name;
  }

  private absolute(name: string): string {
    const dir = this.config.get('HANDOVER_NOTE_STORAGE_DIR', { infer: true });
    return join(isAbsolute(dir) ? dir : resolve(process.cwd(), dir), name);
  }
}
