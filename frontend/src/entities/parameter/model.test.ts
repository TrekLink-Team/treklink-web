import { describe, expect, it } from 'vitest';
import type { Parameter, ParameterType } from './api';
import {
  boundsText,
  groupByModule,
  inputText,
  parseValue,
  sameValue,
  valueText,
} from './model';

const parameter = (
  valueType: ParameterType,
  bounds: Parameter['bounds'] = null,
  overrides: Partial<Parameter> = {},
): Parameter => ({
  key: 'incidents.primaryAckTimeoutSeconds',
  value: 120,
  valueType,
  bounds,
  unit: 'seconds',
  ownerModule: 'incidents',
  description: 'How long the primary has to acknowledge',
  version: 3,
  updatedAt: '2026-10-20T03:15:00.000Z',
  ...overrides,
});

describe('parseValue (MSG02)', () => {
  const seconds = parameter('DURATION_SECONDS', { min: 30, max: 900 });

  it('accepts a whole number inside the bounds, edges included', () => {
    expect(parseValue(seconds, '90')).toEqual({ value: 90 });
    expect(parseValue(seconds, ' 30 ')).toEqual({ value: 30 });
    expect(parseValue(seconds, '900')).toEqual({ value: 900 });
  });

  it('names the key and the range when the number is outside', () => {
    const message = 'incidents.primaryAckTimeoutSeconds must be between 30 and 900.';
    expect(parseValue(seconds, '29')).toEqual({ error: message });
    expect(parseValue(seconds, '901')).toEqual({ error: message });
  });

  it('refuses text, a decimal and an empty field for a whole number', () => {
    for (const typed of ['abc', '1.5', '', '1e3', '12 3']) {
      expect(parseValue(seconds, typed)).toEqual({
        error: 'incidents.primaryAckTimeoutSeconds must be a whole number.',
      });
    }
  });

  it('accepts a decimal for DECIMAL and refuses text', () => {
    const ratio = parameter('DECIMAL', { min: 0, max: 1 }, { key: 'billing.holdingFeeRatio' });
    expect(parseValue(ratio, '0.5')).toEqual({ value: 0.5 });
    expect(parseValue(ratio, '1.5')).toEqual({
      error: 'billing.holdingFeeRatio must be between 0 and 1.',
    });
    expect(parseValue(ratio, 'half')).toEqual({ error: 'billing.holdingFeeRatio must be a number.' });
  });

  it('keeps a percent between 0 and 100 even when the row declares no range', () => {
    const percent = parameter('PERCENT');
    expect(parseValue(percent, '20')).toEqual({ value: 20 });
    expect(parseValue(percent, '101')).toMatchObject({ error: expect.stringContaining('between 0 and 100') });
    expect(parseValue(percent, '-1')).toMatchObject({ error: expect.stringContaining('between 0 and 100') });
  });

  it('says at least or at most for a one-sided range', () => {
    expect(parseValue(parameter('INT', { min: 1 }), '0')).toMatchObject({
      error: expect.stringContaining('must be at least 1.'),
    });
    expect(parseValue(parameter('INT', { max: 10 }), '11')).toMatchObject({
      error: expect.stringContaining('must be at most 10.'),
    });
  });

  it('parses JSON and refuses text that is not JSON', () => {
    const json = parameter('JSON', null, { key: 'rentals.dayPlanLengths' });
    expect(parseValue(json, '[3, 4, 7]')).toEqual({ value: [3, 4, 7] });
    expect(parseValue(json, '{"a": 1}')).toEqual({ value: { a: 1 } });
    expect(parseValue(json, '[3, 4,')).toEqual({ error: 'rentals.dayPlanLengths must be valid JSON.' });
  });
});

describe('displays', () => {
  it('writes the range of a parameter, or nothing when it has none', () => {
    expect(boundsText(parameter('INT', { min: 30, max: 900 }))).toBe('30 to 900');
    expect(boundsText(parameter('INT', { min: 1 }))).toBe('at least 1');
    expect(boundsText(parameter('INT', { max: 5 }))).toBe('at most 5');
    expect(boundsText(parameter('PERCENT'))).toBe('0 to 100');
    expect(boundsText(parameter('JSON'))).toBeNull();
  });

  it('shows a JSON value compact in a cell and pretty in the editor', () => {
    const json = parameter('JSON', null, { value: { lat: 11.5, zoom: 12 } });
    expect(valueText(json.value)).toBe('{"lat":11.5,"zoom":12}');
    expect(inputText(json)).toBe('{\n  "lat": 11.5,\n  "zoom": 12\n}');
    expect(inputText(parameter('INT'))).toBe('120');
  });

  it('compares values by content', () => {
    expect(sameValue([3, 4, 7], [3, 4, 7])).toBe(true);
    expect(sameValue(90, 120)).toBe(false);
  });

  it('groups by module in alphabetical order, keys in order', () => {
    const groups = groupByModule([
      parameter('INT', null, { key: 'rentals.b', ownerModule: 'rentals' }),
      parameter('INT', null, { key: 'auth.z', ownerModule: 'auth' }),
      parameter('INT', null, { key: 'auth.a', ownerModule: 'auth' }),
    ]);
    expect(groups.map(([module]) => module)).toEqual(['auth', 'rentals']);
    expect(groups[0][1].map((item) => item.key)).toEqual(['auth.a', 'auth.z']);
  });
});
