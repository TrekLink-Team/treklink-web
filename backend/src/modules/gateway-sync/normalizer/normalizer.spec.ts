import { NormalizationError } from './normalized-reading';
import { Normalizer } from './normalizer';

const normalizer = new Normalizer();

describe('Normalizer', () => {
  it('tests the fall prefix before the SOS prefix; both are P0 (REQ-EVT-02)', () => {
    expect(normalizer.normalize('text', { text: 'SOS - FALL DETECTED - [No GPS]' })).toEqual({
      kind: 'FALL_SOS',
      priority: 'P0_SOS',
    });
    expect(normalizer.normalize('text', { text: 'SOS - [11.561000], [108.552000]' })).toEqual({
      kind: 'SOS',
      priority: 'P0_SOS',
    });
    expect(normalizer.normalize('text', { text: 'Reached camp 2' })).toEqual({
      kind: 'CHAT',
      priority: 'P3_TELEMETRY',
    });
  });

  it('decodes a position from 1e-7 degrees', () => {
    expect(
      normalizer.normalize('position', {
        latitude_i: 115544000,
        longitude_i: 1085381000,
        altitude: 1320,
      }),
    ).toEqual({
      kind: 'POSITION',
      priority: 'P2_GPS',
      position: { latitude: 11.5544, longitude: 108.5381, altitude: 1320 },
    });
  });

  it('reads the battery level and refuses 101, the external-power marker', () => {
    expect(normalizer.normalize('telemetry', { battery_level: 87, voltage: 4.02 })).toEqual({
      kind: 'TELEMETRY',
      priority: 'P3_TELEMETRY',
      batteryPct: 87,
    });
    expect(normalizer.normalize('telemetry', { battery_level: 101 })).toEqual({
      kind: 'TELEMETRY',
      priority: 'P3_TELEMETRY',
    });
    expect(normalizer.normalize('telemetry', { temperature: 21.5 })).not.toHaveProperty(
      'batteryPct',
    );
  });

  it('throws for a payload its strategy cannot read (REQ-ERR-05)', () => {
    expect(() => normalizer.normalize('text', {})).toThrow(NormalizationError);
    expect(() => normalizer.normalize('position', { latitude_i: 1.5, longitude_i: 2 })).toThrow(
      NormalizationError,
    );
  });
});
