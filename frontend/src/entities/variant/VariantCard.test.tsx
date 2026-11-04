// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { iconUrlOf, imageSources, specLines } from './spec';
import { NO_IMAGE_TEXT, VariantCard } from './VariantCard';
import { VariantImage } from './VariantImage';

afterEach(cleanup);

const V3 = {
  name: 'TrekLink v3',
  imageUrl: null,
  specSheet: { localAlarm: 'LED blinks', mcu: 'ESP32', sosControl: '3 s hold on the user button' },
};

describe('specLines (specs/devices/design.md section 10)', () => {
  it('lists the keys in the fixed order, whatever the order of the sheet', () => {
    expect(specLines(V3.specSheet).map((line) => line.label)).toEqual([
      'MCU',
      'SOS control',
      'Local alarm',
    ]);
  });

  it('leaves out an unknown key, an empty value and a value that is not text', () => {
    expect(
      specLines({ mcu: 'ESP32', colour: 'red', radio: '', gnss: '  ', battery: 3, display: null }),
    ).toEqual([{ key: 'mcu', label: 'MCU', value: 'ESP32' }]);
  });

  it.each([null, undefined, 'text', 4, []])('reads %p as an empty sheet', (sheet) => {
    expect(specLines(sheet)).toEqual([]);
  });
});

describe('VariantCard', () => {
  it('shows the labelled empty slot when there is no image', () => {
    render(<VariantCard variant={V3} />);

    expect(screen.getByText(NO_IMAGE_TEXT)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows the image named after the variant when there is one', () => {
    render(<VariantCard variant={{ ...V3, imageUrl: '/variants/treklink-v3.jpg' }} />);

    const image = screen.getByRole('img', { name: 'TrekLink v3 unit' });
    expect(image.getAttribute('src')).toBe('/variants/treklink-v3.jpg');
    expect(screen.queryByText(NO_IMAGE_TEXT)).toBeNull();
  });

  it('falls back to the empty slot when the image does not load', () => {
    render(<VariantCard variant={{ ...V3, imageUrl: '/variants/missing.jpg' }} />);

    fireEvent.error(screen.getByRole('img'));

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(NO_IMAGE_TEXT)).toBeTruthy();
  });

  it('tries a new image after the variant changes', () => {
    const { rerender } = render(
      <VariantCard variant={{ ...V3, imageUrl: '/variants/missing.jpg' }} />,
    );
    fireEvent.error(screen.getByRole('img'));

    rerender(<VariantCard variant={{ ...V3, imageUrl: '/variants/treklink-v3.jpg' }} />);

    expect(screen.getByRole('img').getAttribute('src')).toBe('/variants/treklink-v3.jpg');
  });

  it('names the variant as a heading of the level asked for and lists the spec in order', () => {
    render(<VariantCard variant={V3} headingLevel="h2" />);

    expect(screen.getByRole('heading', { level: 2, name: 'TrekLink v3' })).toBeTruthy();
    const terms = screen.getAllByRole('term').map((node) => node.textContent);
    expect(terms).toEqual(['MCU', 'SOS control', 'Local alarm']);
    expect(screen.getByText('3 s hold on the user button')).toBeTruthy();
  });

  it('lists the capability flags as text, and None when all are off', () => {
    const { rerender } = render(
      <VariantCard variant={{ ...V3, hasGps: true, hasMotionSensor: false, mqttCapable: true }} />,
    );
    expect(screen.getByText('Capabilities')).toBeTruthy();
    expect(screen.getByText('GPS, MQTT')).toBeTruthy();

    rerender(
      <VariantCard variant={{ ...V3, hasGps: false, hasMotionSensor: false, mqttCapable: false }} />,
    );
    expect(screen.getByText('None')).toBeTruthy();
  });

  it('leaves the capabilities out when the read carries no flags', () => {
    render(<VariantCard variant={V3} />);

    expect(screen.queryByText('Capabilities')).toBeNull();
  });

  it('shows the firmware baseline when the read carries it, and nothing when it does not', () => {
    const { rerender } = render(
      <VariantCard variant={{ ...V3, firmwareBaseline: '2.7.19-treklink.3' }} />,
    );
    expect(screen.getByText('Firmware baseline')).toBeTruthy();
    expect(screen.getByText('2.7.19-treklink.3')).toBeTruthy();

    rerender(<VariantCard variant={V3} />);
    expect(screen.queryByText('Firmware baseline')).toBeNull();
  });

  it('draws no spec list for an empty sheet and shows what the caller adds', () => {
    render(
      <VariantCard variant={{ ...V3, specSheet: {} }}>
        <p>450 000 VND per month</p>
      </VariantCard>,
    );

    expect(screen.queryByRole('term')).toBeNull();
    expect(screen.getByText('450 000 VND per month')).toBeTruthy();
  });
});

// specs/devices/design.md section 10, "Two renders per variant" (W17, devices task 9.3).
describe('the two renders of a variant', () => {
  const DETAIL = '/variants/treklink-v3-detail.png';
  const ICON = '/variants/treklink-v3-icon.png';

  it('derives the icon render from the detail render by name', () => {
    expect(iconUrlOf(DETAIL)).toBe(ICON);
    expect(iconUrlOf('https://cdn.example.com/v4-detail.webp')).toBe('https://cdn.example.com/v4-icon.webp');
    // No -detail suffix, or one not at the end: the same image serves both places.
    expect(iconUrlOf('/variants/treklink-v3.jpg')).toBe('/variants/treklink-v3.jpg');
    expect(iconUrlOf('/variants/a-detail.png?v=2')).toBe('/variants/a-detail.png?v=2');
  });

  it('tries the icon and then the detail render for a list, only the detail render for a pane', () => {
    expect(imageSources(DETAIL, 'icon')).toEqual([ICON, DETAIL]);
    expect(imageSources(DETAIL, 'detail')).toEqual([DETAIL]);
    expect(imageSources('/variants/treklink-v3.jpg', 'icon')).toEqual(['/variants/treklink-v3.jpg']);
    expect(imageSources(null, 'icon')).toEqual([]);
    expect(imageSources(undefined, 'detail')).toEqual([]);
    expect(imageSources('  ', 'detail')).toEqual([]);
  });

  it('shows the icon render on a card by default, in a fixed 96 px box, lazily', () => {
    render(<VariantCard variant={{ ...V3, imageUrl: DETAIL }} />);

    const image = screen.getByRole('img', { name: 'TrekLink v3 unit' });
    expect(image.getAttribute('src')).toBe(ICON);
    expect(image.getAttribute('width')).toBe('96');
    expect(image.getAttribute('height')).toBe('96');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.parentElement?.className).toContain('h-24 w-24');
  });

  it('shows the detail render above the text in a fixed 160 px box', () => {
    render(<VariantCard variant={{ ...V3, imageUrl: DETAIL }} render="detail" />);

    const image = screen.getByRole('img', { name: 'TrekLink v3 unit' });
    expect(image.getAttribute('src')).toBe(DETAIL);
    expect(image.getAttribute('width')).toBe('160');
    expect(image.parentElement?.className).toContain('h-40 w-40');
    expect(image.parentElement?.parentElement?.className).toContain('flex-col');
  });

  it('falls back from a missing icon to the detail render, then to the empty slot', () => {
    render(<VariantCard variant={{ ...V3, imageUrl: DETAIL }} />);

    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img').getAttribute('src')).toBe(DETAIL);

    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(NO_IMAGE_TEXT)).toBeTruthy();
  });

  it('draws the small list icon on a theme token, and an empty box with no label when there is no image', () => {
    const { container, rerender } = render(
      <VariantImage variant={{ name: 'TrekLink v3', imageUrl: DETAIL }} render="icon" size="sm" />,
    );
    const image = screen.getByRole('img', { name: 'TrekLink v3 unit' });
    expect(image.getAttribute('src')).toBe(ICON);
    expect(image.getAttribute('width')).toBe('32');
    expect(image.parentElement?.className).toContain('bg-sunken');

    rerender(<VariantImage variant={{ name: 'TrekLink v3', imageUrl: null }} render="icon" size="sm" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(NO_IMAGE_TEXT)).toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    expect((container.firstChild as HTMLElement).className).toContain('h-8 w-8');
  });
});
