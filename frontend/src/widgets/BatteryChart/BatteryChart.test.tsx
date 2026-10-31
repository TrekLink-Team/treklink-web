// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BatteryChart } from './BatteryChart';

afterEach(cleanup);

const reading = (minute: number, batteryPct: number) => ({
  at: new Date(Date.UTC(2026, 9, 20, 3, minute)).toISOString(),
  batteryPct,
});

describe('BatteryChart (screen 9.2)', () => {
  it('says there are no readings instead of drawing an empty chart', () => {
    render(<BatteryChart readings={[]} deviceLabel="TL-0042" />);
    expect(screen.getByText('No battery readings in this range.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('describes the first and last reading and the count in its text alternative', () => {
    render(<BatteryChart readings={[reading(0, 81), reading(30, 80), reading(59, 78)]} deviceLabel="TL-0042" />);
    const label = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(label).toContain('Battery of TL-0042 from 81 %');
    expect(label).toContain('to 78 %');
    expect(label).toContain('3 readings');
  });

  it('draws a single reading as a line without failing', () => {
    render(<BatteryChart readings={[reading(0, 50)]} deviceLabel="TL-0042" />);
    expect(screen.getByRole('img').querySelector('polyline')).toBeTruthy();
  });

  it('thins a long series to a few hundred drawn points and keeps the last one', () => {
    const readings = Array.from({ length: 5000 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 9, 20, 0, 0, index * 5)).toISOString(),
      batteryPct: 100 - Math.floor(index / 100),
    }));
    render(<BatteryChart readings={readings} deviceLabel="TL-0042" />);
    const points = screen.getByRole('img').querySelector('polyline')?.getAttribute('points') ?? '';
    const drawn = points.split(' ').length;
    expect(drawn).toBeLessThanOrEqual(602);
    expect(drawn).toBeGreaterThan(100);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('5000 readings');
  });
});
