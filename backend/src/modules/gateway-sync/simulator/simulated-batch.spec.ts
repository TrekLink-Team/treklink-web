import { decodeStock } from '../adapters/stock-json';
import { SIMULATED_NODES, positionAt, simulatedBatch } from './simulated-batch';

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

  it('walks at most walking pace between two batches', () => {
    const t = Date.parse('2026-11-01T06:00:00Z') / 1000;
    for (const index of SIMULATED_NODES.keys()) {
      const a = positionAt(index, t);
      const b = positionAt(index, t + 60);
      const metres = Math.hypot((b.lat - a.lat) * 111_000, (b.lon - a.lon) * 109_000);
      expect(metres / 60).toBeLessThan(2);
    }
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
