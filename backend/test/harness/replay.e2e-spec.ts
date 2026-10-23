import { loadFixture, prepare } from './replay';

describe('replay harness', () => {
  it('publishes a fixture unchanged by default', () => {
    const [fixture] = loadFixture('position');
    expect(JSON.parse(prepare(fixture, {}))).toEqual(fixture.message);
  });

  it('shifts rx_time and the position time, and replaces the id', () => {
    const [fixture] = loadFixture('position');
    const message = JSON.parse(prepare(fixture, { shiftSeconds: 60, newId: 7 })) as {
      id: number;
      timestamp: number;
      payload: { time: number };
    };
    const original = fixture.message as { timestamp: number; payload: { time: number } };
    expect(message.id).toBe(7);
    expect(message.timestamp).toBe(original.timestamp + 60);
    expect(message.payload.time).toBe(original.payload.time + 60);
  });

  it('never shifts an rx_time of 0, and publishes a raw fixture as is', () => {
    const [zero] = loadFixture('rx-time-zero');
    expect(
      (JSON.parse(prepare(zero, { shiftSeconds: 60 })) as { timestamp: number }).timestamp,
    ).toBe(0);
    const [raw] = loadFixture('malformed');
    expect(prepare(raw, { shiftSeconds: 60 })).toBe(raw.raw);
  });
});
