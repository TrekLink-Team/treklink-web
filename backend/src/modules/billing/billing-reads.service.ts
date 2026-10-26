import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { BalanceService, BalanceSummary } from './balance.service';
import { InvoiceDetailRow, InvoiceRow, InvoicesRepository } from './invoices.repository';
import { PaymentRow, PaymentsRepository } from './payments.repository';
import {
  CONTRACT_DIRECTORY,
  ContractDirectory,
  ContractLabel,
} from './ports/contract-directory.port';

export interface InvoiceQuery extends PagedQueryDto {
  contractId?: string;
  status?: InvoiceStatus;
  overdue?: boolean;
}

export interface PaymentQuery extends PagedQueryDto {
  contractId?: string;
  status?: PaymentStatus;
}

// What a list or detail row shows besides its own columns: the contract code, the organization code
// and the term sequence, from the `rentals` directory (ports/contract-directory.port.ts).
export interface Labelled<T> {
  row: T;
  contract: ContractLabel | null;
  termSeq: number | null;
}

export interface InvoiceDetail extends Labelled<InvoiceDetailRow> {
  payments: PaymentRow[];
}

const notFound = (message: string) =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message);

// A member reads only its own organization's rows; a TrekLink account reads every organization's
// (FR-AUTH-11, BR-19). The organization comes from the verified token, never the request.
const ownOrganization = (caller: Caller): string | undefined => caller.organizationId ?? undefined;

// The scoped 404 rule (REQ-ERR-06): another organization's row answers as if it did not exist.
const visibleTo = (caller: Caller, organizationId: string): boolean =>
  caller.organizationId === null || caller.organizationId === organizationId;

// Invoice, payment and balance reads (billing task 4.1, api-design 08, 09, 10, 14).
@Injectable()
export class BillingReadsService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly payments: PaymentsRepository,
    private readonly balances: BalanceService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(CONTRACT_DIRECTORY) private readonly directory?: ContractDirectory,
  ) {}

  async invoicePage(
    query: InvoiceQuery,
    caller: Caller,
    at: Date = new Date(),
  ): Promise<PagedResult<Labelled<InvoiceRow>>> {
    const page = this.page(query);
    const [rows, total] = await this.invoices.page(
      {
        organizationId: ownOrganization(caller),
        contractId: query.contractId,
        status: query.status,
        overdueAt: query.overdue ? at : undefined,
      },
      page.skip,
      page.take,
    );
    return toPagedResult(await this.label(rows), total, page);
  }

  async invoice(id: string, caller: Caller): Promise<InvoiceDetail> {
    const row = await this.invoices.detail(id);
    if (!row || !visibleTo(caller, row.organizationId)) throw notFound('Invoice not found.');
    const [labelled] = await this.label([row]);
    return { ...labelled, payments: await this.payments.ofInvoice(id) };
  }

  async paymentPage(query: PaymentQuery, caller: Caller): Promise<PagedResult<PaymentRow>> {
    const page = this.page(query);
    const [rows, total] = await this.payments.page(
      {
        organizationId: ownOrganization(caller),
        contractId: query.contractId,
        status: query.status,
      },
      page.skip,
      page.take,
    );
    return toPagedResult(rows, total, page);
  }

  // A contract without an invoice yet has nothing to sum, so it answers zeros; its organization is
  // checked once an invoice exists. Pending damage charges wait on a contract link (billing 2.4).
  async balance(contractId: string, caller: Caller): Promise<BalanceSummary> {
    const organizationId = await this.invoices.organizationOfContract(contractId);
    if (organizationId !== null && !visibleTo(caller, organizationId)) {
      throw notFound('Contract not found.');
    }
    return this.balances.balanceSummary(contractId);
  }

  private page(query: PagedQueryDto) {
    return resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
  }

  private async label<T extends InvoiceRow>(rows: T[]): Promise<Labelled<T>[]> {
    const termIds = rows.flatMap((row) => (row.termId ? [row.termId] : []));
    const found =
      this.directory && rows.length > 0
        ? await this.directory.describe([...new Set(rows.map((row) => row.contractId))], termIds)
        : { contracts: new Map<string, ContractLabel>(), termSeqs: new Map<string, number>() };
    return rows.map((row) => ({
      row,
      contract: found.contracts.get(row.contractId) ?? null,
      termSeq: row.termId ? (found.termSeqs.get(row.termId) ?? null) : null,
    }));
  }
}
