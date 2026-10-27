import { PriorityTier } from '../config';
import { FrameSimulator, tierOf, type StockPacket } from './simulator';

const config = {
  nodes: ['!de000009', '!de00000a'],
  intervalMs: 5_000,
  sosEvery: 2,
  startLat: 11.5544,
  startLon: 108.5381,
};

describe('FrameSimulator', () => {
  it('sends a position and a telemetry reading per node each tick, in the stock JSON shape', () => {
    const packets = new FrameSimulator(config).next(new Date('2026-10-27T03:00:00Z'));
    expect(packets.map((packet) => `${packet.sender}:${packet.type}`)).toEqual([
      '!de000009:position',
      '!de000009:telemetry',
      '!de00000a:position',
      '!de00000a:telemetry',
    ]);
    const position = packets[0];
    expect(position.from).toBe(0xde000009);
    expect(position.timestamp).toBe(Date.parse('2026-10-27T03:00:00Z') / 1000);
    expect(Math.abs((position.payload.latitude_i as number) / 1e7 - 11.5544)).toBeLessThan(0.001);
  });

  it('adds an SOS from the first node every n-th tick, in the firmware text form', () => {
    const simulator = new FrameSimulator(config);
    expect(simulator.next().some((packet) => packet.type === 'text')).toBe(false);
    const sos = simulator.next().find((packet) => packet.type === 'text');
    expect(sos?.sender).toBe('!de000009');
    expect(sos?.payload.text).toMatch(/^SOS - \[\d+\.\d{6}\], \[\d+\.\d{6}\]$/);
  });

  it('never repeats a packet id within a run', () => {
    const simulator = new FrameSimulator(config);
    const ids = [1, 2, 3, 4, 5].flatMap(() => simulator.next().map((packet) => packet.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('tierOf', () => {
  const packet = (type: StockPacket['type'], payload: Record<string, unknown>) =>
    ({ type, payload }) as StockPacket;

  it('puts an SOS first, positions and other text next, telemetry last', () => {
    expect(tierOf(packet('text', { text: 'SOS - [11.5], [108.5]' }))).toBe(PriorityTier.P0_SOS);
    expect(tierOf(packet('text', { text: 'hello' }))).toBe(PriorityTier.P2_GPS);
    expect(tierOf(packet('position', {}))).toBe(PriorityTier.P2_GPS);
    expect(tierOf(packet('telemetry', {}))).toBe(PriorityTier.P3_TELEMETRY);
  });
});
