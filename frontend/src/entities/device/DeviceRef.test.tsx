// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceRef } from './DeviceRef';
import { deviceHomePath } from './paths';

afterEach(cleanup);

const renderRef = (props: Partial<React.ComponentProps<typeof DeviceRef>> = {}) =>
  render(
    <MemoryRouter>
      <DeviceRef deviceId="d-1" assetTag="TL-0042" scope="t" {...props} />
    </MemoryRouter>,
  );

describe('DeviceRef (specs/devices/design.md section 10)', () => {
  it('links the asset tag to the device home of TrekLink', () => {
    renderRef();

    expect(screen.getByRole('link', { name: 'TL-0042' }).getAttribute('href')).toBe(
      '/t/devices/d-1',
    );
  });

  it('links to the history of the unit in the organization area, which has no device home', () => {
    renderRef({ scope: 'o' });

    expect(screen.getByRole('link', { name: 'TL-0042' }).getAttribute('href')).toBe(
      '/o/devices/d-1/telemetry',
    );
    expect(deviceHomePath('o', 'd-9')).toBe('/o/devices/d-9/telemetry');
  });

  it('keeps the asset tag as plain text when the unit has no page to open yet', () => {
    renderRef({ scope: 'o', linked: false });

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('TL-0042')).toBeTruthy();
  });

  it('shows the variant name and the status as text', () => {
    renderRef({ variantName: 'TrekLink v3', status: 'AVAILABLE' });

    expect(screen.getByText('TrekLink v3')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('shows the device id when the tag is not known', () => {
    renderRef({ assetTag: null });

    expect(screen.getByRole('link', { name: 'd-1' })).toBeTruthy();
  });
});
