import { custodyView, type CustodyReadings } from './custody-view';

const NOW = new Date('2026-11-01T03:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);
const HANDED_OVER = ago(3600);
// `monitoring.deviceStaleSeconds` of 300.
const STALE_BEFORE = NOW.getTime() - 300_000;

const readings = (overrides: Partial<CustodyReadings> = {}): CustodyReadings => ({
  lastSeenAt: ago(20),
  lastLatitude: 11.56,
  lastLongitude: 108.54,
  lastPositionAt: ago(20),
  batteryPct: 81,
  lastBatteryAt: ago(20),
  ...overrides,
});

const org = (device: CustodyReadings) => custodyView(device, HANDED_OVER, STALE_BEFORE, true);
const staff = (device: CustodyReadings) => custodyView(device, HANDED_OVER, STALE_BEFORE, false);

describe('custodyView (REQ-UBI-04, D-040, D-092 rule 2)', () => {
  it('hides from an organization a battery read before the handover, even when heard since', () => {
    // Telemetry since the handover carried no battery value; the stored one is the previous custody's.
    const device = readings({ lastBatteryAt: ago(7200), batteryPct: 95 });
    expect(org(device)).toMatchObject({ state: 'LIVE', batteryPct: null });
    expect(staff(device).batteryPct).toBe(95);
  });

  it('hides from an organization a battery of unknown time (stored before lastBatteryAt existed)', () => {
    expect(org(readings({ lastBatteryAt: null })).batteryPct).toBeNull();
    expect(staff(readings({ lastBatteryAt: null })).batteryPct).toBe(81);
  });

  it('is LIVE with every reading when heard in custody within the threshold', () => {
    expect(org(readings())).toEqual({
      state: 'LIVE',
      stale: false,
      position: { lat: 11.56, lon: 108.54, at: ago(20).toISOString() },
      lastSeenAt: ago(20).toISOString(),
      batteryPct: 81,
    });
  });

  it('is OFFLINE and stale when heard in custody and silent past the threshold', () => {
    expect(org(readings({ lastSeenAt: ago(900), lastPositionAt: ago(900) }))).toEqual({
      state: 'OFFLINE',
      stale: true,
      position: { lat: 11.56, lon: 108.54, at: ago(900).toISOString() },
      lastSeenAt: ago(900).toISOString(),
      batteryPct: 81,
    });
  });

  it('counts the reading at the handover instant as heard in custody', () => {
    const device = readings({ lastSeenAt: HANDED_OVER, lastPositionAt: HANDED_OVER });
    expect(org(device)).toMatchObject({
      state: 'OFFLINE',
      position: { at: HANDED_OVER.toISOString() },
    });
  });

  it('hides from an organization everything of a unit heard only before the handover', () => {
    expect(org(readings({ lastSeenAt: ago(7200), lastPositionAt: ago(7200) }))).toEqual({
      state: 'NOT_HEARD',
      stale: false,
      position: null,
      lastSeenAt: null,
      batteryPct: null,
    });
  });

  it('is NOT_HEARD with nothing for a unit never heard', () => {
    const never = readings({
      lastSeenAt: null,
      lastLatitude: null,
      lastLongitude: null,
      lastPositionAt: null,
      batteryPct: null,
    });
    expect(org(never)).toEqual({
      state: 'NOT_HEARD',
      stale: false,
      position: null,
      lastSeenAt: null,
      batteryPct: null,
    });
    expect(staff(never)).toEqual(org(never));
  });

  it('drops a fix from before the handover when the unit was heard since without one', () => {
    expect(org(readings({ lastSeenAt: ago(30), lastPositionAt: ago(7200) }))).toMatchObject({
      state: 'LIVE',
      position: null,
      lastSeenAt: ago(30).toISOString(),
    });
  });

  it('drops from an organization a fix with no reading time', () => {
    expect(org(readings({ lastPositionAt: null }))).toMatchObject({
      state: 'LIVE',
      position: null,
    });
  });

  it('gives TrekLink staff the stored readings with the same states', () => {
    const before = readings({ lastSeenAt: ago(7200), lastPositionAt: ago(7200) });
    expect(staff(before)).toEqual({
      state: 'NOT_HEARD',
      stale: false,
      position: { lat: 11.56, lon: 108.54, at: ago(7200).toISOString() },
      lastSeenAt: ago(7200).toISOString(),
      batteryPct: 81,
    });
    // A fix with no reading time is placed at the last-seen time for staff.
    expect(staff(readings({ lastPositionAt: null })).position).toEqual({
      lat: 11.56,
      lon: 108.54,
      at: ago(20).toISOString(),
    });
  });
});
