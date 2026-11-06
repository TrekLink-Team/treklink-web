import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DeviceStatus, HubActionKind, HubActionOutcome, Prisma } from '@prisma/client';
import { Caller } from '../../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../../platform/audit/audit-record.event';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { DevicesRepository } from '../devices.repository';
import { toNodeId } from '../node-id';
import { CUSTODY_RESOLVER, CustodyResolver } from '../ports/custody-resolver.port';
import { DEVICE_CONTRACTS, DeviceContracts } from '../ports/device-contracts.port';
import { HubActionRepository, HubActionRow } from './hub-action.repository';

// devices api-design 33 and 34: what the hub reports.
export interface HubActionView {
  id: string;
  deviceId: string;
  action: HubActionKind;
  outcome: HubActionOutcome;
  nodeNum: number;
  deviceStatus: DeviceStatus;
  contractCode: string | null;
  firmwareFrom: string | null;
  firmwareTo: string | null;
  fullImage: boolean;
  failure: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface StartHubAction {
  action: HubActionKind;
  nodeNum: number;
  confirmAssetTag?: string;
  firmwareTo?: string;
  fullImage?: boolean;
}

export interface FinishHubAction {
  outcome: 'SUCCEEDED' | 'FAILED';
  failure?: string;
}

// The statuses whose units are on a contract in the field or about to be: the hub's dialog asks the user to type
// the asset tag, and the server refuses the start without it (design section 12.14, REQ-ERR-34).
const CONFIRMED_STATUSES: ReadonlySet<DeviceStatus> = new Set([
  DeviceStatus.RESERVED,
  DeviceStatus.RENTED,
]);

const STATUS_WORD: Partial<Record<DeviceStatus, string>> = {
  [DeviceStatus.RESERVED]: 'reserved',
  [DeviceStatus.RENTED]: 'rented',
};

export const toHubActionView = (row: HubActionRow): HubActionView => ({
  id: row.id,
  deviceId: row.deviceId,
  action: row.action,
  outcome: row.outcome,
  nodeNum: Number(row.nodeNum),
  deviceStatus: row.deviceStatus,
  contractCode: row.contractCode,
  firmwareFrom: row.firmwareFrom,
  firmwareTo: row.firmwareTo,
  fullImage: row.fullImage,
  failure: row.failure,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'The device was not found.');

// The device hub's actions on a docked unit (devices design section 12.14, leader UAT 2026-11-06): every action
// is allowed in every device status. The status only adds the typed confirmation for RESERVED and RENTED units.
// Each action is recorded twice: STARTED before the hub writes to the unit, SUCCEEDED or FAILED when it ends,
// each with its audit entry after commit.
@Injectable()
export class HubActionService {
  constructor(
    private readonly actions: HubActionRepository,
    private readonly devices: DevicesRepository,
    private readonly events: TransactionalEvents,
    @Inject(DEVICE_CONTRACTS) private readonly contracts: DeviceContracts,
    @Inject(CUSTODY_RESOLVER) private readonly custody: CustodyResolver,
  ) {}

  // devices api-design 33.
  start(
    deviceId: string,
    request: StartHubAction,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<HubActionView> {
    return this.events.transaction(async (tx) => {
      const unit = await this.actions.lockDevice(deviceId, tx);
      if (!unit) throw notFound();
      if (unit.nodeNum !== BigInt(request.nodeNum)) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.NODE_MISMATCH,
          `The docked unit is ${toNodeId(BigInt(request.nodeNum))}, not ${unit.assetTag}.`,
        );
      }
      if (request.action === HubActionKind.FIRMWARE_UPDATE && !request.firmwareTo?.trim()) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'firmwareTo is required.',
        );
      }
      const [contract] = await this.contracts.liveContractsOf([deviceId], tx);
      if (CONFIRMED_STATUSES.has(unit.status)) {
        const typed = request.confirmAssetTag?.trim().toUpperCase() ?? '';
        if (typed !== unit.assetTag.trim().toUpperCase()) {
          const on = contract ? ` on ${contract.code}` : '';
          throw new DomainException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.CONFIRMATION_REQUIRED,
            `Type ${unit.assetTag} to confirm: it is ${STATUS_WORD[unit.status]}${on}.`,
          );
        }
      }
      const firmware = request.action === HubActionKind.FIRMWARE_UPDATE;
      const row = await this.actions.insert(
        {
          deviceId,
          action: request.action,
          nodeNum: unit.nodeNum,
          deviceStatus: unit.status,
          contractId: contract?.contractId ?? null,
          contractCode: contract?.code ?? null,
          firmwareFrom: firmware ? unit.firmwareVersion : null,
          firmwareTo: firmware ? request.firmwareTo!.trim() : null,
          fullImage: firmware ? request.fullImage === true : false,
          actorId: actor.id,
          startedAt: at,
        },
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: null,
        action: 'device.hub_action.started',
        subjectType: 'Device',
        subjectId: deviceId,
        after: {
          hubActionId: row.id,
          action: row.action,
          nodeNum: Number(row.nodeNum),
          deviceStatus: row.deviceStatus,
          contractCode: row.contractCode,
          organizationId: contract?.organizationId ?? null,
          firmwareFrom: row.firmwareFrom,
          firmwareTo: row.firmwareTo,
          fullImage: row.fullImage,
        },
      } satisfies AuditRecordEvent);
      return toHubActionView(row);
    });
  }

  // devices api-design 34.
  finish(
    deviceId: string,
    actionId: string,
    request: FinishHubAction,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<HubActionView & { returnReset: boolean }> {
    return this.events.transaction(async (tx) => {
      const unit = await this.actions.lockDevice(deviceId, tx);
      if (!unit) throw notFound();
      const row = await this.actions.find(actionId, deviceId, tx);
      if (!row) {
        throw new DomainException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'The hub action was not found.',
        );
      }
      if (row.outcome !== HubActionOutcome.STARTED) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.HUB_ACTION_FINISHED,
          'This hub action is already finished.',
        );
      }
      const succeeded = request.outcome === 'SUCCEEDED';
      const failure = succeeded ? null : (request.failure?.trim() || 'Not reported.').slice(0, 300);
      const finished = await this.actions.finish(
        row.id,
        succeeded ? HubActionOutcome.SUCCEEDED : HubActionOutcome.FAILED,
        failure,
        at,
        tx,
      );
      const changed = succeeded
        ? await this.applyEffect(row, unit, actor, at, tx)
        : { returnReset: false };
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: null,
        action: 'device.hub_action.finished',
        subjectType: 'Device',
        subjectId: deviceId,
        before: {
          keyVersion: unit.keyVersion,
          keyOrganizationId: unit.keyOrganizationId,
          provisionedAt: unit.provisionedAt,
          firmwareVersion: unit.firmwareVersion,
        },
        after: {
          hubActionId: row.id,
          action: row.action,
          outcome: finished.outcome,
          failure,
          ...changed,
        },
      } satisfies AuditRecordEvent);
      return { ...toHubActionView(finished), returnReset: changed.returnReset };
    });
  }

  // The rows of one device for its history (design section 3).
  ofDevice(deviceId: string): Promise<HubActionRow[]> {
    return this.actions.ofDevice(deviceId);
  }

  // What a SUCCEEDED action changes on the device record (api-design 34).
  private async applyEffect(
    row: HubActionRow,
    unit: { id: string; status: DeviceStatus; statusChangedAt: Date; keyVersion: number | null },
    actor: Caller,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{ returnReset: boolean; keyCleared?: boolean; firmwareVersion?: string }> {
    if (row.action === HubActionKind.FIRMWARE_UPDATE && row.firmwareTo) {
      await this.actions.setFirmware(unit.id, row.firmwareTo, tx);
      return { returnReset: false, firmwareVersion: row.firmwareTo };
    }
    if (row.action === HubActionKind.FACTORY_RESET && (await this.returnResetDue(unit, at, tx))) {
      // The return loop's reset (api-design 10): the wipe the hub just read back covers its three steps, and the
      // insert clears the key as api-design 10 does.
      await this.devices.insertReset(
        unit.id,
        { keyRemoved: true, nodeDbCleared: true, ownerCleared: true },
        actor.id,
        at,
        tx,
      );
      // insertReset clears the key; the provisioning time goes too, so the record says what the unit carries.
      await this.actions.clearKey(unit.id, tx);
      return { returnReset: true, keyCleared: true };
    }
    if (
      row.action === HubActionKind.FACTORY_RESET ||
      row.action === HubActionKind.RESTORE_DEFAULTS
    ) {
      await this.actions.clearKey(unit.id, tx);
      return { returnReset: false, keyCleared: true };
    }
    return { returnReset: false };
  }

  // A RETURNED unit out of custody and not yet reset since it became RETURNED (the api-design 10 guards).
  private async returnResetDue(
    unit: { id: string; status: DeviceStatus; statusChangedAt: Date },
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (unit.status !== DeviceStatus.RETURNED) return false;
    if (await this.custody.custodyAt(unit.id, at, tx)) return false;
    const last = await this.devices.lastResetAt(unit.id, tx);
    return !last || last < unit.statusChangedAt;
  }
}
