import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { isAllowedTransition } from './contract-states';
import { ContractRow, ContractsRepository } from './contracts.repository';

export const CONTRACT_STATUS_CHANGED = 'contract.statusChanged';

export interface ContractStatusChangedEvent {
  contractId: string;
  organizationId: string;
  from: ContractStatus;
  to: ContractStatus;
  at: Date;
}

const refused = (from: ContractStatus, to: ContractStatus) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `A ${from} contract cannot become ${to}.`,
  );

// `RETURN_DUE` reads as `returnDue` in an audit action (treklink-docs#103, 5).
const camel = (status: ContractStatus): string =>
  status.toLowerCase().replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

// The single way a contract changes status (rentals task 1.2, REQ-UBI-01, FR-CON-13): the D-035 pair
// must be allowed, the row is locked and still in `from`, and the version compare-and-set writes the
// change with one transition row. `contract.statusChanged` and `audit.record` go out after commit.
// `actor` null is SYSTEM, for the jobs of design §5 (treklink-docs#103, 2).
@Injectable()
export class ContractLifecycleService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly events: TransactionalEvents,
  ) {}

  async apply(
    id: string,
    from: ContractStatus,
    to: ContractStatus,
    reason: string | null,
    actor: Caller | null,
    tx: Prisma.TransactionClient,
  ): Promise<ContractRow> {
    if (!isAllowedTransition(from, to)) throw refused(from, to);

    const contract = await this.contracts.lockById(id, tx);
    if (contract.status !== from) throw refused(contract.status, to);

    const at = new Date();
    const written = await this.contracts.transition(
      id,
      { from, to, version: contract.version, actorId: actor?.id ?? null, reason, at },
      tx,
    );
    if (!written) throw refused(from, to);

    this.events.emitAfterCommit(CONTRACT_STATUS_CHANGED, {
      contractId: id,
      organizationId: contract.organizationId,
      from,
      to,
      at,
    } satisfies ContractStatusChangedEvent);
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor?.id ?? null,
      actorRoles: actor?.roles ?? [],
      organizationId: contract.organizationId,
      action: `contract.${camel(to)}`,
      subjectType: 'RentalContract',
      subjectId: id,
      before: { status: from },
      after: { status: to, reason },
    } satisfies AuditRecordEvent);

    return { ...contract, status: to, version: contract.version + 1 };
  }
}
