import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Incident, IncidentState, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractsService } from '../rentals';
import { AuthorityReportRow, AuthorityReportsRepository } from './authority-reports.repository';
import { IncidentActor, IncidentLifecycle, IncidentRecipients } from './incident-lifecycle';
import { IncidentsRepository } from './incidents.repository';

export interface ReportIncidentInput {
  agency: string;
  reference: string;
  reportedAt: Date;
  note?: string;
  expectedVersion: number;
}

export interface ReportContractInput {
  contractId: string;
  agency: string;
  reference: string;
  reportedAt: Date;
  note?: string;
}

export interface CloseCaseInput {
  closedAt: Date;
  note?: string;
}

// api-design 09. `incidentState` is null for a contract report, which has no incident.
export interface CloseCaseResult {
  id: string;
  caseClosedAt: Date;
  incidentState: IncidentState | null;
}

export interface AuthorityReportListQuery extends PagedQueryDto {
  open?: boolean;
}

export type AuthorityReportView = AuthorityReportRow;

type StaffActor = Extract<IncidentActor, { kind: 'STAFF' }>;

// REPORTED and CLOSED alert nobody: these edges enqueue only the organization's API event, so the
// Staff recipients ruling (R1, treklink-web#118) does not apply to them.
const NO_RECIPIENTS: IncidentRecipients = { primary: [], backup: [], managers: [], staff: [] };
const REPORTABLE: readonly IncidentState[] = ['ESCALATED', 'UNROUTED'];

const badRequest = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
const required = (value: string | undefined, field: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) throw badRequest(`${field} is required.`);
  return trimmed;
};
const whileIn = (state: IncidentState) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${state}.`,
  );
const closed = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.CASE_ALREADY_CLOSED,
    'This cannot be done while it is CLOSED.',
  );
const notInFuture = (value: Date, field: string): void => {
  if (value.getTime() > Date.now()) throw badRequest(`${field} must not be in the future.`);
};

// UC-35 and the authority case closure of UC-37 (incidents task 4.3, api-design 08, 09 and 11).
// TrekLink logs and reports; it never coordinates a rescue (BR-17, D-033 item 6). State rules,
// versions, history and the outbox stay in IncidentLifecycle; this service supplies the locked
// source state and writes the report in the same transaction. api-design 10 records a report on a
// DEFAULTED contract (D-078 ruling, 2026-10-30: built with task 4.3).
@Injectable()
export class AuthorityReportsService {
  constructor(
    private readonly incidents: IncidentsRepository,
    private readonly reports: AuthorityReportsRepository,
    private readonly lifecycle: IncidentLifecycle,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    private readonly contracts: ContractsService,
  ) {}

  async reportIncident(id: string, input: ReportIncidentInput, caller: Caller): Promise<Incident> {
    const actor = this.staff(caller);
    const agency = required(input.agency, 'agency');
    const reference = required(input.reference, 'reference');
    notInFuture(input.reportedAt, 'reportedAt');
    const note = input.note?.trim() || undefined;
    return this.events.transaction(async (tx) => {
      const current = await this.incidents.lockById(id, tx);
      if (!current)
        throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.');
      // The state is checked before the version, in the order of the api-design 08 activity.
      if (!REPORTABLE.includes(current.state)) throw whileIn(current.state);
      const updated = await this.lifecycle.apply(
        id,
        current.state,
        'REPORTED',
        actor,
        {
          code: 'AUTHORITY_REPORTED',
          at: new Date(),
          recipients: NO_RECIPIENTS,
          expectedVersion: input.expectedVersion,
          note,
        },
        tx,
      );
      const report = await this.reports.insert(
        {
          incidentId: id,
          agency,
          reference,
          reportedAt: input.reportedAt,
          reportedById: actor.id,
          note,
        },
        tx,
      );
      this.audit(actor, current.organizationId, 'authority_report.create', report.id, {
        incidentId: id,
        agency,
        reference,
        reportedAt: input.reportedAt,
      });
      return updated;
    });
  }

  // api-design 10 (BR-17, BR-26): evidence for a DEFAULTED contract; the contract state does not
  // change. The status comes from rentals as a plain read. A missing contract is 404, another status
  // 409 CONTRACT_NOT_DEFAULTED naming it. api-design 10 sets no bound on reportedAt (screen 8.3 H-05).
  async reportContract(input: ReportContractInput, caller: Caller): Promise<AuthorityReportView> {
    const actor = this.staff(caller);
    const agency = required(input.agency, 'agency');
    const reference = required(input.reference, 'reference');
    const note = input.note?.trim() || undefined;
    // The status is read before, and outside, the insert's transaction: the contract row belongs to
    // rentals, which offers a plain read and no lock across modules. This is acceptable because
    // DEFAULTED leads only to RETURNED (contract-states.ts), so a contract that is returned between this
    // read and the insert was still in default when the report was filed, and the report records the
    // default; it changes nothing on the contract either way.
    const status = await this.contracts.statusOf(input.contractId);
    if (status === null)
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Contract not found.');
    if (status !== 'DEFAULTED')
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.CONTRACT_NOT_DEFAULTED,
        `This cannot be done while it is ${status}.`,
      );
    return this.events.transaction(async (tx) => {
      const report = await this.reports.insert(
        {
          contractId: input.contractId,
          agency,
          reference,
          reportedAt: input.reportedAt,
          reportedById: actor.id,
          note,
        },
        tx,
      );
      this.audit(actor, null, 'authority_report.create', report.id, {
        contractId: input.contractId,
        agency,
        reference,
        reportedAt: input.reportedAt,
      });
      return {
        id: report.id,
        incidentId: report.incidentId,
        contractId: report.contractId,
        agency: report.agency,
        reference: report.reference,
        reportedAt: report.reportedAt,
        caseClosedAt: report.caseClosedAt,
      };
    });
  }

  // Sets caseClosedAt once. A REPORTED incident moves to CLOSED when no other report on it is still
  // open (PR #137 review: an incident reported again after a reopen keeps the later case open); an incident a member acknowledged
  // after the report (UC-35 alternative) keeps its state, and a contract report only records the time.
  async closeCase(
    reportId: string,
    input: CloseCaseInput,
    caller: Caller,
  ): Promise<CloseCaseResult> {
    const actor = this.staff(caller);
    notInFuture(input.closedAt, 'closedAt');
    const note = input.note?.trim() || undefined;
    return this.events.transaction(async (tx) => {
      const report = await this.reports.lockById(reportId, tx);
      if (!report)
        throw new DomainException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Authority report not found.',
        );
      if (report.caseClosedAt) throw closed();
      if (input.closedAt < report.reportedAt)
        throw badRequest('closedAt must not be before reportedAt.');
      const updated = await this.reports.closeCase(reportId, input.closedAt, actor.id, tx);
      let incidentState: IncidentState | null = null;
      let organizationId: string | null = null;
      if (report.incidentId) {
        const incident = await this.incidents.lockById(report.incidentId, tx);
        // The foreign key keeps the incident; a missing row is a broken database, not a 404.
        if (!incident) throw new Error(`Authority report ${reportId} has no incident.`);
        organizationId = incident.organizationId;
        incidentState = incident.state;
        // Counted after the incident lock: two closures on one incident serialise there.
        if (
          incident.state === 'REPORTED' &&
          (await this.reports.countOpenOnIncident(incident.id, tx)) === 0
        )
          incidentState = (
            await this.lifecycle.apply(
              incident.id,
              'REPORTED',
              'CLOSED',
              actor,
              { code: 'CASE_CLOSED', at: new Date(), recipients: NO_RECIPIENTS, note },
              tx,
            )
          ).state;
      }
      this.audit(actor, organizationId, 'authority_report.close_case', reportId, {
        caseClosedAt: input.closedAt,
        note,
        incidentState,
      });
      return { id: reportId, caseClosedAt: updated.caseClosedAt!, incidentState };
    });
  }

  // Open cases first, then newest report first (api-design 11, D-059 rule 7). Without the `open`
  // filter a page may span both groups, so the closed group starts where the open one ends.
  async list(query: AuthorityReportListQuery): Promise<PagedResult<AuthorityReportView>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const open: Prisma.AuthorityReportWhereInput = { caseClosedAt: null };
    const done: Prisma.AuthorityReportWhereInput = { caseClosedAt: { not: null } };
    if (query.open !== undefined) {
      const [rows, total] = await this.reports.page(query.open ? open : done, page.skip, page.take);
      return toPagedResult(rows, total, page);
    }
    const [openRows, openTotal] = await this.reports.page(open, page.skip, page.take);
    const [closedRows, closedTotal] = await this.reports.page(
      done,
      Math.max(0, page.skip - openTotal),
      page.take - openRows.length,
    );
    return toPagedResult([...openRows, ...closedRows], openTotal + closedTotal, page);
  }

  // Authority reports are TrekLink work (`authorityReport.manage`); an organization member has none.
  private staff(caller: Caller): StaffActor {
    if (caller.organizationId)
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have access to this.',
      );
    return { kind: 'STAFF', id: caller.id, roles: caller.roles };
  }

  private audit(
    actor: StaffActor,
    organizationId: string | null,
    action: string,
    subjectId: string,
    after: Record<string, unknown>,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId,
      action,
      subjectType: 'AuthorityReport',
      subjectId,
      after,
    } satisfies AuditRecordEvent);
  }
}
