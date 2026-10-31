import {
  ContractStatus,
  DeviceStatus,
  InvoiceLineType,
  LossCaseState,
  LossCustody,
  LossDecision,
} from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { LossSearchJob } from '../src/modules/devices/jobs/loss-search.job';
import { LossCaseService } from '../src/modules/devices/loss-cases.service';
import { ReturnService } from '../src/modules/rentals/return.service';
import { at, compileRentalFlow, DAY_MS, RentalFlow } from './db-rental-flow';

// devices task 2.7 against Postgres: the loss case from report to settlement through the real
// services of AppModule, with billing's LOSS and ADJUSTMENT lines and rentals' lostAt written inside
// the loss-case transaction (design §3), AC-05 to AC-07, and the job confirming a case once under a
// concurrent manual confirm. The handover of the flow is on 2 November 2026, so every loss-case call
// passes an explicit time after it. Run only through test:db against a migrated disposable database.
const SCHEDULE = [
  { fromMonths: 0, valueVnd: 2_500_000 },
  { fromMonths: 12, valueVnd: 1_800_000 },
];
const REPORTED_AT = at('2026-11-05T02:00:00.000Z');
const TRIAGED_AT = at('2026-11-05T03:00:00.000Z');

describe('loss cases against Postgres (devices task 2.7)', () => {
  let flow: RentalFlow;
  let lossCases: LossCaseService;
  let job: LossSearchJob;
  let searchDays: number;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
    lossCases = flow.get(LossCaseService);
    job = flow.get(LossSearchJob);
    searchDays = Number(
      (await flow.seededParameters(['devices.lossSearchDays']))['devices.lossSearchDays'],
    );
    expect(searchDays).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await flow?.close();
  });

  // A contract ACTIVE since 2 November with one unit out, of a variant with a remaining-value schedule.
  const rentedUnit = async () => {
    const org = await flow.organization();
    const variantId = await flow.variant(SCHEDULE);
    const [deviceId] = await flow.availableDevices(variantId, 1);
    const contract = await flow.requested(org.id, org.manager.id, variantId, 1);
    await flow.approve(contract.id);
    await flow.payAll(contract.id);
    await flow.handOver(contract.id, org.manager.id, [deviceId]);
    return { org, contract, deviceId };
  };

  const lines = (contractId: string, type: InvoiceLineType) =>
    flow.prisma.invoiceLine.findMany({ where: { invoice: { contractId }, type } });

  it('AC-06 and AC-07: a renter loss is charged once, settled by another Admin, and closes the custody interval', async () => {
    const { org, contract, deviceId } = await rentedUnit();

    const reported = await lossCases.report(
      deviceId,
      { description: 'Lost on the ridge' },
      org.manager,
      REPORTED_AT,
    );
    expect(reported).toMatchObject({ state: 'REPORTED', stateFromDevice: 'RENTED' });
    expect(reported.organization?.id).toBe(org.id);
    expect((await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      DeviceStatus.LOST,
    );
    expect(
      await flow.codeOf(
        lossCases.report(deviceId, { description: 'again' }, flow.staff, REPORTED_AT),
      ),
    ).toBe(ErrorCode.LOSS_CASE_OPEN);

    const triager = await flow.admin();
    const triaged = await lossCases.triage(
      reported.id,
      { suspectedTheft: false, expectedVersion: reported.version },
      triager,
      TRIAGED_AT,
    );
    expect(triaged).toMatchObject({
      state: 'SEARCHING',
      custody: LossCustody.RENTER,
      keyExposed: true,
    });
    expect(triaged.searchEndsAt?.getTime()).toBe(TRIAGED_AT.getTime() + searchDays * DAY_MS);
    // REQ-EVT-14: ChannelKeyService.markKeyExposed ran in the triage transaction.
    expect(
      (
        await flow.prisma.organization.findUniqueOrThrow({ where: { id: org.id } })
      ).channelKeyExposedAt?.getTime(),
    ).toBe(TRIAGED_AT.getTime());

    // Staff confirm while the job finds the window passed: exactly one confirmation and one LOSS line.
    const afterWindow = new Date(TRIAGED_AT.getTime() + searchDays * DAY_MS + 3_600_000);
    const [manual, run] = await Promise.all([
      flow.codeOf(
        lossCases.confirm(
          triaged.id,
          { expectedVersion: triaged.version },
          flow.staff,
          afterWindow,
        ),
      ),
      job.run(afterWindow),
    ]);
    const confirmations = (manual === null ? 1 : 0) + run.confirmed;
    expect(confirmations).toBe(1);
    const loss = await lines(contract.id, InvoiceLineType.LOSS);
    expect(loss.map((line) => line.amountVnd)).toEqual([2_500_000n]);

    const confirmed = await lossCases.get(triaged.id, flow.staff);
    expect(confirmed).toMatchObject({ state: 'CONFIRMED', chargeVnd: 2_500_000 });

    expect(
      await flow.codeOf(
        lossCases.decide(
          confirmed.id,
          { decision: LossDecision.CHARGED, expectedVersion: confirmed.version },
          triager,
          afterWindow,
        ),
      ),
    ).toBe(ErrorCode.SEPARATION_OF_DUTY);

    const settled = await lossCases.decide(
      confirmed.id,
      {
        decision: LossDecision.REDUCED,
        chargeVnd: 900_000,
        reason: 'Police report filed at once',
        expectedVersion: confirmed.version,
      },
      await flow.admin(),
      afterWindow,
    );
    expect(settled).toMatchObject({ state: 'SETTLED', decision: 'REDUCED', chargeVnd: 900_000 });
    expect(
      (await lines(contract.id, InvoiceLineType.ADJUSTMENT)).map((l) => l.amountVnd),
    ).toContain(-1_600_000n);
    const row = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: contract.id, deviceId },
    });
    expect(row.lostAt?.getTime()).toBe(
      (
        await flow.prisma.lossCase.findUniqueOrThrow({ where: { id: settled.id } })
      ).confirmedAt?.getTime(),
    );
    const device = await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.status).toBe(DeviceStatus.RETIRED);
    expect(
      await flow.prisma.deviceTransition.count({
        where: { deviceId, refType: 'LOSS_CASE', refId: settled.id },
      }),
    ).toBe(2);
  });

  it('rentals REQ-EVT-12: a RETURN_DUE contract whose last unit out is settled lost moves to RETURNED', async () => {
    const { org, contract, deviceId } = await rentedUnit();
    const reported = await lossCases.report(
      deviceId,
      { description: 'Fell into the river' },
      org.manager,
      REPORTED_AT,
    );
    const triaged = await lossCases.triage(
      reported.id,
      { suspectedTheft: false, expectedVersion: reported.version },
      flow.staff,
      TRIAGED_AT,
    );
    const confirmed = await lossCases.confirm(
      triaged.id,
      { expectedVersion: triaged.version },
      flow.staff,
      TRIAGED_AT,
    );
    // The term ended meanwhile (fixture): the contract waits for the unit that will never come back.
    await flow.prisma.rentalContract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.RETURN_DUE,
        returnDueAt: TRIAGED_AT,
        version: { increment: 1 },
      },
    });

    await lossCases.decide(
      confirmed.id,
      { decision: LossDecision.CHARGED, expectedVersion: confirmed.version },
      await flow.admin(),
      TRIAGED_AT,
    );

    expect(await flow.status(contract.id)).toBe(ContractStatus.RETURNED);
    expect(
      await flow.prisma.contractTransition.findFirst({
        where: { contractId: contract.id, toStatus: ContractStatus.RETURNED },
        select: { fromStatus: true, reason: true },
      }),
    ).toEqual({ fromStatus: ContractStatus.RETURN_DUE, reason: 'LOST' });
  });

  it('a unit lost after check-in, last heard while still out, is TrekLink custody and settles (ruling 2026-10-31)', async () => {
    const { contract, deviceId } = await rentedUnit();
    const heard = at('2026-11-04T02:00:00.000Z');
    const back = at('2026-11-06T02:00:00.000Z');
    const reportedAt = at('2026-11-07T02:00:00.000Z');
    // Last heard on the trail; the term ended (fixture) and the unit came back at the counter.
    await flow.prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: heard } });
    await flow.prisma.rentalContract.update({
      where: { id: contract.id },
      data: { status: ContractStatus.RETURN_DUE, returnDueAt: back, version: { increment: 1 } },
    });
    const tag = (await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).assetTag;
    await flow.get(ReturnService).checkIn(contract.id, [tag], flow.staff, back);

    // Lost in the store before its reset: reported from RETURNED.
    const reported = await lossCases.report(
      deviceId,
      { description: 'Not on the shelf' },
      flow.staff,
      reportedAt,
    );
    expect(reported.stateFromDevice).toBe(DeviceStatus.RETURNED);
    const triaged = await lossCases.triage(
      reported.id,
      { suspectedTheft: false, expectedVersion: reported.version },
      flow.staff,
      reportedAt,
    );
    expect(triaged).toMatchObject({
      custody: LossCustody.TREKLINK,
      keyExposed: false,
      contractDeviceId: null,
    });
    const confirmed = await lossCases.confirm(
      triaged.id,
      { expectedVersion: triaged.version },
      flow.staff,
      reportedAt,
    );
    expect(confirmed.chargeVnd).toBeNull();

    // Settles: before the ruling the rentals listener refused the closed interval with 409.
    const settled = await lossCases.decide(
      confirmed.id,
      {
        decision: LossDecision.WRITTEN_OFF,
        reason: 'Lost in the store',
        expectedVersion: confirmed.version,
      },
      await flow.admin(),
      reportedAt,
    );
    expect(settled.state).toBe(LossCaseState.SETTLED);
    expect((await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      DeviceStatus.RETIRED,
    );
    const row = await flow.prisma.contractDevice.findFirstOrThrow({
      where: { contractId: contract.id, deviceId },
    });
    expect(row.checkedInAt?.getTime()).toBe(back.getTime());
    expect(row.lostAt).toBeNull();
    expect(
      await flow.prisma.invoiceLine.count({ where: { deviceId, type: InvoiceLineType.LOSS } }),
    ).toBe(0);
  });

  it('AC-05: an AVAILABLE unit lost in TrekLink custody is written off with no charge', async () => {
    const variantId = await flow.variant(SCHEDULE);
    const [deviceId] = await flow.availableDevices(variantId, 1);

    const reported = await lossCases.report(
      deviceId,
      { description: 'Missing at stock-take' },
      flow.staff,
      REPORTED_AT,
    );
    const triaged = await lossCases.triage(
      reported.id,
      { suspectedTheft: false, expectedVersion: reported.version },
      flow.staff,
      TRIAGED_AT,
    );
    expect(triaged).toMatchObject({
      custody: LossCustody.TREKLINK,
      keyExposed: false,
      organization: null,
    });
    const confirmed = await lossCases.confirm(
      triaged.id,
      { expectedVersion: triaged.version },
      flow.staff,
      TRIAGED_AT,
    );
    expect(confirmed.chargeVnd).toBeNull();
    const settled = await lossCases.decide(
      confirmed.id,
      {
        decision: LossDecision.WRITTEN_OFF,
        reason: 'Lost in the store',
        expectedVersion: confirmed.version,
      },
      await flow.admin(),
      TRIAGED_AT,
    );
    expect(settled.state).toBe(LossCaseState.SETTLED);
    expect(
      await flow.prisma.invoiceLine.count({ where: { deviceId, type: InvoiceLineType.LOSS } }),
    ).toBe(0);
  });

  it('AC-08: a recovered unit is RETURNED, and a later loss opens a new case', async () => {
    const variantId = await flow.variant(SCHEDULE);
    const [deviceId] = await flow.availableDevices(variantId, 1);
    const reported = await lossCases.report(
      deviceId,
      { description: 'x' },
      flow.staff,
      REPORTED_AT,
    );
    const recovered = await lossCases.recover(
      reported.id,
      { note: 'Under the counter', expectedVersion: reported.version },
      flow.staff,
      TRIAGED_AT,
    );
    expect(recovered.state).toBe(LossCaseState.RECOVERED);
    expect((await flow.prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      DeviceStatus.RETURNED,
    );
    // A new loss of the same unit opens a new case: the recovered one no longer counts as open.
    await flow.prisma.device.update({
      where: { id: deviceId },
      data: { status: DeviceStatus.AVAILABLE },
    });
    const again = await lossCases.report(deviceId, { description: 'y' }, flow.staff, TRIAGED_AT);
    expect(again.code).not.toBe(reported.code);
  });

  it('serves the routes with the new permissions (migration 20261031120100)', async () => {
    const variantId = await flow.variant(SCHEDULE);
    const [deviceId] = await flow.availableDevices(variantId, 1);
    const org = await flow.organization();

    const created = await flow.send(flow.staff, 'post', `/api/devices/${deviceId}/loss-cases`, {
      description: 'Dropped from the truck',
    });
    expect(created.status).toBe(201);
    const body = created.body as { result: { id: string; version: number }; message: string };
    expect(body.message).toBe('Loss reported. TrekLink will contact you.');

    const fetched = await flow.send(flow.staff, 'get', `/api/loss-cases/${body.result.id}`);
    expect(fetched.status).toBe(200);

    // The Org Manager cannot triage, and reads another organization's case as 404.
    const triage = await flow.send(
      org.manager,
      'post',
      `/api/loss-cases/${body.result.id}/triage`,
      {
        suspectedTheft: false,
        expectedVersion: body.result.version,
      },
    );
    expect(triage.status).toBe(403);
    const foreign = await flow.send(org.manager, 'get', `/api/loss-cases/${body.result.id}`);
    expect(foreign.status).toBe(404);
    const list = await flow.send(org.manager, 'get', '/api/loss-cases');
    expect(list.status).toBe(200);
    expect((list.body as { result: { totalCount: number } }).result.totalCount).toBe(0);

    // Staff hold no settlement permission.
    const decision = await flow.send(
      flow.staff,
      'post',
      `/api/loss-cases/${body.result.id}/decision`,
      {
        decision: 'WRITTEN_OFF',
        reason: 'x',
        expectedVersion: body.result.version,
      },
    );
    expect(decision.status).toBe(403);
  });
});
