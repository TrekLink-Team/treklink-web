import { ContractStatus } from '@prisma/client';
import type { Custody } from '../rentals';
import { attribute } from './attribution';

const HANDOVER = new Date('2026-10-20T02:00:00.000Z');
const CHECK_IN = new Date('2026-10-23T02:00:00.000Z');
const MARGIN_S = 300;
const plus = (at: Date, seconds: number) => new Date(at.getTime() + seconds * 1000);

const custody = (overrides: Partial<Custody> = {}): Custody => ({
  contractDeviceId: 'cd-a',
  contractId: 'c-a',
  organizationId: 'org-a',
  contractStatus: ContractStatus.ACTIVE,
  handedOverAt: HANDOVER,
  endedAt: CHECK_IN,
  nearBoundary: false,
  ...overrides,
});

describe('attribute (task 2.4, REQ-ERR-06)', () => {
  const middle = plus(HANDOVER, 86_400);

  it('attributes an event inside the interval, clear of both margins, to its organization', () => {
    expect(
      attribute({ custody: custody(), occurredAt: middle, marginSeconds: MARGIN_S, station: null }),
    ).toEqual({
      attributed: true,
      organizationId: 'org-a',
      contractId: 'c-a',
      contractDeviceId: 'cd-a',
    });
  });

  it('attributes a Field Station event when the interval is the station organization', () => {
    expect(
      attribute({
        custody: custody(),
        occurredAt: middle,
        marginSeconds: MARGIN_S,
        station: { organizationId: 'org-a' },
      }),
    ).toMatchObject({ attributed: true, organizationId: 'org-a' });
  });

  it('attributes an event in an open interval, which has no end margin', () => {
    expect(
      attribute({
        custody: custody({ endedAt: null }),
        occurredAt: plus(HANDOVER, MARGIN_S + 1),
        marginSeconds: MARGIN_S,
        station: null,
      }),
    ).toMatchObject({ attributed: true });
  });

  it('leaves an event with no interval UNATTRIBUTED', () => {
    expect(
      attribute({ custody: null, occurredAt: middle, marginSeconds: MARGIN_S, station: null }),
    ).toEqual({ attributed: false, reason: 'NO_INTERVAL' });
    expect(
      attribute({
        custody: null,
        occurredAt: middle,
        marginSeconds: MARGIN_S,
        station: { organizationId: 'org-a' },
      }),
    ).toEqual({ attributed: false, reason: 'NO_INTERVAL' });
  });

  it.each([
    ['at the handover', HANDOVER],
    ['just after the handover', plus(HANDOVER, 1)],
    ['on the margin after the handover', plus(HANDOVER, MARGIN_S)],
  ])('leaves an event %s UNATTRIBUTED', (_label, occurredAt) => {
    expect(
      attribute({ custody: custody(), occurredAt, marginSeconds: MARGIN_S, station: null }),
    ).toEqual({ attributed: false, reason: 'NEAR_HANDOVER' });
  });

  it.each([
    ['just before the end', plus(CHECK_IN, -1)],
    ['on the margin before the end', plus(CHECK_IN, -MARGIN_S)],
  ])('leaves an event %s UNATTRIBUTED', (_label, occurredAt) => {
    expect(
      attribute({ custody: custody(), occurredAt, marginSeconds: MARGIN_S, station: null }),
    ).toEqual({ attributed: false, reason: 'NEAR_END' });
  });

  it('attributes an event one second outside either margin', () => {
    for (const occurredAt of [plus(HANDOVER, MARGIN_S + 1), plus(CHECK_IN, -MARGIN_S - 1)]) {
      expect(
        attribute({ custody: custody(), occurredAt, marginSeconds: MARGIN_S, station: null }),
      ).toMatchObject({ attributed: true });
    }
  });

  it('leaves a Field Station event of another organization UNATTRIBUTED', () => {
    expect(
      attribute({
        custody: custody(),
        occurredAt: middle,
        marginSeconds: MARGIN_S,
        station: { organizationId: 'org-b' },
      }),
    ).toEqual({ attributed: false, reason: 'STATION_ORGANIZATION_DIFFERS' });
  });

  it('with a zero margin attributes an event one second after the handover', () => {
    expect(
      attribute({
        custody: custody(),
        occurredAt: plus(HANDOVER, 1),
        marginSeconds: 0,
        station: null,
      }),
    ).toMatchObject({ attributed: true });
  });
});
