import {
  DeviceStatus,
  InvoiceLineType,
  ServiceCreditKind,
  ServiceCreditStatus,
} from '@prisma/client';
import { ServiceCreditService } from '../src/modules/billing/service-credit.service';
import { ReleaseService } from '../src/modules/rentals/release.service';
import { TermRolloverJob } from '../src/modules/rentals/term-rollover.job';
import { at, compileRentalFlow, RentalFlow } from './db-rental-flow';

// Release a unit (rentals task 13.3, AC-19 to AC-22; billing AC-13, AC-14; D-099) against Postgres, through
// the real services of AppModule and, for the permission, over HTTP (test/db-rental-flow.ts). A rented
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

  it('AC-21, AC-14: before handover the held unit is free again and the paid first invoice is lowered', async () => {
    const org = await flow.organization();
    const variantId = await flow.variant();
    await flow.availableDevices(variantId, 5);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 5);
    await flow.approve(contract.id);
    await flow.payAll(contract.id);
    const held = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: contract.id, releasedAt: null },
    });
    await releases.release(
      contract.id,
      held.deviceId,
      { reason, expectedVersion: await flow.version(contract.id) },
      flow.staff,
    );
    await expect(
      flow.prisma.device.findUniqueOrThrow({ where: { id: held.deviceId } }),
    ).resolves.toMatchObject({ status: DeviceStatus.AVAILABLE });
    const first = await flow.prisma.invoice.findFirstOrThrow({
      where: { contractId: contract.id },
      orderBy: { issuedAt: 'asc' },
    });
    expect(first.totalVnd).toBe(1_800_000n);
    // what was paid above the new total is owed back
    expect(first.paidVnd - first.totalVnd).toBe(450_000n);
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
});
