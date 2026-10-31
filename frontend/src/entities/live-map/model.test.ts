import { describe, expect, it } from 'vitest';
import type { LiveEntry } from '../../shared/socket/socketClient';
import type { MapSnapshot, SnapshotDevice } from './api';
import { applyEntry, fromSnapshot, isStale, needsSnapshot, rebuild } from './model';

const device = (overrides: Partial<SnapshotDevice> = {}): SnapshotDevice => ({
  id: 'd-1',
  assetTag: 'TL-0009',
  hardwareVariant: 'treklink-v3',
  holder: { name: 'Le Thi E' },
  position: { lat: 11.5, lon: 108.5, at: '2026-10-30T03:00:00.000Z' },
  batteryPct: 80,
  lastSeenAt: '2026-10-30T03:00:00.000Z',
  stale: false,
  openIncident: null,
  contractCode: 'RC-2026-0001',
  organizationId: 'org-1',
  ...overrides,
});

const snapshot = (devices: SnapshotDevice[] = [device()], cursor = 10): MapSnapshot => ({
  cursor,
  devices,
  fieldStations: [],
});

const entry = (seq: number, type: string, payload: Record<string, unknown>, deviceId = 'd-1') =>
  ({ seq, type, deviceId, payload, createdAt: '2026-10-30T03:00:00.000Z' }) as LiveEntry;

const at = (second: number) => `2026-10-30T03:01:${String(second).padStart(2, '0')}.000Z`;

describe('live map reducer (screen 9.1)', () => {
  it('ignores entries at or below the snapshot cursor', () => {
    const state = fromSnapshot(snapshot());
    expect(applyEntry(state, entry(10, 'device.position', { lat: 1, lon: 1, at: at(1) }))).toBe(
      state,
    );
    expect(applyEntry(state, entry(3, 'device.telemetry', { batteryPct: 1, at: at(1) }))).toBe(
      state,
    );
  });

  it('moves a marker on a position and refreshes its last-seen time and staleness', () => {
    const state = fromSnapshot(snapshot([device({ stale: true })]));
    const next = applyEntry(
      state,
      entry(11, 'device.position', { lat: 11.6, lon: 108.6, at: at(5) }),
    );
    expect(next.cursor).toBe(11);
    expect(next.devices['d-1']).toMatchObject({
      position: { lat: 11.6, lon: 108.6, at: at(5) },
      lastSeenAt: at(5),
      stale: false,
    });
  });

  it('keeps a late position off the live map and an older fix from overwriting a newer one', () => {
    const state = fromSnapshot(snapshot());
    const late = applyEntry(
      state,
      entry(11, 'device.position', { lat: 1, lon: 1, at: at(5), late: true }),
    );
    expect(late.cursor).toBe(11);
    expect(late.devices['d-1'].position?.lat).toBe(11.5);

    const newer = applyEntry(state, entry(12, 'device.position', { lat: 2, lon: 2, at: at(9) }));
    const older = applyEntry(newer, entry(13, 'device.position', { lat: 3, lon: 3, at: at(1) }));
    expect(older.devices['d-1'].position).toEqual({ lat: 2, lon: 2, at: at(9) });
    expect(older.cursor).toBe(13);

    const malformed = applyEntry(
      state,
      entry(14, 'device.position', { lat: 'x', lon: 1, at: at(1) }),
    );
    expect(malformed.devices['d-1']).toBe(state.devices['d-1']);
  });

  it('gives a device its first position', () => {
    const state = fromSnapshot(snapshot([device({ position: null, lastSeenAt: null })]));
    const next = applyEntry(state, entry(11, 'device.position', { lat: 1, lon: 2, at: at(1) }));
    expect(next.devices['d-1'].position).toEqual({ lat: 1, lon: 2, at: at(1) });
    expect(next.devices['d-1'].lastSeenAt).toBe(at(1));
  });

  it('updates the battery on telemetry, and skips late or timeless telemetry', () => {
    const state = fromSnapshot(snapshot());
    const next = applyEntry(state, entry(11, 'device.telemetry', { batteryPct: 42, at: at(2) }));
    expect(next.devices['d-1']).toMatchObject({ batteryPct: 42, lastSeenAt: at(2) });
    const noBattery = applyEntry(next, entry(12, 'device.telemetry', { at: at(1) }));
    expect(noBattery.devices['d-1']).toMatchObject({ batteryPct: 42, lastSeenAt: at(2) });
    const late = applyEntry(
      next,
      entry(13, 'device.telemetry', { batteryPct: 1, at: at(3), late: true }),
    );
    expect(late.devices['d-1'].batteryPct).toBe(42);
    expect(applyEntry(next, entry(14, 'device.telemetry', { batteryPct: 1 })).devices['d-1']).toBe(
      next.devices['d-1'],
    );
  });

  it('applies stale, label and release entries', () => {
    const state = fromSnapshot(snapshot());
    const stale = applyEntry(state, entry(11, 'device.stale', { stale: true, lastSeenAt: at(0) }));
    expect(stale.devices['d-1']).toMatchObject({ stale: true, lastSeenAt: at(0) });
    const recovered = applyEntry(stale, entry(12, 'device.stale', { stale: false }));
    expect(recovered.devices['d-1'].stale).toBe(false);

    const labelled = applyEntry(
      recovered,
      entry(13, 'device.label', { holder: { name: 'Tran B' } }),
    );
    expect(labelled.devices['d-1'].holder).toEqual({ name: 'Tran B' });
    const cleared = applyEntry(labelled, entry(14, 'device.label', { holder: null }));
    expect(cleared.devices['d-1'].holder).toBeNull();

    const released = applyEntry(cleared, entry(15, 'device.released', { checkedInAt: at(9) }));
    expect(released.devices['d-1']).toBeUndefined();
    expect(released.order).toEqual([]);
    expect(applyEntry(released, entry(16, 'device.released', {})).cursor).toBe(16);
  });

  it('shows, updates and clears the open incident of a device', () => {
    const state = fromSnapshot(snapshot());
    const opened = applyEntry(
      state,
      entry(11, 'incident.changed', {
        incidentId: 'i-1',
        state: 'NOTIFY_PRIMARY',
        tier: 'PRIMARY',
      }),
    );
    expect(opened.devices['d-1'].openIncident).toEqual({
      id: 'i-1',
      code: null,
      state: 'NOTIFY_PRIMARY',
    });
    const coded = applyEntry(
      opened,
      entry(12, 'incident.changed', { incidentId: 'i-1', state: 'NOTIFY_PRIMARY', code: 'INC-1' }),
    );
    const acknowledged = applyEntry(
      coded,
      entry(13, 'incident.changed', { incidentId: 'i-1', state: 'ACKNOWLEDGED' }),
    );
    expect(acknowledged.devices['d-1'].openIncident).toEqual({
      id: 'i-1',
      code: 'INC-1',
      state: 'ACKNOWLEDGED',
    });
    const otherClosed = applyEntry(
      acknowledged,
      entry(14, 'incident.changed', { incidentId: 'i-0', state: 'CLOSED' }),
    );
    expect(otherClosed.devices['d-1'].openIncident?.id).toBe('i-1');
    const closed = applyEntry(
      otherClosed,
      entry(15, 'incident.changed', { incidentId: 'i-1', state: 'CLOSED' }),
    );
    expect(closed.devices['d-1'].openIncident).toBeNull();
    expect(applyEntry(closed, entry(16, 'incident.changed', {})).devices['d-1']).toBe(
      closed.devices['d-1'],
    );
  });

  it('places an incident on the device the entry names and only moves the cursor without one', () => {
    const state = fromSnapshot(snapshot());
    const payload = { incidentId: 'i-2', state: 'NOTIFY_PRIMARY' };
    expect(
      applyEntry(state, entry(11, 'incident.changed', payload)).devices['d-1'].openIncident,
    ).toEqual({ id: 'i-2', code: null, state: 'NOTIFY_PRIMARY' });
    const unnamed = applyEntry(state, {
      ...entry(11, 'incident.changed', payload),
      deviceId: null,
    } as unknown as LiveEntry);
    expect(unnamed.cursor).toBe(11);
    expect(unnamed.devices).toBe(state.devices);
  });

  it('reads the snapshot again for an incident its marker does not hold yet, for its code', () => {
    const held = { id: 'i-1', code: 'INC-2026-000001', state: 'NOTIFY_PRIMARY' as const };
    const state = fromSnapshot(snapshot([device({ openIncident: held })]));
    const changed = (payload: Record<string, unknown>, deviceId: string | null = 'd-1') =>
      ({ ...entry(11, 'incident.changed', payload), deviceId }) as LiveEntry;
    // A new SOS on the marker: the payload has no code before monitoring 2.1.
    expect(needsSnapshot(state, changed({ incidentId: 'i-2', state: 'NOTIFY_PRIMARY' }))).toBe(
      true,
    );
    // An entry stored before the stream named the device, or one before the snapshot answered.
    expect(needsSnapshot(state, changed({ incidentId: 'i-1', state: 'ESCALATED' }, null))).toBe(
      true,
    );
    expect(needsSnapshot(null, changed({ incidentId: 'i-1', state: 'ESCALATED' }))).toBe(true);
    // The marker already holds the incident and its code, or the incident closed.
    expect(needsSnapshot(state, changed({ incidentId: 'i-1', state: 'ESCALATED' }))).toBe(false);
    expect(needsSnapshot(state, changed({ incidentId: 'i-2', state: 'CLOSED' }))).toBe(false);
    // A payload that already carries the code.
    expect(
      needsSnapshot(state, changed({ incidentId: 'i-2', state: 'NOTIFY_PRIMARY', code: 'INC-2' })),
    ).toBe(false);
    expect(needsSnapshot(state, entry(11, 'device.handedOver', {}))).toBe(true);
    expect(needsSnapshot(state, entry(11, 'device.position', {}))).toBe(false);
  });

  it('only moves the cursor for unknown devices and other entry types', () => {
    const state = fromSnapshot(snapshot());
    const unknown = applyEntry(
      state,
      entry(11, 'device.position', { lat: 1, lon: 1, at: at(1) }, 'd-9'),
    );
    expect(unknown.devices).toBe(state.devices);
    expect(unknown.cursor).toBe(11);
    const handedOver = applyEntry(unknown, entry(12, 'device.handedOver', { contractId: 'c-2' }));
    expect(handedOver.cursor).toBe(12);
    const noDevice = applyEntry(handedOver, {
      seq: 13,
      type: 'device.telemetry',
      payload: { batteryPct: 1, at: at(1) },
      createdAt: at(1),
    });
    expect(noDevice.devices).toBe(state.devices);
  });

  it('rebuilds from a snapshot and buffered entries in seq order, dropping those it already has', () => {
    const entries = [
      entry(13, 'device.position', { lat: 3, lon: 3, at: at(3) }),
      entry(9, 'device.position', { lat: 9, lon: 9, at: at(9) }),
      entry(12, 'device.position', { lat: 2, lon: 2, at: at(2) }),
    ];
    const state = rebuild(snapshot(), entries);
    expect(state.cursor).toBe(13);
    expect(state.devices['d-1'].position).toEqual({ lat: 3, lon: 3, at: at(3) });
  });

  it('calls a device stale when told so or silent past the threshold, never when never heard', () => {
    const now = Date.parse('2026-10-30T03:10:00.000Z');
    expect(isStale(device(), now, 300)).toBe(true);
    expect(isStale(device(), now, 900)).toBe(false);
    expect(isStale(device({ stale: true }), now, 900)).toBe(true);
    expect(isStale(device({ lastSeenAt: null }), now, 1)).toBe(false);
  });
});
