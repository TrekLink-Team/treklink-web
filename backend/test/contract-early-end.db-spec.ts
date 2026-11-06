import {
  AccountType,
  ContractStatus,
  InvoiceKind,
  InvoiceLineType,
  MemberRole,
  PlanType,
} from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { earlyEndCreditOf } from '../src/modules/billing/money';
import { ContractDecisionsService } from '../src/modules/rentals/contract-decisions.service';
import { ReturnService } from '../src/modules/rentals/return.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, RentalFlow, TERM_START } from './db-rental-flow';

// End now on Postgres (rentals task 10.3, REQ-EVT-27, REQ-ERR-17, AC-15, AC-16; billing REQ-EVT-16,
// REQ-STA-03, AC-10; D-097): a monthly contract paid in full is ended early, checked in, and closed with
// the pro-rata credit owed to the organization; the permission rows of migration
// 20261105230000_contract_early_end are read through HTTP. Run only through test:db against a migrated
// disposable database.
const TERM_END = at('2026-12-02T02:00:00.000Z');

interface EnvelopeResult {
  [field: string]: unknown;
  creditVnd?: number;
  returnDueAt?: string;
  earlyEnd?: { endedAt: string };
}
const resultOf = (response: { body: unknown }) =>
  (response.body as { result: EnvelopeResult }).result;

describe('End now: credit, check-in and close (D-097)', () => {
  let flow: RentalFlow;
  let decisions: ContractDecisionsService;
  let returns: ReturnService;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
    decisions = flow.get(ContractDecisionsService);
    returns = flow.get(ReturnService);
    expect(await flow.seededParameters(['rentals.returnGraceHours'])).toEqual({
      'rentals.returnGraceHours': 24,
    });
  });

  afterAll(async () => {
    await flow?.close();
  });

  const creditLines = (contractId: string) =>
    flow.prisma.invoiceLine.findMany({
      where: { invoice: { contractId }, type: InvoiceLineType.EARLY_END_CREDIT },
      include: { invoice: { select: { kind: true } } },
    });

  it('ends a paid monthly contract now, checks it in and closes it with the credit owed back', async () => {
    const { contract, org, tags } = await flow.rented(2);
    const row = await flow.prisma.rentalContract.findUniqueOrThrow({ where: { id: contract.id } });
    const fee = row.monthlyUnitPriceVnd * BigInt(row.quantity);
    const endAt = at('2026-11-10T03:00:00.000Z');

    // REQ-STA-01: a running monthly contract takes no check-in before it is ended.
    expect(await flow.codeOf(returns.checkIn(contract.id, [tags[0]], flow.staff, endAt))).toBe(
      ErrorCode.INVALID_STATE_TRANSITION,
    );

    const ended = await decisions.endNow(
      contract.id,
      { reason: 'Trek finished early', expectedVersion: await flow.version(contract.id) },
      flow.staff,
      endAt,
    );
    const expected = earlyEndCreditOf(fee, { startsAt: TERM_START, endsAt: TERM_END }, endAt);
    expect(expected).toMatchObject({ termDays: 30, usedDays: 9, unusedDays: 21 });
    expect(ended.earlyEnd).toMatchObject({
      creditVnd: expected.creditVnd,
      outstandingVnd: 0n,
      owedToOrganizationVnd: expected.creditVnd,
    });

    const after = await flow.prisma.rentalContract.findUniqueOrThrow({
      where: { id: contract.id },
      include: { terms: true, transitions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    expect(after.status).toBe(ContractStatus.RETURN_DUE);
    expect(after.endsAt).toEqual(endAt);
    expect(after.returnDueAt).toEqual(endAt);
    expect(after.terms.map((term) => term.status)).toEqual(['CLOSED']);
    expect(after.transitions[0]).toMatchObject({
      fromStatus: ContractStatus.ACTIVE,
      toStatus: ContractStatus.RETURN_DUE,
      actorId: flow.staff.id,
      reason: 'Ended early: Trek finished early',
    });

    const lines = await creditLines(contract.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      amountVnd: -expected.creditVnd,
      dueAt: endAt,
      createdById: flow.staff.id,
      invoice: { kind: InvoiceKind.CLOSING },
    });
    expect(lines[0].description).toContain('Trek finished early');

    // The rollover never touches the closed term again.
    await flow.get(TermRolloverJob).run(at('2026-12-03T03:00:00.000Z'));
    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURN_DUE);

    // A second End now on the RETURN_DUE contract is refused and changes nothing (AC-16).
    expect(
      await flow.codeOf(
        decisions.endNow(
          contract.id,
          { reason: 'Again', expectedVersion: await flow.version(contract.id) },
          org.manager,
          endAt,
        ),
      ),
    ).toBe(ErrorCode.INVALID_STATE_TRANSITION);
    expect(await creditLines(contract.id)).toHaveLength(1);

    // The counter checks both units in inside the grace from the end time: RETURNED, no late fee.
    const checkedIn = await returns.checkIn(
      contract.id,
      tags,
      flow.staff,
      at('2026-11-10T05:00:00.000Z'),
    );
    expect(checkedIn).toMatchObject({ returned: 2, total: 2, contractStatus: 'RETURNED' });
    expect(
      await flow.prisma.invoiceLine.count({
        where: { invoice: { contractId: contract.id }, type: InvoiceLineType.LATE_FEE },
      }),
    ).toBe(0);

    // The balance shows the credit owed to the organization (billing api-design 10, REQ-STA-03).
    const balance = await flow.send(org.manager, 'get', `/api/contracts/${contract.id}/balance`);
    expect(balance.status).toBe(200);
    expect(resultOf(balance)).toMatchObject({
      settled: true,
      dueNowVnd: 0,
      dueLaterVnd: 0,
      owedToOrganizationVnd: Number(expected.creditVnd),
    });

    const closed = await returns.close(contract.id, await flow.version(contract.id), flow.staff);
    expect(closed).toMatchObject({ status: ContractStatus.CLOSED });

    // D-097 amended (billing REQ-STA-04, REQ-EVT-17, AC-11, migrations 20261106120000 and 120100): the
    // closing invoice below zero is a credit due, never PAID; Staff mark it refunded with a note.
    const closing = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id, kind: InvoiceKind.CLOSING },
    });
    expect(closing.status).toBe('CREDIT_DUE');
    const detail = await flow.send(org.manager, 'get', `/api/invoices/${closing.id}`);
    expect(resultOf(detail)).toMatchObject({
      status: 'CREDIT_DUE',
      creditDueVnd: Number(expected.creditVnd),
      refund: null,
    });
    const note = { note: 'Bank transfer FT26110600042' };
    // The Manager may not record it (invoice.refund is TrekLink Staff and Admin).
    expect((await flow.send(org.manager, 'post', `/api/invoices/${closing.id}/refund`, note)).status).toBe(
      403,
    );
    const refunded = await flow.send(flow.staff, 'post', `/api/invoices/${closing.id}/refund`, note);
    expect(refunded.status).toBe(200);
    expect(refunded.body).toMatchObject({
      isSuccess: true,
      message: 'Refund recorded',
      result: {
        status: 'REFUNDED',
        refund: { amountVnd: Number(expected.creditVnd), note: note.note, byId: flow.staff.id },
      },
    });
    const owedAfter = await flow.send(org.manager, 'get', `/api/contracts/${contract.id}/balance`);
    expect(resultOf(owedAfter)).toMatchObject({ owedToOrganizationVnd: 0 });
    const again = await flow.send(flow.staff, 'post', `/api/invoices/${closing.id}/refund`, note);
    expect(again.status).toBe(409);
    expect((again.body as { result: { errorCode: string } }).result.errorCode).toBe(
      ErrorCode.INVALID_STATE_TRANSITION,
    );
  });

  it('counts the grace and the late fee from the end time', async () => {
    const { contract, tags } = await flow.rented(1);
    const endAt = at('2026-11-12T03:00:00.000Z');
    await decisions.endNow(
      contract.id,
      { reason: 'Group left the park', expectedVersion: await flow.version(contract.id) },
      flow.staff,
      endAt,
    );

    await returns.checkIn(contract.id, tags, flow.staff, at('2026-11-14T04:00:00.000Z'));

    const late = await flow.prisma.invoiceLine.findMany({
      where: { invoice: { contractId: contract.id }, type: InvoiceLineType.LATE_FEE },
    });
    expect(late).toHaveLength(1);
    expect(late[0].quantity).toBe(3);
  });

  it('gives a day plan no credit', async () => {
    const { contract } = await flow.rented(1, {
      planType: PlanType.DAY,
      dayPlanDays: 7,
      dayPremium: '1.5',
    });
    await decisions.endNow(
      contract.id,
      { reason: 'Weather', expectedVersion: await flow.version(contract.id) },
      flow.staff,
      at('2026-11-03T03:00:00.000Z'),
    );

    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURN_DUE);
    expect(await creditLines(contract.id)).toHaveLength(0);
  });

  it('serves End now and its preview through HTTP to Staff and the own Manager only', async () => {
    const { contract, org } = await flow.rented(1);
    const other = await flow.organization();
    const operatorId = await flow.user(AccountType.ORGANIZATION, 'ORG_OPERATOR');
    await flow.prisma.organizationMember.create({
      data: { userId: operatorId, organizationId: org.id, role: MemberRole.OPERATOR },
    });
    const operator = { id: operatorId, roles: ['ORG_OPERATOR'], organizationId: org.id };
    const path = `/api/contracts/${contract.id}`;

    const preview = await flow.send(org.manager, 'get', `${path}/end-preview`);
    expect(preview.status).toBe(200);
    expect(resultOf(preview)).toMatchObject({ contractId: contract.id, planType: 'MONTHLY' });
    expect(resultOf(preview).creditVnd).toBeGreaterThan(0);
    expect((await flow.send(other.manager, 'get', `${path}/end-preview`)).status).toBe(404);

    const body = { reason: 'Finished', expectedVersion: await flow.version(contract.id) };
    expect((await flow.send(other.manager, 'post', `${path}/end`, body)).status).toBe(404);
    expect((await flow.send(operator, 'post', `${path}/end`, body)).status).toBe(403);
    const blank = await flow.send(org.manager, 'post', `${path}/end`, { ...body, reason: '   ' });
    expect(blank.status).toBe(400);
    const stale = await flow.send(org.manager, 'post', `${path}/end`, {
      ...body,
      expectedVersion: body.expectedVersion - 1,
    });
    expect(resultOf(stale)).toEqual({ errorCode: ErrorCode.STALE_VERSION });

    const ended = await flow.send(org.manager, 'post', `${path}/end`, body);
    expect(ended.status).toBe(200);
    expect(ended.body).toMatchObject({
      isSuccess: true,
      statusCode: 200,
      message: 'Contract ended. Check the units in at the counter.',
      result: { status: 'RETURN_DUE', earlyEnd: { reason: 'Finished' } },
    });
    expect(resultOf(ended).returnDueAt).toBe(resultOf(ended).earlyEnd?.endedAt);

    const again = await flow.send(flow.staff, 'post', `${path}/end`, {
      ...body,
      expectedVersion: await flow.version(contract.id),
    });
    expect(again.status).toBe(409);
    expect(resultOf(again)).toEqual({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
  });
});
