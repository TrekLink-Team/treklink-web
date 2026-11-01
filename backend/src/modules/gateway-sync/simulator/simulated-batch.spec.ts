import { decodeStock } from '../adapters/stock-json';
import {
  CYCLE_SECONDS,
  SIMULATED_NODES,
  metresFromTrail,
  positionAt,
  simulatedBatch,
} from './simulated-batch';

const at = (iso: string) => new Date(iso);

describe('simulatedBatch (design §2 (field data simulator), D-090 rule 2)', () => {
  it('sends a position and a telemetry reading per simulated node, timed at the interval start', () => {
    const batch = simulatedBatch(at('2026-11-01T06:00:42Z'), 60, 0);
    expect(batch.map((p) => `${p.sender} ${p.type}`)).toEqual([
      '!de000009 position',
      '!de000009 telemetry',
      '!de00000a position',
      '!de00000a telemetry',
    ]);
    const start = Date.parse('2026-11-01T06:00:00Z') / 1000;
    expect(batch.every((p) => p.timestamp === start)).toBe(true);
    expect(batch[0].from).toBe(0xde000009);
  });

  it('builds the same packets for any time inside one interval, so a repeat run deduplicates', () => {
    const first = simulatedBatch(at('2026-11-01T06:00:05Z'), 60, 0);
    const again = simulatedBatch(at('2026-11-01T06:00:55Z'), 60, 0);
    expect(again).toEqual(first);
    const next = simulatedBatch(at('2026-11-01T06:01:05Z'), 60, 0);
    expect(next[0].id).not.toBe(first[0].id);
  });

  it('decodes as a stock packet the ingestion pipeline accepts', () => {
    for (const packet of simulatedBatch(at('2026-11-01T06:00:00Z'), 60, 5)) {
      expect(decodeStock(Buffer.from(JSON.stringify(packet))).kind).toBe('packet');
    }
  });

  const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.hypot(
      (b.lat - a.lat) * 111_320,
      (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180),
    );
  const t0 = Date.parse('2026-11-01T06:00:00Z') / 1000;

  it('keeps both nodes on the OSM trail, within the 3 m jitter, over a whole out-and-back cycle', () => {
    for (const index of SIMULATED_NODES.keys()) {
      for (let s = 0; s < CYCLE_SECONDS; s += 30) {
        expect(metresFromTrail(positionAt(index, t0 + s))).toBeLessThan(4.5);
      }
    }
  });

  it('never moves faster than monitoring.maxPlausibleSpeedKmh (30) between consecutive intervals', () => {
    for (const index of SIMULATED_NODES.keys()) {
      let fastest = 0;
      for (let s = 0; s < CYCLE_SECONDS; s += 60) {
        fastest = Math.max(
          fastest,
          metres(positionAt(index, t0 + s), positionAt(index, t0 + s + 60)) / 60,
        );
      }
      expect(fastest * 3.6).toBeLessThan(30);
      // Walking pace: the fastest segment is 1.4 m/s plus the jitter's drift.
      expect(fastest).toBeLessThan(1.6);
    }
  });

  it('turns at the trail ends without a jump and stands still at the rests', () => {
    const turn = CYCLE_SECONDS / 2;
    for (const at of [turn, CYCLE_SECONDS]) {
      // Seconds just before and after the turn, minus the jitter's own drift, are metres apart.
      expect(metres(positionAt(0, at - 1), positionAt(0, at + 1))).toBeLessThan(4);
    }
    let still = 0;
    for (let s = 0; s < CYCLE_SECONDS; s += 60) {
      if (metres(positionAt(0, s), positionAt(0, s + 60)) < 8) still += 1;
    }
    // Two four-minute rests each way: at least eight one-minute intervals with only jitter.
    expect(still).toBeGreaterThanOrEqual(8);
  });

  it('puts TL-0010 further along the same trail, not on a mirrored copy', () => {
    const lead = positionAt(1, t0);
    expect(metresFromTrail(lead)).toBeLessThan(4.5);
    expect(metres(lead, positionAt(0, t0 + 900))).toBeLessThan(10);
  });

  it('sends no SOS by default, and one per SOS window when it is set', () => {
    expect(simulatedBatch(at('2026-11-01T06:00:00Z'), 60, 0).some((p) => p.type === 'text')).toBe(
      false,
    );
    const sos = (iso: string) => simulatedBatch(at(iso), 60, 10).filter((p) => p.type === 'text');
    expect(sos('2026-11-01T06:00:30Z')).toHaveLength(1);
    expect(sos('2026-11-01T06:00:30Z')[0].payload.text).toMatch(
      /^SOS - \[11\.\d{6}\], \[108\.\d{6}\]$/,
    );
    expect(sos('2026-11-01T06:01:30Z')).toHaveLength(0);
    expect(sos('2026-11-01T06:10:30Z')).toHaveLength(1);
  });
});
