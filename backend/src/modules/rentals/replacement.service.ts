import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractsRepository } from './contracts.repository';
import { renderHandoverNote } from './handover-note.renderer';
import {
  DEVICE_HANDED_OVER,
  DeviceHandedOverEvent,
  HandoverService,
  PNG_MAGIC,
  sha256,
} from './handover.service';
import { DEVICE_CHECKED_IN, DeviceCheckedInEvent } from './return.service';

export interface ReplacementInput {
  replacementDeviceId: string;
  keyVersion: number;
  signatureImage: string;
  faultyPresent: boolean;
}

export interface Replaced {
  replacedDeviceId: string;
  replacementDeviceId: string;
  contractDeviceId: string;
  replacesId: string;
  noteSha256: string;
}

const conflict = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.CONFLICT, code, message);

// The states a running contract replaces a unit in (rentals api-design 15).
const RUNNING: ContractStatus[] = [ContractStatus.ACTIVE, ContractStatus.ENDING];

// Replacement on a running contract (rentals task 4.3, UC-61, FR-CON-15, BR-05, BR-41, api-design
// 15): the faulty unit is checked in when it is at the counter, or needs an open loss case when it is
// not; an AVAILABLE unit of the contract's variant is provisioned at the organization's current key
// version, signed for on screen, and gets its own custody interval. Plan, variant and quantity stay
// unchanged. One transaction.
@Injectable()
export class ReplacementService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly devices: DevicesService,
    private readonly organizations: OrganizationsService,
    private readonly handover: HandoverService,
    private readonly events: TransactionalEvents,
  ) {}

  async replace(
    id: string,
    deviceId: string,
    input: ReplacementInput,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<Replaced> {
    const signature = Buffer.from(
      input.signatureImage.replace(/^data:image\/png;base64,/, ''),
      'base64',
    );
    if (!signature.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'signatureImage must be a PNG image.',
      );
    }
    const partyA = await this.handover.partyA(actor);

    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      const move = { contractId: id, contractCode: contract.code, actorId: actor.id };
      const old = (await this.contracts.rowsOut(id, tx)).find((row) => row.deviceId === deviceId);
      if (!old) {
        const tags = await this.devices.assetTags([deviceId], tx);
        throw conflict(
          ErrorCode.DEVICE_NOT_ON_CONTRACT,
          `${tags.get(deviceId) ?? 'This device'} does not belong to contract ${contract.code}.`,
        );
      }
      if (!RUNNING.includes(contract.status)) {
        throw conflict(
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${contract.status}.`,
        );
      }
      const replacement = await this.devices.takeForReplacement(
        input.replacementDeviceId,
        contract.hardwareVariantId,
        at,
        tx,
        move,
      );
      try {
        await this.organizations.assertActive(contract.organizationId, tx);
      } catch (error) {
        if (
          error instanceof DomainException &&
          error.errorCode === ErrorCode.ORGANIZATION_NOT_ACTIVE
        ) {
          throw conflict(
            ErrorCode.ORGANIZATION_NOT_ACTIVE,
            'Replacement is not allowed while suspended.',
          );
        }
        throw error;
      }
      const keyVersion = await this.organizations.channelKeyVersion(contract.organizationId, tx);
      if (input.keyVersion !== keyVersion) {
        throw conflict(
          ErrorCode.KEY_VERSION_MISMATCH,
          `The organization's channel key is at version ${keyVersion}; write that version to the device.`,
        );
      }

      // The faulty unit at the counter is checked in and goes through reset and inspection like any
      // returned unit; a unit that is away needs its loss case open, which settles the old row later.
      if (input.faultyPresent) {
        await this.contracts.markCheckedIn([old.id], at, actor.id, tx);
        await this.devices.markReturned([deviceId], at, tx, { ...move, reason: 'REPLACED' });
      } else if (!(await this.devices.hasOpenLossCase(deviceId, tx))) {
        throw conflict(
          ErrorCode.LOSS_CASE_REQUIRED,
          'Open a loss case for the missing unit first, or check it in at the counter.',
        );
      }

      await this.devices.recordProvisioning(
        {
          deviceId: replacement.id,
          organizationId: contract.organizationId,
          keyVersion,
          actorId: actor.id,
        },
        at,
        tx,
      );
      await this.devices.markRented([replacement.id], at, tx, move);

      const tags = await this.devices.assetTags([deviceId], tx);
      const detail = await this.contracts.detail(id, tx);
      if (!detail) {
        throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Contract not found.');
      }
      const pdf = await renderHandoverNote(
        await this.handover.noteInput(
          detail,
          {
            kind: 'REPLACEMENT',
            partyA,
            deviceIds: [replacement.id],
            signaturePng: signature,
            uncheckedCondition: 'Issued as a replacement, provisioned at the counter',
            replaces: {
              assetTag: tags.get(deviceId) ?? deviceId,
              how: input.faultyPresent
                ? 'checked in at the counter'
                : 'missing, with its loss case open',
            },
          },
          at,
          tx,
        ),
      );
      const noteSha256 = sha256(pdf);
      const path = await this.handover.storeNote(`${id}-replacement-${replacement.id}.pdf`, pdf);
      const row = await this.contracts.insertReplacementRow(
        {
          contractId: id,
          deviceId: replacement.id,
          replacesId: old.id,
          handedOverAt: at,
          replacementNotePath: path,
          replacementNoteSha256: noteSha256,
        },
        tx,
      );

      if (input.faultyPresent) {
        this.events.emitAfterCommit(DEVICE_CHECKED_IN, {
          deviceId,
          contractId: id,
          organizationId: contract.organizationId,
          at,
        } satisfies DeviceCheckedInEvent);
      }
      this.events.emitAfterCommit(DEVICE_HANDED_OVER, {
        deviceId: replacement.id,
        contractId: id,
        organizationId: contract.organizationId,
        at,
      } satisfies DeviceHandedOverEvent);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: contract.organizationId,
        action: 'contract.deviceReplaced',
        subjectType: 'RentalContract',
        subjectId: id,
        before: { deviceId },
        after: { deviceId: replacement.id, faultyPresent: input.faultyPresent },
      } satisfies AuditRecordEvent);

      return {
        replacedDeviceId: deviceId,
        replacementDeviceId: replacement.id,
        contractDeviceId: row.id,
        replacesId: old.id,
        noteSha256,
      };
    });
  }
}
