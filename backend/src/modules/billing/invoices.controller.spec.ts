import { InvoiceKind, InvoiceStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { BillingReadsService } from './billing-reads.service';
import { InvoiceRefundDto } from './dto/billing-queries.dto';
import { InvoicesController, toInvoiceView } from './invoices.controller';
import { PaymentsService } from './payments.service';

const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const AT = new Date('2026-11-06T03:00:00.000Z');
const ROW = {
  id: 'inv-9',
  number: 'INV-2026-000009',
  organizationId: 'org-1',
  contractId: 'c-1',
  termId: null,
  kind: InvoiceKind.CLOSING,
  status: InvoiceStatus.CREDIT_DUE,
  totalVnd: -720_000n,
  paidVnd: 0n,
  issuedAt: AT,
  refundedVnd: null,
  refundedAt: null,
  refundedById: null,
  refundNote: null,
};

const metadataOf = (key: string, method: keyof InvoicesController): unknown =>
  Reflect.getMetadata(key, InvoicesController.prototype[method]);

// billing api-design 08, 09 and 23 (D-097 amended, design section 11.4).
describe('InvoicesController credit due and refund', () => {
  it('returns the credit due and no refund on a CREDIT_DUE invoice', () => {
    expect(
      toInvoiceView({ row: ROW, contract: null, termSeq: null, creditDueVnd: 720_000n }),
    ).toMatchObject({
      status: 'CREDIT_DUE',
      totalVnd: -720_000,
      creditDueVnd: 720_000,
      refund: null,
    });
  });

  it('marks the invoice refunded through the service and returns the refund', async () => {
    const refunded = {
      ...ROW,
      status: InvoiceStatus.REFUNDED,
      refundedVnd: 720_000n,
      refundedAt: AT,
      refundedById: 'u-staff',
      refundNote: 'Bank transfer FT26110600042',
    };
    const payments = { markRefunded: jest.fn().mockResolvedValue(refunded) };
    const controller = new InvoicesController(
      {} as BillingReadsService,
      payments as unknown as PaymentsService,
    );
    const view = await controller.refund('inv-9', { note: 'Bank transfer FT26110600042' }, STAFF);
    expect(payments.markRefunded).toHaveBeenCalledWith(
      'inv-9',
      'Bank transfer FT26110600042',
      STAFF,
    );
    expect(view).toMatchObject({
      status: 'REFUNDED',
      creditDueVnd: null,
      refund: { amountVnd: 720_000, at: AT, note: 'Bank transfer FT26110600042', byId: 'u-staff' },
    });
  });

  it('asks refund on Invoice and answers "Refund recorded"', () => {
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    const handlers = metadataOf(CHECK_POLICIES_KEY, 'refund') as PolicyHandler[];
    expect(handlers.every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith('refund', 'Invoice');
    expect(metadataOf(RESPONSE_MESSAGE_KEY, 'refund')).toBe('Refund recorded');
  });

  it('requires a note of 1 to 500 characters, trimmed', async () => {
    const errorsOf = async (body: object) =>
      (await validate(plainToInstance(InvoiceRefundDto, body))).map((error) => error.property);
    expect(await errorsOf({ note: 'Bank transfer FT26110600042' })).toEqual([]);
    expect(await errorsOf({ note: '   ' })).toEqual(['note']);
    expect(await errorsOf({})).toEqual(['note']);
    expect(await errorsOf({ note: 'x'.repeat(501) })).toEqual(['note']);
  });
});
