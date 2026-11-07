import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedResult } from '../../common/dto/paging';
import { BillingReadsService, InvoiceDetail, Labelled } from './billing-reads.service';
import {
  CounterPaymentDto,
  InvoiceQueryDto,
  InvoiceRefundDto,
  PaymentQueryDto,
} from './dto/billing-queries.dto';
import { InvoiceRow } from './invoices.repository';
import { PaymentRow } from './payments.repository';
import { PaymentsService } from './payments.service';
import { netUnitReleaseAdjustments } from './release-adjustments';

// A JSON body cannot hold a bigint; every VND amount here is far below Number.MAX_SAFE_INTEGER.
const vnd = (amount: bigint): number => Number(amount);

export const toInvoiceView = ({ row, contract, termSeq, creditDueVnd }: Labelled<InvoiceRow>) => ({
  id: row.id,
  number: row.number,
  organization: { id: row.organizationId, code: contract?.organizationCode ?? null },
  contract: { id: row.contractId, code: contract?.code ?? null },
  kind: row.kind,
  term: termSeq === null ? null : { seq: termSeq },
  status: row.status,
  totalVnd: vnd(row.totalVnd),
  paidVnd: vnd(row.paidVnd),
  // D-097 amended (design section 11.4): what TrekLink owes on a CREDIT_DUE invoice, and its refund.
  creditDueVnd: creditDueVnd === null ? null : vnd(creditDueVnd),
  refund:
    row.refundedVnd === null || row.refundedAt === null
      ? null
      : {
          amountVnd: vnd(row.refundedVnd),
          at: row.refundedAt,
          note: row.refundNote,
          byId: row.refundedById,
        },
  issuedAt: row.issuedAt,
});

export const toPaymentView = (payment: PaymentRow) => ({
  id: payment.id,
  reference: payment.reference,
  invoiceId: payment.invoiceId,
  contractId: payment.contractId,
  amountVnd: vnd(payment.amountVnd),
  method: payment.method,
  status: payment.status,
  isSandbox: payment.isSandbox,
  expiresAt: payment.expiresAt,
  confirmedAt: payment.confirmedAt,
});

// The detail adds the document blocks of screen 6.1: the buyer's registered identity on
// `organization` and TrekLink's on `seller`. A buyer the directory cannot name reads as nulls.
export const toInvoiceDetailView = (detail: InvoiceDetail) => {
  const invoice = toInvoiceView(detail);
  const payable = netUnitReleaseAdjustments(detail.row.lines);
  return {
    ...invoice,
    organization: {
      ...invoice.organization,
      legalName: detail.buyer?.legalName ?? null,
      taxCode: detail.buyer?.taxCode ?? null,
      address: detail.buyer?.address ?? null,
    },
    seller: detail.seller,
    lines: detail.row.lines.map((line, index) => ({
      seq: line.seq,
      type: line.type,
      description: line.description,
      quantity: line.quantity,
      unitVnd: vnd(line.unitVnd),
      amountVnd: vnd(line.amountVnd),
      ...(line.amountVnd >= 0n && payable[index].amountVnd !== line.amountVnd
        ? { payableAmountVnd: vnd(payable[index].amountVnd) }
        : {}),
      dueAt: line.dueAt,
      paidVnd: vnd(line.paidVnd),
    })),
    payments: detail.payments.map(toPaymentView),
  };
};

// Invoices, payments and the contract balance (billing task 5.1 part, api-design 08, 09, 10, 13,
// 14). Org Manager reads its own organization's rows (`invoice.read.own`); TrekLink Staff and Admin
// read every organization's and record counter payments. SePay (11, 12, 15) joins with task 3.2.
@Controller()
export class InvoicesController {
  constructor(
    private readonly reads: BillingReadsService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('invoices')
  @CheckPolicies((ability) => ability.can('read', 'Invoice'))
  @ResponseMessage('OK')
  async list(
    @Query() query: InvoiceQueryDto,
    @CurrentCaller() caller: Caller,
  ): Promise<PagedResult<ReturnType<typeof toInvoiceView>>> {
    const page = await this.reads.invoicePage(query, caller);
    return { ...page, items: page.items.map(toInvoiceView) };
  }

  @Get('invoices/:id')
  @CheckPolicies((ability) => ability.can('read', 'Invoice'))
  @ResponseMessage('OK')
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return toInvoiceDetailView(await this.reads.invoice(id, caller));
  }

  @Get('contracts/:id/balance')
  @CheckPolicies((ability) => ability.can('read', 'Invoice'))
  @ResponseMessage('OK')
  async balance(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    const summary = await this.reads.balance(id, caller);
    return {
      contractId: summary.contractId,
      dueNowVnd: vnd(summary.dueNowVnd),
      dueLaterVnd: vnd(summary.dueLaterVnd),
      paidVnd: vnd(summary.paidVnd),
      pendingDamageCharges: summary.pendingDamageCharges.map((charge) => ({
        id: charge.id,
        deviceId: charge.deviceId,
        damageCodes: charge.damageCodes,
        amountVnd: vnd(charge.amountVnd),
        createdAt: charge.createdAt,
      })),
      settled: summary.settled,
      owedToOrganizationVnd: vnd(summary.owedToOrganizationVnd),
    };
  }

  // The envelope message is static; the page shows MSG20 with the amount from the result.
  @Post('invoices/:id/payments/counter')
  @CheckPolicies((ability) => ability.can('recordCounter', 'Invoice'))
  @ResponseMessage('Payment received.')
  async recordCounter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CounterPaymentDto,
    @CurrentCaller() caller: Caller,
  ) {
    const payment = await this.payments.recordCounter(
      id,
      { method: dto.method, amountVnd: BigInt(dto.amountVnd), reference: dto.reference.trim() },
      caller,
    );
    return toPaymentView(payment);
  }

  // REQ-EVT-17 (api-design 23, D-097 amended): Staff record the refund of a credit due made outside TrekLink.
  @Post('invoices/:id/refund')
  @HttpCode(200)
  @CheckPolicies((ability) => ability.can('refund', 'Invoice'))
  @ResponseMessage('Refund recorded')
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceRefundDto,
    @CurrentCaller() caller: Caller,
  ) {
    const row = await this.payments.markRefunded(id, dto.note, caller);
    return toInvoiceView({ row, contract: null, termSeq: null, creditDueVnd: null });
  }

  @Get('payments')
  @CheckPolicies((ability) => ability.can('read', 'Payment'))
  @ResponseMessage('OK')
  async listPayments(@Query() query: PaymentQueryDto, @CurrentCaller() caller: Caller) {
    const page = await this.reads.paymentPage(query, caller);
    return { ...page, items: page.items.map(toPaymentView) };
  }
}
