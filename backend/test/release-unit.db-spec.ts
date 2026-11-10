import {
  DeviceStatus,
  InvoiceLineType,
  PaymentMethod,
  ServiceCreditKind,
  ServiceCreditStatus,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BalanceService } from '../src/modules/billing/balance.service';
import { PaymentsService } from '../src/modules/billing/payments.service';
import { SepayService } from '../src/modules/billing/sepay.service';
import { ServiceCreditService } from '../src/modules/billing/service-credit.service';
import {
  DEVICE_GROUP_CHANGED,
  type DeviceGroupChangedEvent,
} from '../src/modules/rentals/groups.service';
import { ReleaseService } from '../src/modules/rentals/release.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, RentalFlow } from './db-rental-flow';

// Release a unit (rentals task 13.3, AC-19 to AC-22; billing AC-13, AC-14; D-099) against Postgres, through
// the real services and the Staff and Org Manager HTTP paths of AppModule (test/db-rental-flow.ts). A rented
// contract's term runs from 2 November 02:00 UTC to 2 December 02:00 UTC, 30 days.
describe('release a unit against Postgres (AC-19 to AC-22)', () => {
  let flow: RentalFlow;
  let releases: ReleaseService;
  const reason = 'The group shrank';

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
    releases = flow.get(ReleaseService);
  });

  afterAll(async () => {
    await flow?.close();
  });

  const approvedWithHeldUnit = async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    await flow.availableDevices(variantId, 5);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
    await flow.approve(contract.id);
    const invoice = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id },
      orderBy: { issuedAt: 'asc' },
    });
    const held = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: contract.id, releasedAt: null },
    });
    return { contract, invoice, held, org };
  };

  it('AC-19, AC-13: a running unit released on day 10 is back, the quantity drops, and the approved credit lands on term 2', async () => {
    const { contract, deviceIds } = await flow.rented(5);
    const released = await releases.release(
      contract.id,
      deviceIds[0],
      { reason, expectedVersion: await flow.version(contract.id) },
      flow.staff,
      at('2026-11-12T02:00:00.000Z'),
    );
    expect(released.contract.quantity).toBe(4);
    expect(released.credit).toMatchObject({ computedVnd: 300_000n, unusedDays: 20, termDays: 30 });
    await expect(
      flow.prisma.device.findUniqueOrThrow({ where: { id: deviceIds[0] } }),
    ).resolves.toMatchObject({ status: DeviceStatus.RETURNED });
    await expect(
      flow.prisma.contractDevice.findFirstOrThrow({
        where: { contractId: contract.id, deviceId: deviceIds[0] },
      }),
    ).resolves.toMatchObject({ checkedInAt: at('2026-11-12T02:00:00.000Z'), releasedAt: null });

    const credit = await flow.prisma.serviceCredit.findUniqueOrThrow({
      where: { id: released.credit!.id },
    });
    expect(credit).toMatchObject({
      kind: ServiceCreditKind.RELEASE,
      status: ServiceCreditStatus.REQUESTED,
      requestedById: flow.staff.id,
      cause: null,
    });
    // The releasing Staff member is not an Admin; another Admin decides.
    await flow
      .get(ServiceCreditService)
      .decide(
        credit.id,
        { decision: 'APPROVE', expectedVersion: credit.version },
        await flow.admin(),
        at('2026-11-13T02:00:00.000Z'),
      );

    await flow.get(TermRolloverJob).run(at('2026-12-02T03:00:00.000Z'));
    const term2 = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id, term: { seq: 2 } },
      select: {
        totalVnd: true,
        lines: { select: { type: true, amountVnd: true, description: true, quantity: true } },
      },
    });
    // 4 units at 450,000 VND, less the 300,000 VND release credit
    expect(term2.totalVnd).toBe(1_800_000n - 300_000n);
    expect(term2.lines).toContainEqual(
      expect.objectContaining({ type: InvoiceLineType.EARLY_END_CREDIT, amountVnd: -300_000n }),
    );
  });

  it('AC-20: a release may go below the minimum, and the last unit is refused', async () => {
    const { contract, deviceIds } = await flow.rented(5);
    for (const deviceId of deviceIds.slice(0, 4)) {
      await releases.release(
        contract.id,
        deviceId,
        { reason, expectedVersion: await flow.version(contract.id) },
        flow.staff,
        at('2026-11-12T02:00:00.000Z'),
      );
    }
    await expect(
      flow.prisma.rentalContract.findUniqueOrThrow({ where: { id: contract.id } }),
    ).resolves.toMatchObject({ quantity: 1 });
    expect(
      await flow.codeOf(
        releases.release(
          contract.id,
          deviceIds[4],
          { reason, expectedVersion: await flow.version(contract.id) },
          flow.staff,
        ),
      ),
    ).toBe('LAST_UNIT');
  });

  it.each([
    { payment: 'holding fee', paidVnd: 1_125_000, owedVnd: 0, outstandingVnd: 675_000n },
    { payment: 'full invoice', paidVnd: 2_250_000, owedVnd: 450_000, outstandingVnd: 0n },
  ])(
    'AC-21, AC-14: Staff release a held unit over HTTP with the $payment paid',
    async ({ paidVnd, owedVnd, outstandingVnd }) => {
      const { contract, invoice: firstInvoice, held } = await approvedWithHeldUnit();
      await flow.get(PaymentsService).recordCounter(
        firstInvoice.id,
        {
          method: PaymentMethod.CASH,
          amountVnd: BigInt(paidVnd),
          reference: `RELEASE-${flow.next()}`,
        },
        flow.staff,
        at('2026-11-02T00:30:00.000Z'),
      );
      const path = `/api/contracts/${contract.id}/devices/${held.deviceId}`;
      const preview = await flow.send(flow.staff, 'get', `${path}/release-preview`);
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        result: {
          firstInvoice: {
            totalVnd: 2_250_000,
            paidVnd,
            newTotalVnd: 1_800_000,
            owedToOrganizationVnd: owedVnd,
          },
        },
      });

      const version = await flow.version(contract.id);
      const released = await flow.send(flow.staff, 'post', `${path}/release`, {
        reason,
        expectedVersion: version,
      });
      expect(released.status).toBe(200);
      expect(released.body).toMatchObject({
        result: {
          contract: { id: contract.id, quantity: 4, version: version + 1 },
          firstInvoiceLoweredByVnd: 450_000,
        },
      });
      await expect(
        flow.prisma.device.findUniqueOrThrow({ where: { id: held.deviceId } }),
      ).resolves.toMatchObject({ status: DeviceStatus.AVAILABLE });
      const first = await flow.prisma.invoice.findUniqueOrThrow({
        where: { id: firstInvoice.id },
        include: { lines: { where: { type: InvoiceLineType.ADJUSTMENT } } },
      });
      expect(first.totalVnd).toBe(1_800_000n);
      expect(first.paidVnd).toBe(BigInt(paidVnd));
      expect(first.lines.map((line) => line.amountVnd)).toEqual([-225_000n, -225_000n]);
      const balance = await flow.get(BalanceService).balanceSummary(contract.id);
      expect(balance.dueNowVnd + balance.dueLaterVnd).toBe(outstandingVnd);
      expect(balance.owedToOrganizationVnd).toBe(BigInt(owedVnd));
    },
  );

  it('billing AC-15: reissues the unpaid deposit for SePay and the handover gate', async () => {
    const { contract, invoice, held, org } = await approvedWithHeldUnit();
    const beforeStart = at('2026-11-02T00:30:00Z');
    await releases.release(
      contract.id,
      held.deviceId,
      { reason, expectedVersion: await flow.version(contract.id) },
      flow.staff,
      beforeStart,
    );
    const balance = flow.get(BalanceService);
    await expect(balance.firstPaymentConfirmed(contract.id)).resolves.toBe(false);
    await expect(
      flow.get(SepayService).request(invoice.id, undefined, org.manager, beforeStart),
    ).resolves.toMatchObject({ amountVnd: 900_000n });
    const detail = await flow.send(org.manager, 'get', `/api/invoices/${invoice.id}`);
    expect(detail.status).toBe(200);
    const { result } = detail.body as { result: { lines: unknown[] } };
    expect(result.lines).toContainEqual(
      expect.objectContaining({
        type: InvoiceLineType.HOLDING_FEE,
        amountVnd: 1_125_000,
        payableAmountVnd: 900_000,
      }),
    );

    const pay = (amountVnd: bigint) =>
      flow
        .get(PaymentsService)
        .recordCounter(
          invoice.id,
          { method: PaymentMethod.CASH, amountVnd, reference: `RELEASE-${flow.next()}` },
          flow.staff,
          beforeStart,
        );
    await pay(899_999n);
    await expect(balance.firstPaymentConfirmed(contract.id)).resolves.toBe(false);
    await pay(1n);
    await expect(balance.firstPaymentConfirmed(contract.id)).resolves.toBe(true);
    await expect(balance.outstanding(contract.id)).resolves.toBe(900_000n);
  });

  it('AC-22: an Org Manager gets 403, and two releases with one version leave one STALE_VERSION', async () => {
    const { contract, deviceIds, org } = await flow.rented(5);
    const response = await flow.send(
      org.manager,
      'post',
      `/api/contracts/${contract.id}/devices/${deviceIds[0]}/release`,
      { reason, expectedVersion: await flow.version(contract.id) },
    );
    expect(response.status).toBe(403);

    const version = await flow.version(contract.id);
    const codes = await Promise.all(
      [deviceIds[1], deviceIds[2]].map((deviceId) =>
        flow.codeOf(
          releases.release(contract.id, deviceId, { reason, expectedVersion: version }, flow.staff),
        ),
      ),
    );
    expect(codes.sort()).toEqual([null, 'STALE_VERSION'].sort());
  });

  // Rentals task 9.3 (AC-10, AC-13, REQ-EVT-22, REQ-EVT-23): the release is a caller of closeCustody, so a
  // released unit leaves its group and its open fault report is resolved, in the release's transaction, and
  // the group change reaches the stream only after the commit.
  it('9.3: a release through HTTP ends the group assignment and resolves the fault report, a refused one leaves both open', async () => {
    const { contract, deviceIds, org } = await flow.rented(5);
    const [deviceId, otherId] = deviceIds;
    const grouped = await flow.send(org.manager, 'post', '/api/groups', { name: 'Ridge team' });
    expect(grouped.status).toBe(201);
    const groupId = (grouped.body as { result: { id: string } }).result.id;
    const assigned = await flow.send(org.manager, 'post', `/api/groups/${groupId}/devices`, {
      deviceIds: [deviceId, otherId],
    });
    expect(assigned.status).toBe(200);
    for (const id of [deviceId, otherId]) {
      const reported = await flow.send(
        org.manager,
        'post',
        `/api/contracts/${contract.id}/devices/${id}/fault-reports`,
        { description: 'The radio drops out' },
      );
      expect(reported.status).toBe(201);
    }

    const changes: DeviceGroupChangedEvent[] = [];
    const listener = (event: DeviceGroupChangedEvent) => changes.push(event);
    const emitter = flow.get(EventEmitter2);
    emitter.on(DEVICE_GROUP_CHANGED, listener);
    try {
      const path = (id: string) => `/api/contracts/${contract.id}/devices/${id}/release`;
      const version = await flow.version(contract.id);
      const stale = await flow.send(flow.staff, 'post', path(otherId), {
        reason,
        expectedVersion: version - 1,
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ result: { errorCode: 'STALE_VERSION' } });

      const released = await flow.send(flow.staff, 'post', path(deviceId), {
        reason,
        expectedVersion: version,
      });
      expect(released.status).toBe(200);
      const row = await flow.prisma.contractDevice.findFirstOrThrow({
        where: { contractId: contract.id, deviceId },
      });
      expect(row.checkedInAt).not.toBeNull();

      await expect(
        flow.prisma.groupAssignment.findFirstOrThrow({ where: { deviceId, groupId } }),
      ).resolves.toMatchObject({ endedReason: 'RELEASED', endedAt: row.checkedInAt });
      await expect(
        flow.prisma.deviceFaultReport.findFirstOrThrow({ where: { contractDeviceId: row.id } }),
      ).resolves.toMatchObject({ resolution: 'RELEASED', resolvedAt: row.checkedInAt });
      expect(changes).toEqual([{ organizationId: org.id, deviceId, group: null }]);

      // The refused release changed nothing on the other unit.
      await expect(
        flow.prisma.groupAssignment.findFirstOrThrow({ where: { deviceId: otherId, groupId } }),
      ).resolves.toMatchObject({ endedAt: null, endedReason: null });
      await expect(
        flow.prisma.deviceFaultReport.findFirstOrThrow({
          where: { contractId: contract.id, deviceId: otherId },
        }),
      ).resolves.toMatchObject({ resolvedAt: null, resolution: null });
    } finally {
      emitter.off(DEVICE_GROUP_CHANGED, listener);
    }
  });
});
