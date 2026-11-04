// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanVariant } from '../../entities/billing/api';
import { formatVnd } from '../../shared/lib/format';
import { VariantPicker } from './VariantPicker';

afterEach(cleanup);

const V3: PlanVariant = {
  id: 'v-3',
  code: 'treklink-v3',
  name: 'TrekLink v3',
  imageUrl: null,
  specSheet: { mcu: 'ESP32', localAlarm: 'LED blinks' },
  hasGps: true,
  hasMotionSensor: false,
  mqttCapable: true,
  firmwareBaseline: '2.7.19-treklink.3',
  monthlyPriceVnd: 450000,
  dayPriceVnd: 22500,
};
const V4: PlanVariant = {
  ...V3,
  id: 'v-4',
  code: 'treklink-v4',
  name: 'TrekLink v4',
  imageUrl: '/variants/treklink-v4-detail.png',
  specSheet: { mcu: 'ESP32-S3' },
};

const Harness: React.FC<{ error?: string; counts?: Record<string, number> }> = ({
  error,
  counts = { 'v-3': 7 },
}) => {
  const [value, setValue] = useState('');
  return (
    <VariantPicker
      variants={[V3, V4]}
      value={value}
      onChange={setValue}
      countOf={(id) => counts[id]}
      error={error}
    />
  );
};

describe('VariantPicker (the variant cards of the request form)', () => {
  it('is a radio group named Hardware variant with one radio per variant, named after it', () => {
    render(<Harness />);

    expect(screen.getByRole('group', { name: 'Hardware variant' })).toBeTruthy();
    expect(
      screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-labelledby')),
    ).toEqual(['variant-v-3-name', 'variant-v-4-name']);
    expect(screen.getByRole('radio', { name: 'TrekLink v3' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'TrekLink v4' })).toBeTruthy();
  });

  it('describes each card with its price and the units available, and the spec summary', () => {
    render(<Harness />);

    expect(
      screen.getByRole('radio', { name: 'TrekLink v3' }).getAttribute('aria-describedby'),
    ).toBe('variant-v-3-detail');
    expect(screen.getByText(`${formatVnd(450000)} per device per month, 7 available`)).toBeTruthy();
    // The count is left out while it is not read.
    expect(screen.getByText(`${formatVnd(450000)} per device per month`)).toBeTruthy();
    expect(screen.getByText('LED blinks')).toBeTruthy();
    expect(screen.getByText('Variant image not added yet')).toBeTruthy();
    // The icon render on a card (devices design section 10, "Two renders per variant").
    expect(screen.getByRole('img', { name: 'TrekLink v4 unit' }).getAttribute('src')).toBe(
      '/variants/treklink-v4-icon.png',
    );
  });

  it('chooses a variant by its radio or by a click anywhere on its card', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('radio', { name: 'TrekLink v3' }));
    expect((screen.getByRole('radio', { name: 'TrekLink v3' }) as HTMLInputElement).checked).toBe(
      true,
    );

    fireEvent.click(screen.getByText('ESP32-S3'));
    expect((screen.getByRole('radio', { name: 'TrekLink v4' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole('radio', { name: 'TrekLink v3' }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('shows the capability flags of each variant as text', () => {
    render(<Harness />);

    expect(screen.getAllByText('GPS, MQTT')).toHaveLength(2);
    expect(screen.getAllByText('2.7.19-treklink.3')).toHaveLength(2);
  });

  it('calls onChange once for a click on the radio and once for a click on the card', () => {
    const onChange = vi.fn();
    render(
      <VariantPicker variants={[V3, V4]} value="" onChange={onChange} countOf={() => undefined} />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'TrekLink v3' }));
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('ESP32-S3'));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('v-4');
  });

  // W15 panel walk: two cards beside the quote at 1280 px left the spec list about 150 px wide.
  it('lays the cards one per row below 1536 px', () => {
    render(<Harness />);
    const grid = screen.getByRole('group').querySelector('.grid');
    expect(grid?.className).toContain('2xl:grid-cols-2');
    expect(grid?.className).not.toMatch(/(^|\s)(sm|md|lg|xl):grid-cols-/);
  });

  it('shows the error text, ties it to the group and marks the radios invalid', () => {
    render(<Harness error="Hardware variant is required." />);

    expect(screen.getByRole('alert').textContent).toBe('Hardware variant is required.');
    expect(screen.getByRole('group').getAttribute('aria-describedby')).toBe('variant-error');
    expect(screen.getAllByRole('radio')[0].getAttribute('aria-invalid')).toBe('true');
  });
});
