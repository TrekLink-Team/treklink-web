import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DamageChargeStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ACCOUNT_DIRECTORY, AccountDirectory } from '../platform/ports/account-directory.port';
import { ActorRef, resolveActors } from '../platform/ports/actor-names';
import { ChargesService } from './charges.service';
import {
  DamageChargeFilter,
  DamageChargeRow,
  DamageChargesRepository,
} from './damage-charges.repository';
import { DamageDecisionKind } from './dto/damage-charges.dto';
import { InvoicesRepository } from './invoices.repository';

export interface DamageChargeItem extends DamageChargeRow {
  assetTag: string | null;
  inspector: ActorRef | null;
}

export interface DamageDecisionInput {
  decision: DamageDecisionKind;
  finalVnd?: number;
  note: string;
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Damage charge not found.');

// The Admin side of damage charges (billing task 2.5, UC-48, api-design 16 and 17, FR-BILL-04,
// BR-24): the queue, and the decision on a charge above `billing.damageApprovalThresholdVnd`. Every
// value the decision needs is on the charge itself (D-081): its contract for the closing invoice and
// its inspector for the separation of duty.
@Injectable()
export class DamageChargeService {
  constructor(
    private readonly damageCharges: DamageChargesRepository,
    private readonly invoices: InvoicesRepository,
    private readonly charges: ChargesService,
    private readonly devices: DevicesService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(ACCOUNT_DIRECTORY) private readonly directory?: AccountDirectory,
  ) {}

  // One page of charges, newest first, with the unit's asset tag and the inspector's name.
  async list(
    filter: DamageChargeFilter,
    query: PagedQueryDto,
  ): Promise<PagedResult<DamageChargeItem>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.damageCharges.page(filter, page.skip, page.take);
    const tags = await this.devices.assetTags([...new Set(rows.map((row) => row.deviceId))]);
    const actorOf = await resolveActors(
      this.directory,
      rows.map((row) => row.inspectorId),
    );
    const items = rows.map((row) => ({
      ...row,
      assetTag: tags.get(row.deviceId) ?? null,
      inspector: actorOf(row.inspectorId),
    }));
    return toPagedResult(items, total, page);
  }

  // The Admin decision (api-design 17): under the charge lock, a charge that is not PENDING_APPROVAL
  // is 409 INVALID_STATE_TRANSITION and the inspector is 403 SEPARATION_OF_DUTY (REQ-ERR-03, E05-6,
  // MSG30). APPROVED keeps the charged amount, REDUCED takes `finalVnd` above zero and below it, and
  // WAIVED keeps nothing; an approved or reduced amount becomes a DAMAGE line on the closing invoice.
  async decide(
    id: string,
    input: DamageDecisionInput,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<DamageChargeRow> {
    return this.events.transaction(async (tx) => {
      const charge = await this.damageCharges.lock(id, tx);
      if (!charge) throw notFound();
      if (charge.status !== DamageChargeStatus.PENDING_APPROVAL) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${charge.status}.`,
        );
      }
      if (charge.inspectorId === actor.id) {
        throw new DomainException(
          HttpStatus.FORBIDDEN,
          ErrorCode.SEPARATION_OF_DUTY,
          'A different Admin must approve this charge.',
        );
      }
      const finalVnd = this.finalAmount(charge.amountVnd, input);
      const decided = await this.damageCharges.recordDecision(
        id,
        {
          status: DamageChargeStatus[input.decision],
          finalVnd,
          decidedById: actor.id,
          decisionNote: input.note,
          decidedAt: at,
        },
        tx,
      );

      // A waiver has no invoice line, but its audit row still belongs to the contract's organization.
      // Only a charged amount needs an invoice to find it; a waiver on a contract without one is
      // recorded with no organization rather than refused (review of #144).
      const organizationId = await this.invoices.organizationOfContract(charge.contractId, tx);
      if (!organizationId && finalVnd > 0n) {
        // A charged amount needs the closing invoice of a contract that has been invoiced (review of #148).
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          'This charge cannot be billed before the contract has an invoice.',
        );
      }
      if (organizationId && finalVnd > 0n) {
        const tags = await this.devices.assetTags([charge.deviceId], tx);
        await this.charges.addDecidedDamage(
          { id: charge.contractId, organizationId },
          charge,
          tags.get(charge.deviceId) ?? charge.deviceId,
          finalVnd,
          actor.id,
          tx,
          at,
        );
      }

      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId,
        action: 'damageCharge.decided',
        subjectType: 'DamageCharge',
        subjectId: id,
        before: { status: charge.status, amountVnd: charge.amountVnd.toString() },
        after: { status: decided.status, finalVnd: finalVnd.toString(), note: input.note },
      } satisfies AuditRecordEvent);
      return decided;
    });
  }

  private finalAmount(amountVnd: bigint, input: DamageDecisionInput): bigint {
    if (input.decision === 'APPROVED') return amountVnd;
    if (input.decision === 'WAIVED') return 0n;
    const reduced = BigInt(input.finalVnd ?? 0);
    if (reduced <= 0n || reduced >= amountVnd) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'finalVnd must be above 0 and below the charged amount.',
      );
    }
    return reduced;
  }
}
