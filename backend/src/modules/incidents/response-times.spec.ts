import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ContractsService } from '../rentals';
import { IncidentsQueryService } from './incidents-query.service';
import { IncidentsRepository } from './incidents.repository';
import { percentile, responseTimesOf } from './response-times';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 20, 3, 0, 0) + seconds * 1000);

describe('percentile (nearest rank)', () => {
  it('answers the smallest value at or above the share of the list', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile(values, 10)).toBe(10);
    expect(percentile(values, 100)).toBe(100);
  });

  it('takes the lower middle for the median of an even list and the middle of an odd one', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3], 50)).toBe(2);
  });

  it('sorts a list it is given out of order and leaves it alone', () => {
    const values = [30, 10, 20];
    expect(percentile(values, 50)).toBe(20);
    expect(values).toEqual([30, 10, 20]);
  });

  it('answers the one value of a list of one, and null for none', () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('responseTimesOf (monitoring api-design 08, incident-times)', () => {
  const incident = (organizationId: string | null, ack: number | null, resolve: number | null) => ({
    organizationId,
    firstEventAt: at(0),
    acknowledgedAt: ack === null ? null : at(ack),
    resolvedAt: resolve === null ? null : at(resolve),
  });

  it('groups by organization, most incidents first, and ends with one row over every incident', () => {
    const rows = responseTimesOf([
      incident('org-b', 30, 600),
      incident('org-a', 10, 100),
      incident('org-a', 20, 200),
      incident('org-a', 60, 900),
    ]);
    expect(rows).toEqual([
      {
        organizationId: 'org-a',
        incidents: 3,
        ackMedianSec: 20,
        ackP95Sec: 60,
        resolveMedianSec: 200,
        resolveP95Sec: 900,
      },
      {
        organizationId: 'org-b',
        incidents: 1,
        ackMedianSec: 30,
        ackP95Sec: 30,
        resolveMedianSec: 600,
        resolveP95Sec: 600,
      },
      {
        organizationId: null,
        incidents: 4,
        ackMedianSec: 20,
        ackP95Sec: 60,
        resolveMedianSec: 200,
        resolveP95Sec: 900,
      },
    ]);
  });

  it('computes the all-incidents row from the incidents, not from the organization percentiles', () => {
    const rows = responseTimesOf([
      incident('org-a', 10, null),
      incident('org-a', 10, null),
      incident('org-a', 10, null),
      incident('org-b', 100, null),
    ]);
    expect(rows[0].ackP95Sec).toBe(10);
    expect(rows[1].ackP95Sec).toBe(100);
    // The median of 10, 10, 10, 100 is 10 and the P95 is 100: neither is an average of 10 and 100.
    expect(rows[2]).toMatchObject({
      organizationId: null,
      incidents: 4,
      ackMedianSec: 10,
      ackP95Sec: 100,
    });
  });

  it('leaves an incident out of a figure it has not reached, but counts it', () => {
    const [row] = responseTimesOf([incident('org-a', 40, null), incident('org-a', null, null)]);
    expect(row.incidents).toBe(2);
    expect(row.ackMedianSec).toBe(40);
    expect(row.resolveMedianSec).toBeNull();
    expect(row.resolveP95Sec).toBeNull();
  });

  it('counts an unrouted incident in the all-incidents row only, and clamps a negative duration to zero', () => {
    const rows = responseTimesOf([incident(null, 5, 9), incident('org-a', -5, 2)]);
    expect(rows.map((row) => [row.organizationId, row.incidents])).toEqual([
      ['org-a', 1],
      [null, 2],
    ]);
    expect(rows[0].ackMedianSec).toBe(0);
  });

  it('gives an unrouted-only period just the all-incidents row', () => {
    expect(responseTimesOf([incident(null, 5, 9)])).toEqual([
      {
        organizationId: null,
        incidents: 1,
        ackMedianSec: 5,
        ackP95Sec: 5,
        resolveMedianSec: 9,
        resolveP95Sec: 9,
      },
    ]);
  });

  it('orders organizations with the same count by id', () => {
    const rows = responseTimesOf([incident('org-b', 1, 1), incident('org-a', 1, 1)]);
    expect(rows.map((row) => row.organizationId)).toEqual(['org-a', 'org-b', null]);
  });

  it('answers nothing for no incidents', () => {
    expect(responseTimesOf([])).toEqual([]);
  });
});

describe('IncidentsQueryService.responseTimes (monitoring api-design 08)', () => {
  const from = new Date('2026-10-01T00:00:00.000Z');
  const to = new Date('2026-11-01T00:00:00.000Z');

  it('reads the routed incidents first seen in the range and answers the figures per organization', async () => {
    const responseTimeRows = jest.fn().mockResolvedValue([
      {
        organizationId: 'org-a',
        firstEventAt: at(0),
        acknowledgedAt: at(42),
        resolvedAt: at(840),
      },
    ]);
    const service = new IncidentsQueryService(
      { responseTimeRows } as unknown as IncidentsRepository,
      {} as DevicesService,
      {} as ContractsService,
      {} as OrganizationsService,
      {} as ConfigService<ValidatedEnvironment, true>,
      {} as never,
    );
    await expect(service.responseTimes({ from, to })).resolves.toEqual([
      expect.objectContaining({
        organizationId: 'org-a',
        incidents: 1,
        ackMedianSec: 42,
        resolveP95Sec: 840,
      }),
      expect.objectContaining({ organizationId: null, incidents: 1 }),
    ]);
    expect(responseTimeRows).toHaveBeenCalledWith(from, to);
  });

  it('asks for every incident first seen in [from, to), routed or not', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new IncidentsRepository({
      incident: { findMany },
    } as unknown as PrismaService).responseTimeRows(from, to);
    expect(findMany).toHaveBeenCalledWith({
      where: { firstEventAt: { gte: from, lt: to } },
      select: { organizationId: true, firstEventAt: true, acknowledgedAt: true, resolvedAt: true },
    });
  });
});
