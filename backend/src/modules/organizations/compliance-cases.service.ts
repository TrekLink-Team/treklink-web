import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ComplianceActionKind,
  ComplianceCaseStatus,
  ComplianceCaseType,
  Prisma,
} from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { PagedResult, pagingBoundsFrom, resolvePage, toPagedResult } from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService } from '../auth';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ApiKeysService } from './api-keys.service';
import { ComplianceCaseRow, ComplianceCasesRepository } from './compliance-cases.repository';
import { FieldStationsService } from './field-stations.service';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

export interface ComplianceActionView {
  kind: ComplianceActionKind;
  actor: { id: string; fullName: string | null };
  at: Date;
}

export interface ComplianceCaseView {
  id: string;
  code: string;
  organization: { id: string; code: string };
  type: ComplianceCaseType;
  status: ComplianceCaseStatus;
  evidence: string;
  linkedContractIds: string[];
  linkedLossCases: string[];
  authorityReference: string | null;
  outcome: string | null;
  openedAt: Date;
  actions: ComplianceActionView[];
}

export interface OpenCase {
  type: ComplianceCaseType;
  evidence: string;
  linkedContractIds: string[];
  linkedLossCaseIds: string[];
}

export interface CaseAction {
  kind: ComplianceActionKind;
  targetId: string | null;
  note: string;
}

// BR-40: these types close only with a police report reference.
export const NEEDS_POLICE_REFERENCE: readonly ComplianceCaseType[] = [
  ComplianceCaseType.SUSPECTED_FRAUD,
  ComplianceCaseType.SUSPECTED_THEFT,
];

const REVOCATIONS: readonly ComplianceActionKind[] = [
  ComplianceActionKind.REVOKE_FIELD_STATION,
  ComplianceActionKind.REVOKE_API_KEY,
];

const caseNotFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Compliance case not found.');

const validation = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);

// Compliance cases (task 2.10, api-design 28 to 32, UC-63, D-046), TrekLink Staff and Admin through
// `complianceCase.manage`. Actions reuse the existing operations in the case's transaction: the Admin
// suspension (`OrganizationsService.suspendFromCompliance`), `FieldStationsService.revoke`, and
// `ApiKeysService.revoke` (treklink-web#125). Each action appends a `ComplianceAction` with its actor
// (FR-ORG-09).
//
// Gap: `linkedLossCases` is always empty. `LossCase` belongs to `devices`, which imports this module,
// so linking or reading loss cases needs a port `devices` provides; until it exists, opening a case
// with `linkedLossCaseIds` is refused with 400 rather than dropping them unseen.
@Injectable()
export class ComplianceCasesService {
  constructor(
    private readonly cases: ComplianceCasesRepository,
    private readonly organizationRows: OrganizationsRepository,
    private readonly organizations: OrganizationsService,
    private readonly stations: FieldStationsService,
    private readonly apiKeys: ApiKeysService,
    private readonly accounts: AccountsService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // api-design 28, newest first.
  async page(query: {
    status?: ComplianceCaseStatus;
    pageNumber?: number;
    pageSize?: number;
  }): Promise<PagedResult<ComplianceCaseView>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.cases.page({ status: query.status }, page.skip, page.take);
    return toPagedResult(await this.views(rows), total, page);
  }

  // api-design 32.
  async get(id: string): Promise<ComplianceCaseView> {
    const row = await this.cases.find(id);
    if (!row) throw caseNotFound();
    return (await this.views([row]))[0];
  }

  // api-design 29.
  async open(organizationId: string, input: OpenCase, staff: Caller): Promise<ComplianceCaseView> {
    if (input.linkedLossCaseIds.length > 0) {
      throw validation('Linking loss cases is not available yet.');
    }
    if ((await this.organizationRows.findStatus(organizationId)) === null) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Organization not found.',
      );
    }
    const row = await this.events.transaction(async (tx) => {
      const created = await this.cases.create(
        {
          code: await this.cases.nextCode(tx),
          organizationId,
          type: input.type,
          evidence: input.evidence,
          linkedContractIds: [...new Set(input.linkedContractIds)],
          openedById: staff.id,
        },
        tx,
      );
      this.audit(staff, created, 'complianceCase.open', null, {
        code: created.code,
        type: created.type,
      });
      return created;
    });
    return (await this.views([row]))[0];
  }

  // api-design 30. `maySuspend` is the caller's `organization.suspend` (Admin); a suspension without
  // it is 403 before anything is read. A revocation needs `targetId`.
  async act(
    id: string,
    action: CaseAction,
    caller: Caller,
    maySuspend: boolean,
    at: Date = new Date(),
  ): Promise<ComplianceCaseView> {
    if (action.kind === ComplianceActionKind.SUSPEND_ORGANIZATION && !maySuspend) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Ask a TrekLink Admin to suspend the organization.',
      );
    }
    const isRevocation = REVOCATIONS.includes(action.kind);
    if (isRevocation && !action.targetId) {
      throw validation('targetId is required for a revocation.');
    }
    // FieldStationsService (treklink-web#134) manages its own transaction and takes no `tx`, so it
    // cannot join this one. Called first, a missing station answers before the case is touched; the
    // revoke is idempotent (a second revoke of the same station answers it as it is), so running it
    // ahead of the transaction below is safe even if that transaction later fails for another reason.
    if (action.kind === ComplianceActionKind.REVOKE_FIELD_STATION) {
      const precheck = await this.cases.find(id);
      if (!precheck) throw caseNotFound();
      await this.stations.revoke(precheck.organization.id, action.targetId!, action.note, caller);
    }
    const row = await this.events.transaction(async (tx) => {
      const current = await this.openCase(id, tx);
      const organizationId = current.organization.id;
      switch (action.kind) {
        case ComplianceActionKind.SUSPEND_ORGANIZATION:
          await this.organizations.suspendFromCompliance(
            organizationId,
            `Compliance case ${current.code}: ${action.note}`,
            caller,
            at,
            tx,
          );
          break;
        case ComplianceActionKind.REVOKE_API_KEY:
          await this.apiKeys.revoke(organizationId, action.targetId!, caller, tx);
          break;
        default:
          break;
      }
      await this.cases.addAction(
        {
          caseId: id,
          kind: action.kind,
          targetId:
            action.kind === ComplianceActionKind.SUSPEND_ORGANIZATION
              ? null
              : (action.targetId ?? null),
          note: action.note,
          actorId: caller.id,
        },
        tx,
      );
      this.audit(caller, current, 'complianceCase.action', null, {
        kind: action.kind,
        targetId: action.targetId ?? null,
        note: action.note,
      });
      return (await this.cases.find(id, tx))!;
    });
    return (await this.views([row]))[0];
  }

  // api-design 31.
  async close(
    id: string,
    outcome: string,
    authorityReference: string | null,
    caller: Caller,
    at: Date = new Date(),
  ): Promise<ComplianceCaseView> {
    const reference = authorityReference?.trim() || null;
    const row = await this.events.transaction(async (tx) => {
      const current = await this.openCase(id, tx);
      if (NEEDS_POLICE_REFERENCE.includes(current.type) && !reference) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.POLICE_REFERENCE_REQUIRED,
          'Record the police report reference before closing.',
        );
      }
      await this.cases.close(
        id,
        { outcome, authorityReference: reference, closedById: caller.id, at },
        tx,
      );
      this.audit(
        caller,
        current,
        'complianceCase.close',
        { status: ComplianceCaseStatus.OPEN },
        { status: ComplianceCaseStatus.CLOSED, outcome, authorityReference: reference },
      );
      return (await this.cases.find(id, tx))!;
    });
    return (await this.views([row]))[0];
  }

  // The case locked and still OPEN: 404 when unknown, 409 when CLOSED.
  private async openCase(id: string, tx: Prisma.TransactionClient): Promise<ComplianceCaseRow> {
    const current = await this.cases.lock(id, tx);
    if (!current) throw caseNotFound();
    if (current.status !== ComplianceCaseStatus.OPEN) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        `This cannot be done while it is ${current.status}.`,
      );
    }
    return current;
  }

  // Rows to responses, with every actor's name read in one call.
  private async views(rows: ComplianceCaseRow[]): Promise<ComplianceCaseView[]> {
    const actorIds = [...new Set(rows.flatMap((row) => row.actions.map((a) => a.actorId)))];
    const cards = await this.accounts.contactCard(actorIds);
    const names = new Map(cards.map((card) => [card.id, card.fullName]));
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      organization: row.organization,
      type: row.type,
      status: row.status,
      evidence: row.evidence,
      linkedContractIds: row.linkedContractIds,
      linkedLossCases: [],
      authorityReference: row.authorityReference,
      outcome: row.outcome,
      openedAt: row.openedAt,
      actions: row.actions.map((a) => ({
        kind: a.kind,
        actor: { id: a.actorId, fullName: names.get(a.actorId) ?? null },
        at: a.createdAt,
      })),
    }));
  }

  private audit(
    actor: Caller,
    row: ComplianceCaseRow,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ) {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId: row.organization.id,
      action,
      subjectType: 'ComplianceCase',
      subjectId: row.id,
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}
