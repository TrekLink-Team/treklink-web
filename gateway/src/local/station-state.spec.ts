import { PriorityTier } from '../config';
import { kindOf, StationState } from './station-state';

const T0 = Date.UTC(2026, 10, 1, 5, 0, 0);

const frame = (
  n: number,
  sender: string,
  type: string,
  payload: Record<string, unknown>,
  heardAt = T0,
) => ({
  eventId: `${sender}:${n}`,
  priority:
    type === 'telemetry'
      ? PriorityTier.P3_TELEMETRY
      : type === 'text'
        ? PriorityTier.P0_SOS
        : PriorityTier.P2_GPS,
  payload: { id: n, sender, type, payload },
  heardAt,
});

describe('Field Station local state (gateway-sync task 5.2)', () => {
  const make = () => new StationState({ staleSeconds: 300, eventLogSize: 5 });

  it('reads the kind the way the backend text strategy does', () => {
    expect(kindOf({ type: 'position' })).toBe('POSITION');
    expect(kindOf({ type: 'telemetry' })).toBe('TELEMETRY');
    expect(kindOf({ type: 'text', payload: { text: 'SOS - [11.5], [108.5]' } })).toBe('SOS');
    expect(kindOf({ type: 'text', payload: { text: 'SOS - FALL DETECTED [11.5], [108.5]' } })).toBe(
      'FALL_SOS',
    );
    expect(kindOf({ type: 'text', payload: { text: 'hello' } })).toBe('TEXT');
    expect(kindOf({ type: 'nodeinfo' })).toBe('OTHER');
  });

  it('keeps the last position and battery of each node', () => {
    const state = make();
    state.record(
      frame(1, '!de000009', 'position', {
        latitude_i: 115544000,
        longitude_i: 1085381000,
        altitude: 1300,
      }),
    );
    state.record(
      frame(2, '!de000009', 'telemetry', { battery_level: 87, voltage: 4.05 }, T0 + 1000),
    );
    state.record(
      frame(
        3,
        '!de000009',
        'position',
        { latitude_i: 115545000, longitude_i: 1085382000 },
        T0 + 2000,
      ),
    );

    const [node] = state.nodes(T0 + 3000);
    expect(node).toEqual({
      nodeId: '!de000009',
      lastHeardAt: T0 + 2000,
      position: { latitude: 11.5545, longitude: 108.5382, altitude: null, heardAt: T0 + 2000 },
      battery: { level: 87, voltage: 4.05, heardAt: T0 + 1000 },
      sosActive: false,
      sosKind: null,
      lastSosAt: null,
      stale: false,
    });
  });

  it('keeps the battery when a telemetry packet carries none', () => {
    const state = make();
    state.record(frame(1, '!de000009', 'telemetry', { battery_level: 60 }));
    state.record(frame(2, '!de000009', 'telemetry', { temperature: 21 }, T0 + 1000));
    expect(state.nodes(T0)[0].battery).toEqual({ level: 60, voltage: null, heardAt: T0 });
  });

  it('sets sosActive on an SOS or a fall SOS and keeps it on later traffic (D-038)', () => {
    const state = make();
    state.record(frame(1, '!de00000a', 'text', { text: 'SOS - FALL DETECTED [11.5], [108.5]' }));
    state.record(frame(2, '!de00000a', 'position', { latitude_i: 1, longitude_i: 2 }, T0 + 1000));
    state.record(frame(3, '!de00000a', 'text', { text: 'ok now' }, T0 + 2000));
    const [node] = state.nodes(T0 + 3000);
    expect(node.sosActive).toBe(true);
    expect(node.sosKind).toBe('FALL_SOS');
    expect(node.lastSosAt).toBe(T0);
  });

  it('lists SOS nodes first, then by node id', () => {
    const state = make();
    state.record(frame(1, '!de00000b', 'position', { latitude_i: 1, longitude_i: 2 }));
    state.record(frame(2, '!de000009', 'position', { latitude_i: 1, longitude_i: 2 }));
    state.record(frame(3, '!de00000c', 'text', { text: 'SOS - [1], [2]' }));
    expect(state.nodes(T0).map((node) => node.nodeId)).toEqual([
      '!de00000c',
      '!de000009',
      '!de00000b',
    ]);
  });

  it('shows a node stale once it is silent past the threshold', () => {
    const state = make();
    state.record(frame(1, '!de000009', 'position', { latitude_i: 1, longitude_i: 2 }));
    expect(state.nodes(T0 + 300_000)[0].stale).toBe(false);
    expect(state.nodes(T0 + 300_001)[0].stale).toBe(true);
  });

  it('keeps the newest events up to the log size and answers after a sequence', () => {
    const state = make();
    for (let n = 1; n <= 7; n += 1)
      state.record(frame(n, '!de000009', 'telemetry', { battery_level: 100 - n }));
    expect(state.lastSeq()).toBe(7);
    expect(state.events().map((event) => event.localSeq)).toEqual([3, 4, 5, 6, 7]);
    expect(state.events(5).map((event) => event.localSeq)).toEqual([6, 7]);
    expect(state.events(7)).toEqual([]);
    expect(state.events(6)[0]).toMatchObject({
      nodeId: '!de000009',
      kind: 'TELEMETRY',
      summary: 'battery 93%',
    });
  });

  it('records a frame without a sender under unknown', () => {
    const state = make();
    state.record({
      eventId: 'x',
      priority: PriorityTier.P2_GPS,
      payload: { type: 'position' },
      heardAt: T0,
    });
    expect(state.nodes(T0)[0].nodeId).toBe('unknown');
    expect(state.events()[0].summary).toBe('position without coordinates');
  });
});
