import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CounterPaymentDto,
  InvoiceQueryDto,
  InvoiceRefundDto,
  PaymentQueryDto,
  SepayPaymentDto,
} from './billing-queries.dto';
import { DamageChargeQueryDto, DamageDecisionDto } from './damage-charges.dto';
import {
  DamageRatePatchDto,
  DamageRateQueryDto,
  NewDamageRateDto,
  NewPriceDto,
  PriceHistoryQueryDto,
} from './pricing-admin.dto';
import { QuoteDto } from './quote.dto';
import {
  ServiceCreditDecisionDto,
  ServiceCreditQueryDto,
  ServiceCreditRefundDto,
  ServiceCreditRequestDto,
} from './service-credits.dto';

const ID = 'b3541f2a-cd1d-4dfa-a623-a1ce0783816a';
const errorsOf = async <T extends object>(type: ClassConstructor<T>, body: object) =>
  (
    await validate(plainToInstance(type, body), { whitelist: true, forbidNonWhitelisted: true })
  ).map((error) => error.property);

describe('Billing query and payment validation coverage', () => {
  it.each(['true', 'false', true, false])(
    'transforms overdue %s into a boolean',
    async (overdue) => {
      const dto = plainToInstance(InvoiceQueryDto, {
        overdue,
        from: '2026-11-01',
        to: '2026-12-01',
        contractId: ID,
        hardwareVariantId: ID,
        status: 'ISSUED',
        sort: 'issuedAt',
        order: 'asc',
      });
      expect(dto.overdue).toBe(overdue === true || overdue === 'true');
      expect(dto.from).toEqual(new Date('2026-11-01'));
      expect(dto.to).toEqual(new Date('2026-12-01'));
      expect(await validate(dto)).toEqual([]);
    },
  );
  it.each([
    { overdue: 'yes' },
    { from: 'bad' },
    { to: 'bad' },
    { contractId: 'bad' },
    { hardwareVariantId: 'bad' },
    { status: 'bad' },
    { sort: 'password' },
    { order: 'up' },
  ])('rejects malformed invoice filters %j', async (body) => {
    expect(await errorsOf(InvoiceQueryDto, body)).toEqual(Object.keys(body));
  });
  it('validates payment filters and the optional positive line sequence', async () => {
    expect(await errorsOf(PaymentQueryDto, { contractId: ID, status: 'PENDING' })).toEqual([]);
    expect(await errorsOf(PaymentQueryDto, { contractId: 'bad', status: 'bad' })).toEqual([
      'contractId',
      'status',
    ]);
    expect(await errorsOf(SepayPaymentDto, {})).toEqual([]);
    expect(await errorsOf(SepayPaymentDto, { lineSeq: 1 })).toEqual([]);
  });
  it.each([0, -1, 1.5, '1'])('rejects invalid line sequence %s', async (lineSeq) => {
    expect(await errorsOf(SepayPaymentDto, { lineSeq })).toEqual(['lineSeq']);
  });
  it.each(['CASH', 'BANK_TRANSFER'])('accepts counter method %s', async (method) => {
    expect(
      await errorsOf(CounterPaymentDto, { method, amountVnd: 1, reference: 'R'.repeat(64) }),
    ).toEqual([]);
  });
  it.each([
    { method: 'SEPAY' },
    { amountVnd: 0 },
    { amountVnd: 1.5 },
    { amountVnd: '1' },
    { reference: '' },
    { reference: 'x'.repeat(65) },
  ])('rejects malformed counter receipt %j', async (change) => {
    expect(
      await errorsOf(CounterPaymentDto, {
        method: 'CASH',
        amountVnd: 1,
        reference: 'R',
        ...change,
      }),
    ).toEqual(Object.keys(change));
  });
  it('trims refund notes and rejects non-string notes', async () => {
    expect(plainToInstance(InvoiceRefundDto, { note: ' paid ' }).note).toBe('paid');
    expect(await errorsOf(InvoiceRefundDto, { note: 12 })).toEqual(['note']);
  });
});

describe('Damage decision validation coverage', () => {
  it.each(['APPROVED', 'WAIVED'])('does not require a reduced amount for %s', async (decision) => {
    expect(await errorsOf(DamageDecisionDto, { decision, note: ' reason ' })).toEqual([]);
  });
  it('requires a positive integer for a reduced decision and trims its note', async () => {
    expect(
      await errorsOf(DamageDecisionDto, { decision: 'REDUCED', finalVnd: 1, note: 'reason' }),
    ).toEqual([]);
    for (const finalVnd of [undefined, 0, 1.5])
      expect(
        await errorsOf(DamageDecisionDto, { decision: 'REDUCED', finalVnd, note: 'reason' }),
      ).toEqual(['finalVnd']);
    expect(plainToInstance(DamageDecisionDto, { note: ' reason ' }).note).toBe('reason');
  });
  it.each(['', ' ', 12, 'x'.repeat(501)])('rejects invalid decision note %s', async (note) => {
    expect(await errorsOf(DamageDecisionDto, { decision: 'APPROVED', note })).toEqual(['note']);
  });
  it('validates the damage queue enum and contract id', async () => {
    expect(
      await errorsOf(DamageChargeQueryDto, { contractId: ID, status: 'PENDING_APPROVAL' }),
    ).toEqual([]);
    expect(await errorsOf(DamageChargeQueryDto, { status: 'bad', contractId: 'bad' })).toEqual([
      'status',
      'contractId',
    ]);
  });
});

describe('Pricing DTO validation coverage', () => {
  const rate = { code: 'STRAP_TORN', label: ' Strap torn ', amountVnd: 1 };
  it.each([undefined, null, ID])(
    'accepts generic and variant rates %s',
    async (hardwareVariantId) => {
      const dto = plainToInstance(NewDamageRateDto, { ...rate, hardwareVariantId });
      expect(await validate(dto)).toEqual([]);
      expect(dto.label).toBe('Strap torn');
    },
  );
  it.each([
    { code: 'lower' },
    { label: 42 },
    { label: 'x'.repeat(121) },
    { amountVnd: 0 },
    { amountVnd: 1.5 },
    { hardwareVariantId: 'bad' },
  ])('rejects malformed damage rates %j', async (change) => {
    expect(await errorsOf(NewDamageRateDto, { ...rate, ...change })).toEqual(Object.keys(change));
  });
  it('trims patch labels, preserves false and validates every patched field', async () => {
    const dto = plainToInstance(DamageRatePatchDto, {
      label: ' Fixed ',
      isActive: false,
      amountVnd: 1,
    });
    expect(dto.label).toBe('Fixed');
    expect(await validate(dto)).toEqual([]);
    expect(
      await errorsOf(DamageRatePatchDto, { label: 5, isActive: 'false', amountVnd: 0 }),
    ).toEqual(['label', 'amountVnd', 'isActive']);
  });
  it('validates price schedules and history filters', async () => {
    const price = {
      hardwareVariantId: ID,
      monthlyPriceVnd: 1,
      effectiveFrom: '2026-11-20T00:00:00Z',
    };
    expect(await errorsOf(NewPriceDto, price)).toEqual([]);
    expect(
      await errorsOf(NewPriceDto, {
        hardwareVariantId: 'bad',
        monthlyPriceVnd: 0,
        effectiveFrom: 'bad',
      }),
    ).toEqual(['hardwareVariantId', 'monthlyPriceVnd', 'effectiveFrom']);
    for (const type of [PriceHistoryQueryDto, DamageRateQueryDto]) {
      expect(await errorsOf(type, { hardwareVariantId: ID })).toEqual([]);
      expect(await errorsOf(type, { hardwareVariantId: 'bad' })).toEqual(['hardwareVariantId']);
    }
  });
  it('requires day lengths only for day plans and enforces quote bounds', async () => {
    const quote = { hardwareVariantId: ID, quantity: 1 };
    expect(await errorsOf(QuoteDto, { ...quote, planType: 'MONTHLY' })).toEqual([]);
    expect(await errorsOf(QuoteDto, { ...quote, planType: 'DAY', dayPlanDays: 3 })).toEqual([]);
    expect(await errorsOf(QuoteDto, { ...quote, planType: 'DAY' })).toEqual(['dayPlanDays']);
    expect(
      await errorsOf(QuoteDto, { ...quote, planType: 'DAY', dayPlanDays: 0, quantity: 10001 }),
    ).toEqual(['dayPlanDays', 'quantity']);
  });
});

describe('Service credit DTO validation coverage', () => {
  const request = { contractDeviceId: ID, cause: 'BATTERY_FAULT', faultInspectionId: ID };
  it('converts outage dates and trims notes while accepting source identifiers', async () => {
    const dto = plainToInstance(ServiceCreditRequestDto, {
      ...request,
      outageFrom: '2026-11-01',
      outageSourceIncidentId: ID,
      outageSourceFaultReportId: ID,
      outageSourceNote: ' reported ',
    });
    expect(dto.outageFrom).toEqual(new Date('2026-11-01'));
    expect(dto.outageSourceNote).toBe('reported');
    expect(await validate(dto)).toEqual([]);
    expect(await errorsOf(ServiceCreditRequestDto, request)).toEqual([]);
  });
  it.each([
    { cause: 'bad' },
    { outageFrom: 'bad' },
    { outageSourceNote: 1 },
    { outageSourceNote: 'x'.repeat(501) },
    { faultInspectionId: 'bad' },
  ])('rejects malformed credit requests %j', async (change) => {
    expect(await errorsOf(ServiceCreditRequestDto, { ...request, ...change })).toEqual(
      Object.keys(change),
    );
  });
  it.each(['APPROVE', 'REJECT', 'REDUCE'])(
    'validates decision %s and trims reasons',
    async (decision) => {
      const dto = plainToInstance(ServiceCreditDecisionDto, {
        decision,
        decidedVnd: 1,
        expectedVersion: 1,
        reason: ' reason ',
      });
      expect(dto.reason).toBe('reason');
      expect(await validate(dto)).toEqual([]);
      if (decision === 'REDUCE')
        expect(await errorsOf(ServiceCreditDecisionDto, { decision, expectedVersion: 1 })).toEqual([
          'decidedVnd',
        ]);
    },
  );
  it('rejects invalid decision amounts, versions and reasons', async () => {
    expect(
      await errorsOf(ServiceCreditDecisionDto, {
        decision: 'REDUCE',
        decidedVnd: 0,
        expectedVersion: 0,
        reason: 42,
      }),
    ).toEqual(['decidedVnd', 'reason', 'expectedVersion']);
    expect(
      await errorsOf(ServiceCreditDecisionDto, { decision: 'bad', expectedVersion: 1 }),
    ).toEqual(['decision']);
  });
  it('trims refund references and requires a nonempty bounded string', async () => {
    expect(plainToInstance(ServiceCreditRefundDto, { reference: ' R-42 ' }).reference).toBe('R-42');
    expect(await errorsOf(ServiceCreditRefundDto, { reference: 'R'.repeat(100) })).toEqual([]);
    for (const reference of [12, ' ', 'R'.repeat(101)])
      expect(await errorsOf(ServiceCreditRefundDto, { reference })).toEqual(['reference']);
  });
  it('validates credit queue status and contract filters', async () => {
    expect(await errorsOf(ServiceCreditQueryDto, { status: 'REQUESTED', contractId: ID })).toEqual(
      [],
    );
    expect(await errorsOf(ServiceCreditQueryDto, { status: 'bad', contractId: 'bad' })).toEqual([
      'status',
      'contractId',
    ]);
  });
});
