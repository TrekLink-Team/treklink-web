import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberRole, OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { PagedResult, pagingBoundsFrom, resolvePage, toPagedResult } from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { MembersRepository } from './members.repository';
import { OrganizationReviewRow, OrganizationsRepository } from './organizations.repository';

export interface Registration {
  legalName: string;
  taxCode: string;
  address: string;
  contactPhone: string;
  managerFullName: string;
  managerEmail: string;
  managerPhone: string;
}

export interface Verification {
  method: 'IN_PERSON' | 'PHONE';
  documentsSeen: string[];
  masterContractRef: string;
  ndaSigned: boolean;
  softwareLicenceSigned: boolean;
  expectedVersion: number;
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

const conflict = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.CONFLICT, code, message);

const stale = () =>
  conflict(ErrorCode.STALE_VERSION, 'Someone else changed this. Reload to see the latest.');

const notPending = (status: OrganizationStatus) =>
  conflict(ErrorCode.INVALID_STATE_TRANSITION, `This cannot be done while it is ${status}.`);

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// Organization onboarding, MF-01's first half (organizations tasks 2.1 to 2.3, api-design 01, 02, 05
// to 07, UC-01 to UC-03), built by LongLP for Review 2 in TanNB's lane: self-registration creates a
// PENDING organization with its Manager account, Staff record the counter verification with the
// signed contract terms, and an Admin approves a verified organization or rejects it. Open (recorded
// in tasks.md): the Staff and Admin notifications, the MSG05 and MSG16 emails, and the full
// lifecycle table of task 1.2.
@Injectable()
export class OrganizationOnboardingService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly members: MembersRepository,
    private readonly accounts: AccountsService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    private readonly parameters: ParameterService,
  ) {}

  // api-design 02, the Staff and Admin queue.
  async page(query: {
    status?: OrganizationStatus;
    q?: string;
    pageNumber?: number;
    pageSize?: number;
  }): Promise<PagedResult<OrganizationReviewRow>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.organizations.page(
      { status: query.status, q: query.q?.trim() || undefined },
      page.skip,
      page.take,
    );
    return toPagedResult(rows, total, page);
  }

  // api-design 01 (FR-ORG-01, BR-01): one transaction for the organization, the Manager account with
  // its set-password invitation (sent after commit), the membership and the first transition. A tax
  // code or Manager email already registered is 409 CONFLICT_UNIQUE (MSG10).
  async register(input: Registration): Promise<OrganizationReviewRow> {
    const conflictUnique = (field: string) =>
      new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT_UNIQUE,
        `This ${field} is already registered.`,
      );
    if (await this.organizations.taxCodeTaken(input.taxCode)) throw conflictUnique('tax code');
    // The invitation code reads auth.invitationTtlHours through ParameterService, which reads on the
    // shared client even inside a transaction (treklink-web#87). Reading it here first puts it in
    // the cache, so the transaction below does not wait on a second connection.
    await this.parameters.get('auth.invitationTtlHours');
    try {
      return await this.events.transaction(async (tx) => {
        const organization = await this.organizations.createPending(
          {
            code: await this.organizations.nextCode(tx),
            legalName: input.legalName,
            taxCode: input.taxCode,
            address: input.address,
            contactEmail: input.managerEmail,
            contactPhone: input.contactPhone,
          },
          tx,
        );
        const manager = await this.accounts.createOrganizationAccount(
          {
            email: input.managerEmail,
            fullName: input.managerFullName,
            phone: input.managerPhone,
            role: 'ORG_MANAGER',
          },
          tx,
        );
        await this.members.addMember(
          { organizationId: organization.id, userId: manager.id, role: MemberRole.MANAGER },
          tx,
        );
        await this.organizations.addTransition(
          {
            organizationId: organization.id,
            fromStatus: null,
            toStatus: OrganizationStatus.PENDING,
            actorId: manager.id,
          },
          tx,
        );
        return organization;
      });
    } catch (error) {
      // Two registrations racing for one tax code or one code: the unique index decides.
      if (isUniqueViolation(error)) throw conflictUnique('organization');
      throw error;
    }
  }

  // api-design 05 (FR-ORG-02, BR-43, AC-09): Staff record the counter or phone check on a PENDING
  // organization. Both contract terms must be signed, otherwise 400 CONTRACT_TERMS_MISSING and
  // nothing is stored. A second verification overwrites the first while the organization is PENDING.
  async verify(id: string, input: Verification, staff: Caller, at: Date = new Date()) {
    if (!input.ndaSigned || !input.softwareLicenceSigned) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.CONTRACT_TERMS_MISSING,
        'The master contract must include the signed NDA and the software licence.',
      );
    }
    return this.events.transaction(async (tx) => {
      const current = await this.organizations.lockById(id, tx);
      if (!current) throw notFound();
      if (current.status !== OrganizationStatus.PENDING) throw notPending(current.status);
      const saved = await this.organizations.update(
        id,
        input.expectedVersion,
        {
          verifiedAt: at,
          verifiedById: staff.id,
          verificationMethod: input.method,
          documentsSeen: input.documentsSeen,
          masterContractRef: input.masterContractRef,
          ndaSigned: true,
          softwareLicenceSigned: true,
        },
        tx,
      );
      if (!saved) throw stale();
      this.audit(staff, saved.id, 'organization.verified', null, {
        method: input.method,
        masterContractRef: input.masterContractRef,
      });
      return saved;
    });
  }

  // api-design 06 (FR-ORG-03): only a verified PENDING organization is approved (409 NOT_VERIFIED,
  // MSG21); it becomes ACTIVE and its members may request devices.
  approve(id: string, expectedVersion: number, admin: Caller, at: Date = new Date()) {
    return this.decide(id, expectedVersion, admin, at, OrganizationStatus.ACTIVE, null);
  }

  // api-design 07: a PENDING organization is rejected with the reason shown to its Manager (MSG16).
  reject(id: string, reason: string, expectedVersion: number, admin: Caller, at = new Date()) {
    return this.decide(id, expectedVersion, admin, at, OrganizationStatus.REJECTED, reason);
  }

  private decide(
    id: string,
    expectedVersion: number,
    admin: Caller,
    at: Date,
    to: OrganizationStatus,
    reason: string | null,
  ) {
    return this.events.transaction(async (tx) => {
      const current = await this.organizations.lockById(id, tx);
      if (!current) throw notFound();
      if (current.status !== OrganizationStatus.PENDING) throw notPending(current.status);
      if (to === OrganizationStatus.ACTIVE && !current.verifiedAt) {
        throw conflict(
          ErrorCode.NOT_VERIFIED,
          'Verify this organization at the counter before approving it.',
        );
      }
      const saved = await this.organizations.update(
        id,
        expectedVersion,
        {
          status: to,
          statusChangedAt: at,
          decidedAt: at,
          decidedById: admin.id,
          rejectionReason: reason,
        },
        tx,
      );
      if (!saved) throw stale();
      await this.organizations.addTransition(
        {
          organizationId: id,
          fromStatus: OrganizationStatus.PENDING,
          toStatus: to,
          actorId: admin.id,
          reason,
        },
        tx,
      );
      this.audit(
        admin,
        id,
        to === OrganizationStatus.ACTIVE ? 'organization.approved' : 'organization.rejected',
        { status: OrganizationStatus.PENDING },
        { status: to, reason },
      );
      return saved;
    });
  }

  private audit(
    actor: Caller,
    organizationId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId,
      action,
      subjectType: 'Organization',
      subjectId: organizationId,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}
