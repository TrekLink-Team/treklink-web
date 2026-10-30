import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ContractStatus, InspectionResult, PlanType } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService } from '../billing';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractsRepository } from './contracts.repository';
import { CONTRACT_CLOSE_CHECKS, ContractCloseCheck } from './ports/contract-close-checks.port';

export const DEVICE_CHECKED_IN = 'device.checkedIn';

export interface DeviceCheckedInEvent {
  deviceId: string;
  contractId: string;
  organizationId: string;
  at: Date;
}

export interface InspectionInput {
  result: InspectionResult;
  damageCodes: string[];
  note: string | null;
}

// The states that accept a check-in (REQ-STA-01): a running monthly ACTIVE contract does not, because
// its quantity cannot change; an ACTIVE day plan does.
const RETURNING: readonly ContractStatus[] = [
  ContractStatus.ENDING,
  ContractStatus.RETURN_DUE,
  ContractStatus.OVERDUE,
  ContractStatus.DEFAULTED,
];

// The states a contract leaves for RETURNED once every device is back or lost (design §2).
const DUE: readonly ContractStatus[] = [
  ContractStatus.RETURN_DUE,
  ContractStatus.OVERDUE,
  ContractStatus.DEFAULTED,
];

const conflict = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.CONFLICT, code, message);

const wrongState = (status: ContractStatus) =>
  conflict(ErrorCode.INVALID_STATE_TRANSITION, `This cannot be done while it is ${status}.`);

const notOnContract = (tag: string, code: string) =>
  conflict(ErrorCode.DEVICE_NOT_ON_CONTRACT, `${tag} does not belong to contract ${code}.`);

// The end of a contract at the counter (rentals tasks 4.1, 4.2 and 4.4, api-design 14, 16 and 17;
// UC-43, UC-44, UC-51; MF-05): check-in by scanned tags with the late fee, the inspection after the
// device reset with its damage charge, and the close once nothing is owed and no incident is open.
@Injectable()
export class ReturnService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly lifecycle: ContractLifecycleService,
    private readonly devices: DevicesService,
    private readonly charges: ChargesService,
    private readonly balances: BalanceService,
    private readonly events: TransactionalEvents,
    @Optional()
    @Inject(CONTRACT_CLOSE_CHECKS)
    private readonly closeChecks: ContractCloseCheck[] = [],
  ) {}

  // api-design 14: every scanned tag must be a device still out on this contract, otherwise 409
  // DEVICE_NOT_ON_CONTRACT and nothing is stored. A device back after the return-due time plus the
  // grace gets a late fee line (FR-BILL-03). The last device back moves a due contract to RETURNED
  // (MSG07).
  async checkIn(id: string, assetTags: string[], actor: Caller, at: Date = new Date()) {
    const tags = [...new Set(assetTags.map((tag) => tag.trim()).filter((tag) => tag !== ''))];
    // Blank tags trim to nothing; with none left there is nothing to check in (api-design 14).
    if (tags.length === 0) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'assetTags must name at least one device.',
      );
    }
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      const dayPlanActive =
        contract.status === ContractStatus.ACTIVE && contract.planType === PlanType.DAY;
      if (!RETURNING.includes(contract.status) && !dayPlanActive) throw wrongState(contract.status);

      const out = await this.contracts.rowsOut(id, tx);
      const tagOf = await this.devices.assetTags(
        out.map((row) => row.deviceId),
        tx,
      );
      const byTag = new Map(out.map((row) => [tagOf.get(row.deviceId) ?? row.deviceId, row]));
      const rows = tags.map((tag) => {
        const row = byTag.get(tag);
        if (!row) throw notOnContract(tag, contract.code);
        return { ...row, assetTag: tag };
      });

      // A delayed daily batch must not waive lateness. Running day plans and monthly contracts
      // under notice can return before the batch fills returnDueAt; their open term owns the deadline.
      let returnDueAt = contract.returnDueAt;
      if (!returnDueAt && (dayPlanActive || contract.status === ContractStatus.ENDING)) {
        const term = await this.contracts.openTerm(id, tx);
        if (!term) throw new Error(`Contract ${contract.code} has no open term.`);
        if (term.endsAt.getTime() < at.getTime()) returnDueAt = term.endsAt;
      }

      const owedBefore = await this.balances.outstanding(id, tx);
      await this.contracts.markCheckedIn(
        rows.map((row) => row.id),
        at,
        actor.id,
        tx,
      );
      await this.devices.markReturned(
        rows.map((row) => row.deviceId),
        at,
        tx,
      );
      if (returnDueAt) {
        for (const row of rows) {
          await this.charges.chargeLate(
            { id, organizationId: contract.organizationId, returnDueAt },
            { id: row.deviceId, assetTag: row.assetTag },
            at,
            actor.id,
            tx,
          );
        }
      }
      const lateFeeVnd = (await this.balances.outstanding(id, tx)) - owedBefore;

      const { total, returned } = await this.contracts.returnCounts(id, tx);
      let status = contract.status;
      if (DUE.includes(contract.status) && returned === total) {
        status = (
          await this.lifecycle.apply(
            id,
            contract.status,
            ContractStatus.RETURNED,
            'CHECKED_IN',
            actor,
            tx,
          )
        ).status;
      }
      for (const row of rows) {
        this.events.emitAfterCommit(DEVICE_CHECKED_IN, {
          deviceId: row.deviceId,
          contractId: id,
          organizationId: contract.organizationId,
          at,
        } satisfies DeviceCheckedInEvent);
      }
      return {
        checkedIn: rows.map((row) => row.assetTag),
        returned,
        total,
        contractStatus: status,
        lateFeeVnd: Number(lateFeeVnd > 0n ? lateFeeVnd : 0n),
      };
    });
  }

  // api-design 16: the inspection of a checked-in device after its reset, and for DAMAGED the damage
  // charge, in one transaction (REQ-EVT-11), unless the contract is CLOSED.
  async inspect(
    id: string,
    deviceId: string,
    input: InspectionInput,
    actor: Caller,
    at: Date = new Date(),
  ) {
    if (input.result === InspectionResult.DAMAGED && input.damageCodes.length === 0) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'damageCodes is required.',
      );
    }
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (contract.status === ContractStatus.CLOSED) throw wrongState(contract.status);
      const row = await this.contracts.findDeviceRow(id, deviceId, tx);
      const tags = await this.devices.assetTags([deviceId], tx);
      const assetTag = tags.get(deviceId) ?? deviceId;
      if (!row?.handedOverAt) throw notOnContract(assetTag, contract.code);

      const recorded = await this.devices.recordInspection(
        deviceId,
        {
          result: input.result,
          damageCodes: input.damageCodes,
          note: input.note,
          contractDeviceId: row.id,
          checkedInAt: row.checkedInAt ?? at,
        },
        actor.id,
        at,
        tx,
      );
      const damage =
        input.result === InspectionResult.DAMAGED
          ? await this.charges.chargeDamage(
              { id, organizationId: contract.organizationId },
              {
                id: recorded.inspection.id,
                deviceId,
                assetTag,
                hardwareVariantId: recorded.device.hardwareVariantId,
                damageCodes: input.damageCodes,
              },
              actor.id,
              tx,
              at,
            )
          : null;
      return {
        inspection: recorded.inspection,
        device: { id: deviceId, assetTag, status: recorded.device.status },
        damageCharge: damage
          ? {
              id: damage.charge.id,
              amountVnd: Number(damage.charge.amountVnd),
              status: damage.charge.status,
            }
          : null,
      };
    });
  }

  // api-design 17 (FR-CON-13, BR-27): a RETURNED contract closes when nothing is owed (409
  // BALANCE_OUTSTANDING) and no incident on its devices is open (409 OPEN_INCIDENTS, MSG29); the holder
  // labels are erased (BR-33). A damage charge still waiting for an Admin blocks it too, found by the
  // contract the charge stores (D-081).
  async close(id: string, expectedVersion: number, actor: Caller) {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (contract.version !== expectedVersion) {
        throw conflict(
          ErrorCode.STALE_VERSION,
          'This was changed by someone else. Reload and try again.',
        );
      }
      if (contract.status !== ContractStatus.RETURNED) throw wrongState(contract.status);
      if ((await this.balances.outstanding(id, tx)) > 0n) {
        throw conflict(
          ErrorCode.BALANCE_OUTSTANDING,
          'This cannot be done while it has open balances.',
        );
      }
      // Every device the contract held, replaced units included (rentals 4.3).
      const deviceIds = await this.contracts.custodyDevices(id, tx);
      // A unit replaced while missing blocks until its loss case settles and sets lostAt.
      if ((await this.contracts.unsettledReplacedLosses(id, tx)) > 0) {
        throw conflict(
          ErrorCode.BALANCE_OUTSTANDING,
          'This cannot be done while it has open balances.',
        );
      }
      // A damage charge above the approval threshold waits for an Admin with no invoice line yet;
      // it is part of what the contract owes (api-design 17, REQ-ERR-05).
      if ((await this.charges.pendingDamage(id, tx)) > 0) {
        throw conflict(
          ErrorCode.BALANCE_OUTSTANDING,
          'This cannot be done while it has open balances.',
        );
      }
      for (const check of this.closeChecks) {
        const reason = await check.blockingReason(id, deviceIds, tx);
        if (reason) {
          throw conflict(
            ErrorCode.OPEN_INCIDENTS,
            reason.message || 'This cannot be done while it has open incidents.',
          );
        }
      }
      await this.contracts.eraseLabels(id, tx);
      return this.lifecycle.apply(
        id,
        ContractStatus.RETURNED,
        ContractStatus.CLOSED,
        'CLOSED',
        actor,
        tx,
      );
    });
  }
}
