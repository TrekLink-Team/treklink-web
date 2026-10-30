import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { UpdateOrganizationDto } from './dto/profile.dto';
import { invalidState } from './organization-lifecycle';
import { MembersRepository } from './members.repository';
import { OrganizationDetailRow, OrganizationsRepository } from './organizations.repository';
import { ORGANIZATION_COUNTS, OrganizationCountProvider } from './ports/counts.port';

const ADMIN = 'ADMIN';
const EDITABLE = ['address', 'contactEmail', 'contactPhone', 'legalName'] as const;

export interface OrganizationDetail extends Omit<OrganizationDetailRow, 'verifiedById'> {
  verification: {
    method: string | null;
    documentsSeen: string[];
    masterContractRef: string | null;
    verifiedBy: string | null;
  } | null;
  counts: { members: number; runningContracts: number; openIncidents: number };
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

// One organization as TrekLink Staff and Admin see it, and as its own members do (organizations
// api-design 03), and the edit of its contact details (api-design 04). The counts of contracts and
// incidents come from the providers of ORGANIZATION_COUNTS, since `organizations` may not read those
// tables. Another organization answers 404, like every read of this module.
@Injectable()
export class OrganizationProfileService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly members: MembersRepository,
    private readonly accounts: AccountsService,
    private readonly events: TransactionalEvents,
    @Optional()
    @Inject(ORGANIZATION_COUNTS)
    private readonly counts: OrganizationCountProvider[] = [],
  ) {}

  async detail(organizationId: string, caller: Caller): Promise<OrganizationDetail> {
    if (caller.organizationId !== null && caller.organizationId !== organizationId)
      throw notFound();
    const row = await this.organizations.findDetail(organizationId);
    if (!row) throw notFound();
    return this.present(row);
  }

  // Manager: own organization, contact details only. Admin: any, and the legal name too, because the
  // master contract names it. A CLOSED or REJECTED organization is final and is not edited (409).
  async update(
    organizationId: string,
    input: UpdateOrganizationDto,
    caller: Caller,
  ): Promise<OrganizationDetail> {
    if (caller.organizationId !== null && caller.organizationId !== organizationId)
      throw notFound();
    const changes = EDITABLE.filter((field) => input[field] !== undefined);
    if (changes.length === 0) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'At least one field to change is required.',
      );
    }
    if (input.legalName !== undefined && !caller.roles.includes(ADMIN)) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only TrekLink Admin can change the legal name.',
      );
    }
    const saved = await this.events.transaction(async (tx) => {
      const current = await this.organizations.lockById(organizationId, tx);
      if (!current) throw notFound();
      if (current.status === 'CLOSED' || current.status === 'REJECTED') {
        throw invalidState(current.status);
      }
      const data = Object.fromEntries(changes.map((field) => [field, input[field]]));
      const next = await this.organizations.update(organizationId, input.expectedVersion, data, tx);
      if (!next) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_VERSION,
          'Someone else changed this. Reload to see the latest.',
        );
      }
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: caller.roles,
        organizationId,
        action: 'organization.updated',
        subjectType: 'Organization',
        subjectId: organizationId,
        before: Object.fromEntries(changes.map((field) => [field, current[field]])),
        after: data,
      } satisfies AuditRecordEvent);
      return next;
    });
    return this.detail(saved.id, caller);
  }

  private async present(row: OrganizationDetailRow): Promise<OrganizationDetail> {
    const { verifiedById, ...rest } = row;
    const [members, extra, verifier] = await Promise.all([
      this.members.countActive(row.id),
      Promise.all(
        this.counts.map(async (provider) => [provider.name, await provider.count(row.id)] as const),
      ),
      verifiedById ? this.accounts.contactCard([verifiedById]) : Promise.resolve([]),
    ]);
    const counted = Object.fromEntries(extra) as Partial<Record<string, number>>;
    return {
      ...rest,
      verification:
        row.verifiedAt === null
          ? null
          : {
              method: row.verificationMethod,
              documentsSeen: row.documentsSeen,
              masterContractRef: row.masterContractRef,
              verifiedBy: verifier[0]?.fullName ?? null,
            },
      counts: {
        members,
        runningContracts: counted.runningContracts ?? 0,
        openIncidents: counted.openIncidents ?? 0,
      },
    };
  }
}
